import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  databaseConfigurationSchema,
  databasePoolConfig,
  validateDatabaseSecurity,
  migrationDatabaseUrl,
  databaseErrorCode,
} from '../../src/config/database-options.js';

const schema = databaseConfigurationSchema.superRefine(
  validateDatabaseSecurity,
);
const DATABASE_URL =
  'postgresql://user:secret@localhost:5433/commerce_api_test';

describe('Database configuration', () => {
  it('preserves local plaintext development and sets bounded pool defaults', () => {
    const config = schema.parse({ DATABASE_URL });
    expect(databasePoolConfig(DATABASE_URL, config)).toEqual({
      connectionString: DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
  });
  it.each(['https://example.test/db', 'not-a-url', 'postgresql://localhost/'])(
    'rejects non-database URLs safely: %s',
    (url) => {
      expect(schema.safeParse({ DATABASE_URL: url }).success).toBe(false);
    },
  );
  it('rejects invalid pool sizes and unbounded connection waits', () => {
    for (const values of [
      { DB_POOL_MAX: 0 },
      { DB_POOL_MAX: 1.5 },
      { DB_CONNECTION_TIMEOUT_MS: 0 },
      { DB_IDLE_TIMEOUT_MS: -1 },
      { SHUTDOWN_TIMEOUT_MS: 0 },
    ]) {
      expect(schema.safeParse({ DATABASE_URL, ...values }).success).toBe(false);
    }
  });
  it('honors configured pool and timeout limits', () => {
    const config = schema.parse({
      DATABASE_URL,
      DB_POOL_MAX: '4',
      DB_CONNECTION_TIMEOUT_MS: '2000',
      DB_IDLE_TIMEOUT_MS: '0',
    });
    expect(databasePoolConfig(DATABASE_URL, config)).toMatchObject({
      max: 4,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 0,
    });
  });
  it('requires verified TLS in production without imposing it locally', () => {
    expect(
      schema.safeParse({ DATABASE_URL, NODE_ENV: 'production' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        DATABASE_URL,
        NODE_ENV: 'production',
        DB_SSL_MODE: 'disable',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        DATABASE_URL,
        NODE_ENV: 'production',
        DB_SSL_MODE: 'verify-full',
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        DATABASE_URL: `${DATABASE_URL}?sslmode=verify-full`,
        NODE_ENV: 'production',
      }).success,
    ).toBe(true);
  });
  it('preserves URL-based TLS and rejects conflicting explicit SSL settings', () => {
    const url = `${DATABASE_URL}?sslmode=verify-full`;
    const config = schema.parse({ DATABASE_URL: url });
    expect(databasePoolConfig(url, config)).not.toHaveProperty('ssl');
    expect(
      schema.safeParse({ DATABASE_URL: url, DB_SSL_MODE: 'verify-full' })
        .success,
    ).toBe(false);
    expect(() =>
      databasePoolConfig(url, { ...config, DB_SSL_MODE: 'verify-full' }),
    ).toThrow('Conflicting database TLS');
  });
  it('loads a mounted CA only with certificate verification enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commerce-ca-'));
    try {
      const file = join(dir, 'ca.pem');
      writeFileSync(file, 'test-ca');
      const config = schema.parse({
        DATABASE_URL,
        DB_SSL_MODE: 'verify-full',
        DB_SSL_CA_FILE: file,
      });
      expect(databasePoolConfig(DATABASE_URL, config).ssl).toEqual({
        ca: 'test-ca',
        rejectUnauthorized: true,
      });
      expect(
        schema.safeParse({ DATABASE_URL, DB_SSL_CA_FILE: file }).success,
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('limits database log information to safe error codes', () => {
    expect(
      databaseErrorCode({
        code: '28P01',
        message: DATABASE_URL,
        password: 'secret',
      }),
    ).toBe('28P01');
    expect(databaseErrorCode(new Error(DATABASE_URL))).toBe('DATABASE_ERROR');
    expect(databaseErrorCode({ code: DATABASE_URL })).toBe('DATABASE_ERROR');
  });
  it('validates migration URLs independently of application secrets and pool TLS', () => {
    expect(migrationDatabaseUrl({ DATABASE_URL })).toBe(DATABASE_URL);
    expect(() =>
      migrationDatabaseUrl({
        DATABASE_URL,
        NODE_ENV: 'production',
        DB_SSL_MODE: 'verify-full',
      }),
    ).toThrow('URL sslmode=verify-full');
    const secure = `${DATABASE_URL}?sslmode=verify-full`;
    expect(
      migrationDatabaseUrl({ DATABASE_URL: secure, NODE_ENV: 'production' }),
    ).toBe(secure);
    expect(() =>
      migrationDatabaseUrl({ DATABASE_URL: 'invalid-secret-value' }),
    ).toThrow('DATABASE_URL must name a PostgreSQL database');
  });
});
