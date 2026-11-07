import { createServer } from 'node:http';
import { installFatalHandlers } from '../src/common/lifecycle/fatal-errors.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Writable } from 'node:stream';
import pino from 'pino';
import { requestIdMiddleware } from '../src/middleware/request-id.middleware.js';
import { requestLoggerMiddleware } from '../src/middleware/request-logger.middleware.js';
import { errorMiddleware } from '../src/middleware/error.middleware.js';
import { logger, loggerOptions } from '../src/common/logger/logger.js';
import { requestContext } from '../src/common/observability/context.js';
import {
  Metrics,
  classifyFailure,
  metrics,
  observePayment,
  routeFamily,
} from '../src/common/observability/metrics.js';
import { Readiness } from '../src/common/observability/readiness.js';
import {
  operationalRouter,
  FleetSnapshot,
} from '../src/common/observability/operations.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/database.js';
import { AppError } from '../src/common/errors/app-error.js';
import { RecoveryWorker } from '../src/modules/recovery/recovery.worker.js';
import { RecoveryService } from '../src/modules/recovery/recovery.service.js';
import { RecoveryRepository } from '../src/modules/recovery/recovery.repository.js';
import { shutdownApplication } from '../src/common/lifecycle/shutdown.js';

const originalToken = env.OPS_METRICS_TOKEN;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalToken === undefined) delete env.OPS_METRICS_TOKEN;
  else env.OPS_METRICS_TOKEN = originalToken;
});
function traced() {
  const app = express();
  app.use(requestIdMiddleware, requestLoggerMiddleware);
  app.get('/test', (_req, res) =>
    res.json({ requestId: requestContext.getStore()?.requestId }),
  );
  return app;
}
describe('Phase 6 observability', () => {
  it('generates and propagates a unique request ID without changing envelopes', async () => {
    const app = traced();
    const a = await request(app).get('/test');
    const b = await request(app).get('/test');
    expect(a.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(a.body.requestId).toBe(a.headers['x-request-id']);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
  it.each(['valid_ID-123', 'a'])(
    'accepts bounded request ID %s',
    async (id) => {
      const r = await request(traced()).get('/test').set('X-Request-ID', id);
      expect(r.headers['x-request-id']).toBe(id);
    },
  );
  it.each(['x'.repeat(65), 'token=secret', 'has spaces', '<script>'])(
    'replaces invalid request IDs',
    async (id) => {
      const r = await request(traced()).get('/test').set('X-Request-ID', id);
      expect(r.headers['x-request-id']).not.toBe(id);
    },
  );
  it('logs completion safely with correlation and duration, excluding bodies and queries', async () => {
    const spy = vi.spyOn(logger, 'info');
    await request(traced())
      .get('/test?token=CANARY')
      .set('X-Request-ID', 'safe-id')
      .set('Authorization', 'Bearer SECRET');
    const log = spy.mock.calls.find(
      (call) => call[1] === 'HTTP request completed',
    )?.[0];
    expect(log).toMatchObject({
      requestId: 'safe-id',
      path: '/test',
      statusCode: 200,
    });
    expect(JSON.stringify(log)).not.toContain('CANARY');
    expect(JSON.stringify(log)).not.toContain('SECRET');
  });
  it('redacts auth and payment secrets in serialized Pino output', () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const testLogger = pino(loggerOptions, stream);
    testLogger.info({
      accessToken: 'JWT_CANARY',
      refreshToken: 'REFRESH_CANARY',
      MYFATOORAH_API_TOKEN: 'API_CANARY',
      MYFATOORAH_WEBHOOK_SECRET: 'WEBHOOK_CANARY',
      req: {
        headers: { authorization: 'BEARER_CANARY' },
        body: { password: 'PASS_CANARY' },
      },
    });
    expect(output).not.toContain('CANARY');
    expect(output).toContain('[REDACTED]');
  });
  it('keeps exception content out of logs and controlled errors', async () => {
    const spy = vi.spyOn(logger, 'error');
    const app = traced();
    app.get('/fail', () => {
      throw new Error('CREDENTIAL_CANARY');
    });
    app.use(errorMiddleware);
    const r = await request(app).get('/fail').set('X-Request-ID', 'failure-id');
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('CREDENTIAL_CANARY');
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ requestId: 'failure-id' });
  });
  it('caches and coalesces readiness probes', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const ready = new Readiness(probe);
    expect(await Promise.all([ready.check(), ready.check()])).toEqual([
      true,
      true,
    ]);
    await ready.check();
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('fails readiness safely on database errors', async () => {
    const ready = new Readiness(async () => {
      throw new Error('postgres://PASSWORD');
    });
    expect(await ready.check()).toBe(false);
  });
  it('bounds readiness probe time and refuses draining processes', async () => {
    vi.useFakeTimers();
    const ready = new Readiness(() => new Promise(() => {}), 2000, 100);
    const pending = ready.check();
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBe(false);
    ready.draining = true;
    expect(await ready.check()).toBe(false);
  });
  it('serves liveness independently and minimal readiness without secrets', async () => {
    const ready = new Readiness(async () => {
      throw new Error('SECRET_DB');
    });
    const app = express().use('/ops', operationalRouter(ready));
    expect((await request(app).get('/ops/live')).body).toEqual({
      status: 'alive',
    });
    const response = await request(app).get('/ops/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });
  it('serves ready on a successful connectivity probe', async () => {
    const app = express().use(
      '/ops',
      operationalRouter(new Readiness(async () => {})),
    );
    expect((await request(app).get('/ops/ready')).status).toBe(200);
  });
  it('disables metrics until a dedicated token is configured', async () => {
    delete env.OPS_METRICS_TOKEN;
    const app = express().use('/ops', operationalRouter());
    expect((await request(app).get('/ops/metrics')).status).toBe(503);
  });
  it('protects metrics with dedicated credentials and emits standard text', async () => {
    env.OPS_METRICS_TOKEN = 'x'.repeat(32);
    const fleet = new FleetSnapshot();
    vi.spyOn(fleet, 'read').mockResolvedValue(
      'commerce_worker_backlog{state="READY"} 2\n',
    );
    const app = express().use('/ops', operationalRouter(undefined, fleet));
    expect((await request(app).get('/ops/metrics')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/ops/metrics')
          .set('Authorization', 'Bearer wrong')
      ).status,
    ).toBe(401);
    const r = await request(app)
      .get('/ops/metrics')
      .set('Authorization', `Bearer ${env.OPS_METRICS_TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('commerce_worker_backlog');
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('uses bounded route labels for arbitrary tenant/customer paths', () => {
    const labels = new Set(
      Array.from({ length: 1000 }, (_, i) =>
        routeFamily(`/api/v1/products/${i}?tenant=${i}`, '/api/v1'),
      ),
    );
    expect([...labels]).toEqual(['products']);
    expect(routeFamily('/private-email/secret', '/api/v1')).toBe('other');
  });
  it('records HTTP errors and cumulative latency buckets without identifiers', () => {
    const m = new Metrics();
    m.http('GET', 'checkout', 500, 0.08);
    m.http('GET', 'checkout', 200, 0.2);
    const text = m.render();
    expect(text).toContain('status="500"} 1');
    expect(text).toContain('le="0.1"} 1');
    expect(text).toContain('le="+Inf"} 2');
    expect(text).toContain('commerce_checkout_failures_total{class="5xx"} 1');
  });
  it.each([
    ['MYFATOORAH_REJECTED', 'rejected'],
    ['MYFATOORAH_TIMEOUT', 'timeout'],
    ['PAYMENT_INITIATION_UNKNOWN', 'unknown'],
    ['MYFATOORAH_SIGNATURE_INVALID', 'invalid_signature'],
    ['MYFATOORAH_AMOUNT_MISMATCH', 'mismatch'],
    ['PAYMENT_RECONCILIATION_REQUIRED', 'conflict'],
  ])('classifies %s into bounded outcome', (code, outcome) => {
    expect(classifyFailure(new AppError('SECRET', 409, code))).toBe(outcome);
  });
  it('records actual wrapped operation failures without swallowing errors', async () => {
    const error = new AppError('SECRET', 502, 'MYFATOORAH_REJECTED');
    const spy = vi.spyOn(metrics, 'payment');
    await expect(
      observePayment('initiation', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(spy).toHaveBeenCalledWith('initiation', 'rejected');
  });
  it('counts failed database startup and refuses readiness', async () => {
    const actual = await vi.importActual<
      typeof import('../src/config/database.js')
    >('../src/config/database.js');
    vi.spyOn(actual.prisma, '$connect').mockRejectedValue(
      new Error('DB_CANARY'),
    );
    const spy = vi.spyOn(metrics, 'increment');
    await expect(actual.connectDatabase()).rejects.toThrow('DB_CANARY');
    expect(spy).toHaveBeenCalledWith(
      'commerce_database_connectivity_failures_total',
      'source="startup"',
    );
  });
  it('reads fleet backlog as read-only snapshot shared by worker instances', async () => {
    const query = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([
      { state: 'READY', count: 3n, oldest: 10, expired: 0n },
      { state: 'MANUAL', count: 2n, oldest: 20, expired: 0n },
    ]);
    const a = new FleetSnapshot();
    const b = new FleetSnapshot();
    expect(await a.read()).toEqual(await b.read());
    await a.read();
    expect(query).toHaveBeenCalledTimes(2);
    expect(await a.read()).toContain(
      'commerce_worker_backlog{state="MANUAL"} 2',
    );
  });
  it.each(['RETRY', 'MANUAL', 'LEASE_LOST', 'EXPIRED'])(
    'records worker %s and drains without another claim',
    async (outcome) => {
      const repo = new RecoveryRepository();
      const service = new RecoveryService(repo);
      const controller = new AbortController();
      vi.spyOn(repo, 'enqueue').mockResolvedValue(0);
      vi.spyOn(repo, 'claim').mockResolvedValue([
        {
          id: 'job',
          tenantId: 'tenant',
          orderId: 'order',
          attempts: 1,
          state: 'RUNNING',
          availableAt: new Date(),
          leaseUntil: new Date(),
          claimToken: 'claim',
          lastErrorCode: null,
          finishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      vi.spyOn(service, 'process').mockImplementation(async () => {
        controller.abort();
        return outcome;
      });
      const spy = vi.spyOn(metrics, 'increment');
      await new RecoveryWorker(service).run(controller.signal);
      expect(repo.claim).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        'commerce_worker_jobs_total',
        `outcome="${outcome}"`,
      );
      expect(metrics.render()).toContain('commerce_worker_running 0');
    },
  );
  it('drains HTTP before disconnecting the database', async () => {
    const order: string[] = [];
    const server = createServer();
    vi.spyOn(server, 'close').mockImplementation((callback) => {
      order.push('close');
      callback?.();
      return server;
    });
    vi.spyOn(server, 'closeAllConnections').mockImplementation(() => {
      order.push('force');
    });
    await shutdownApplication(
      server,
      async () => {
        order.push('disconnect');
      },
      100,
    );
    expect(order).toEqual(['close', 'disconnect']);
  });
});

it('classifies a mounted checkout response using the original URL', async () => {
  const spy = vi.spyOn(metrics, 'http');
  const child = express.Router();
  child.get('/preview', (_req, res) =>
    res.status(400).json({ success: false }),
  );
  const app = express();
  app.use(requestIdMiddleware, requestLoggerMiddleware);
  app.use(`${env.API_PREFIX}/checkout`, child);
  await request(app).get(`${env.API_PREFIX}/checkout/preview?secret=CANARY`);
  expect(spy).toHaveBeenCalledWith('GET', 'checkout', 400, expect.any(Number));
});
it('keeps concurrent async correlation contexts isolated and log fields immutable', async () => {
  let text = '';
  const output = new Writable({
    write(chunk, _encoding, done) {
      text += chunk.toString();
      done();
    },
  });
  const log = pino(loggerOptions, output);
  await Promise.all(
    ['request-a', 'request-b'].map((id) =>
      requestContext.run({ requestId: id }, async () => {
        log.info({ category: 'FIRST' });
        await Promise.resolve();
        log.info({ operation: 'second' });
        expect(requestContext.getStore()).toEqual({ requestId: id });
      }),
    ),
  );
  const rows = text
    .trim()
    .split('\n')
    .map((row) => JSON.parse(row));
  expect(
    rows
      .filter((row) => row.operation === 'second')
      .map((row) => row.requestId)
      .sort(),
  ).toEqual(['request-a', 'request-b']);
  expect(
    rows
      .filter((row) => row.operation === 'second')
      .every((row) => row.category === undefined),
  ).toBe(true);
});
it('handles fatal events once, safely logs and requests bounded shutdown', () => {
  const before = process.listeners('unhandledRejection');
  const exitCode = process.exitCode;
  const stop = vi.fn();
  const spy = vi.spyOn(logger, 'fatal');
  const uninstall = installFatalHandlers(stop);
  try {
    const handler = process
      .listeners('unhandledRejection')
      .find((listener) => !before.includes(listener));
    expect(handler).toBeDefined();
    handler?.(new Error('SECRET_CANARY'), Promise.resolve());
    handler?.(new Error('SECRET_CANARY'), Promise.resolve());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET_CANARY');
  } finally {
    uninstall();
    process.exitCode = exitCode;
  }
});
it('bounds HTTP drain timeout and force closes connections', async () => {
  vi.useFakeTimers();
  const server = createServer();
  vi.spyOn(server, 'close').mockReturnValue(server);
  const force = vi
    .spyOn(server, 'closeAllConnections')
    .mockImplementation(() => {});
  const disconnect = vi.fn();
  const pending = shutdownApplication(server, disconnect, 100);
  const assertion = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
  expect(force).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
});
it('does not accumulate database probes while a timed-out probe remains unresolved', async () => {
  vi.useFakeTimers();
  const probe = vi.fn(() => new Promise(() => {}));
  const ready = new Readiness(probe, 2000, 100);
  const first = ready.check();
  await vi.advanceTimersByTimeAsync(100);
  expect(await first).toBe(false);
  await vi.advanceTimersByTimeAsync(2001);
  const second = ready.check();
  await vi.advanceTimersByTimeAsync(100);
  expect(await second).toBe(false);
  expect(probe).toHaveBeenCalledTimes(1);
});
