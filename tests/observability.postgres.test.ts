import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { env } from '../src/config/env.js';
import {
  operationalRouter,
  FleetSnapshot,
} from '../src/common/observability/operations.js';
import { Readiness } from '../src/common/observability/readiness.js';
import { testPrisma } from '../src/config/test-database.js';

const original = env.OPS_METRICS_TOKEN;
beforeAll(() => {
  const target = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgres://localhost/missing',
  );
  if (!/^\/commerce_api_test_phase1b_[a-f0-9]{32}$/.test(target.pathname))
    throw new Error(
      'Run these checks through npm run test:postgres; disposable database required',
    );
});
afterEach(() => {
  if (original === undefined) delete env.OPS_METRICS_TOKEN;
  else env.OPS_METRICS_TOKEN = original;
});
describe('operational probes against disposable PostgreSQL', () => {
  it('serves readiness using actual PostgreSQL connectivity without database details', async () => {
    const ready = new Readiness(() => testPrisma.$queryRaw`SELECT 1`);
    const app = express().use('/ops', operationalRouter(ready));
    const response = await request(app).get('/ops/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('exports real aggregate backlog SQL through protected metrics without exposing job identities', async () => {
    env.OPS_METRICS_TOKEN = 'test_metrics_only_0123456789abcdef';
    const app = express().use(
      '/ops',
      operationalRouter(undefined, new FleetSnapshot()),
    );
    const response = await request(app)
      .get('/ops/metrics')
      .set('Authorization', `Bearer ${env.OPS_METRICS_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    for (const state of ['READY', 'RUNNING', 'MANUAL'])
      expect(response.text).toMatch(
        new RegExp(`commerce_worker_backlog\\{state="${state}"\\} \\d+`),
      );
    expect(response.text).toMatch(/commerce_worker_expired_leases \d+/);
    expect(response.text).not.toMatch(
      /tenantId|orderId|claimToken|password|postgres:\/\//,
    );
  });
});
