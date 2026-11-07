import { ProviderRateLimitError } from '../../src/modules/payments/providers/provider-retry.js';
import { describe, expect, it } from 'vitest';
import { workerConfigurationSchema } from '../../src/config/worker-options.js';

describe('bounded worker configuration', () => {
  it('interprets valid zero-padded Retry-After seconds and rejects negative hints', () => {
    expect(new ProviderRateLimitError('000000000120').retryAfterMs).toBe(
      120000,
    );
    expect(new ProviderRateLimitError('-1').retryAfterMs).toBe(60000);
    expect(
      new ProviderRateLimitError('999999999999999999999999999999').retryAfterMs,
    ).toBeGreaterThan(86400000);
  });
  it('defaults to bounded independent PostgreSQL processing', () => {
    expect(workerConfigurationSchema.parse({})).toMatchObject({
      WORKER_CONCURRENCY: 2,
      WORKER_MAX_ATTEMPTS: 12,
      WORKER_SCAN_BATCH: 100,
    });
  });
  it.each([
    { WORKER_CONCURRENCY: 0 },
    { WORKER_CONCURRENCY: 17 },
    { WORKER_POLL_MS: 0 },
    { WORKER_MAX_ATTEMPTS: 0 },
    { WORKER_SCAN_BATCH: 501 },
    { WORKER_LEASE_MS: 0 },
    { RESERVATION_TTL_SECONDS: 0 },
    { WORKER_INITIATION_GRACE_MS: 0 },
  ])('rejects unbounded/invalid settings %j', (input) => {
    expect(workerConfigurationSchema.safeParse(input).success).toBe(false);
  });
});
