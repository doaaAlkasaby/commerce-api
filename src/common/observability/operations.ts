import { timingSafeEqual, createHash } from 'node:crypto';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../config/database.js';
import { metrics } from './metrics.js';
import { Readiness } from './readiness.js';
export const readiness = new Readiness(() => prisma.$queryRaw`SELECT 1`);
export class FleetSnapshot {
  private cached = '';
  private at = Number.NEGATIVE_INFINITY;
  private pending: Promise<string> | undefined;
  async read(): Promise<string> {
    if (Date.now() - this.at < 5000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  private async load(): Promise<string> {
    // Read-only fleet snapshot; no metrics writes inside settlement transactions.
    const rows = await prisma.$queryRaw<
      Array<{ state: string; count: bigint; oldest: number; expired: bigint }>
    >`
      SELECT "state"::text AS state, count(*) AS count,
      COALESCE(EXTRACT(EPOCH FROM (clock_timestamp()-min("createdAt"))),0)::float8 AS oldest,
      count(*) FILTER (WHERE "state"='RUNNING' AND "leaseUntil"<=clock_timestamp()) AS expired
      FROM "RecoveryJob" WHERE "state" IN ('READY','RUNNING','MANUAL') GROUP BY "state"`;
    const lines: string[] = [
      '# TYPE commerce_worker_backlog gauge',
      '# TYPE commerce_worker_oldest_job_seconds gauge',
      '# TYPE commerce_worker_expired_leases gauge',
    ];
    for (const state of ['READY', 'RUNNING', 'MANUAL']) {
      const row = rows.find((item) => item.state === state);
      lines.push(
        `commerce_worker_backlog{state="${state}"} ${row?.count ?? 0}`,
      );
    }
    for (const state of ['READY', 'RUNNING', 'MANUAL']) {
      const row = rows.find((item) => item.state === state);
      lines.push(
        `commerce_worker_oldest_job_seconds{state="${state}"} ${Math.max(0, row?.oldest ?? 0)}`,
      );
    }
    lines.push(
      `commerce_worker_expired_leases ${rows.reduce((sum, row) => sum + Number(row.expired), 0)}`,
    );
    this.cached = lines.join('\n') + '\n';
    this.at = Date.now();
    return this.cached;
  }
}
export const fleetSnapshot = new FleetSnapshot();
export function operationalRouter(
  status = readiness,
  fleet = fleetSnapshot,
): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/live', (_req, res) => {
    res.json({ status: 'alive' });
  });
  router.get('/ready', async (_req, res) => {
    const ok = await status.check();
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready' });
  });
  router.get('/metrics', async (req, res) => {
    const configured = env.OPS_METRICS_TOKEN;
    const value = req.header('authorization') ?? '';
    const expected = configured ? `Bearer ${configured}` : '';
    if (
      !configured ||
      value.length > 1024 ||
      !timingSafeEqual(
        createHash('sha256').update(value).digest(),
        createHash('sha256').update(expected).digest(),
      )
    ) {
      res.status(configured ? 401 : 503).json({
        success: false,
        message: 'Operational metrics unavailable',
        code: 'OPS_ACCESS_DENIED',
        data: null,
      });
      return;
    }
    try {
      const snapshot = await fleet.read();
      res.type('text/plain; version=0.0.4').send(metrics.render() + snapshot);
    } catch {
      metrics.increment(
        'commerce_database_connectivity_failures_total',
        'source="metrics"',
      );
      res.status(503).json({ status: 'unavailable' });
    }
  });
  return router;
}
