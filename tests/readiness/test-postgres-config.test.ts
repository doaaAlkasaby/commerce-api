import { describe, expect, it } from 'vitest';
import {
  verificationDatabaseSettings,
  disposableDatabaseIdentifier,
} from '../../scripts/test-postgres.js';

describe('Disposable PostgreSQL verification configuration', () => {
  const template =
    'postgresql://test_user:test_password@localhost:5433/commerce_api_test?schema=public';

  it('requires a test URL and never falls back to the production URL', () => {
    expect(() =>
      verificationDatabaseSettings({
        DATABASE_URL: 'postgresql://localhost/production',
      }),
    ).toThrow('TEST_DATABASE_URL is required');
    expect(() =>
      verificationDatabaseSettings({
        TEST_DATABASE_URL: 'postgresql://localhost/commerce_api',
      }),
    ).toThrow('test database');
    expect(() =>
      verificationDatabaseSettings({
        TEST_DATABASE_URL: 'https://localhost/test',
      }),
    ).toThrow('PostgreSQL test database');
    expect(() =>
      verificationDatabaseSettings({
        TEST_DATABASE_URL: template,
        NODE_ENV: 'production',
      }),
    ).toThrow('NODE_ENV=production');
  });

  it('isolates both database clients and enables every hardening suite', () => {
    const first = verificationDatabaseSettings({
      TEST_DATABASE_URL: template,
      DATABASE_URL: 'postgresql://localhost/production',
    });
    const second = verificationDatabaseSettings({
      TEST_DATABASE_URL: template,
    });
    expect(first.databaseName).toMatch(
      /^commerce_api_test_phase1b_[a-f0-9]{32}$/,
    );
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(new URL(first.adminUrl).pathname).toBe('/postgres');
    expect(first.env.DATABASE_URL).toBe(first.env.TEST_DATABASE_URL);
    expect(new URL(first.env.TEST_DATABASE_URL!).pathname).toBe(
      `/${first.databaseName}`,
    );
    expect(first.env).toMatchObject({
      NODE_ENV: 'test',
      RUN_CHECKOUT_INTEGRATION: '1',
      RUN_COUPON_CONCURRENCY_INTEGRATION: '1',
      RUN_INVENTORY_CONCURRENCY_INTEGRATION: '1',
      RUN_RESERVATION_LIFECYCLE_INTEGRATION: '1',
      RUN_TENANT_INTEGRATION: '1',
    });
  });
});

describe('Disposable database identifier guard', () => {
  it.each([
    'postgres',
    'commerce_api',
    'commerce_api_test',
    'commerce_api_test_phase1b_bad";DROP DATABASE postgres;',
  ])('refuses to create or drop a non-disposable identifier: %s', (name) => {
    expect(() => disposableDatabaseIdentifier(name)).toThrow('non-disposable');
  });
  it('accepts only the exact generated UUID identifier', () => {
    const name = 'commerce_api_test_phase1b_' + 'a'.repeat(32);
    expect(disposableDatabaseIdentifier(name)).toBe(`"${name}"`);
  });
});
