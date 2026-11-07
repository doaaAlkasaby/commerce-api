import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';
import { z } from 'zod';

const postgresUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
    url.pathname.length > 1
  );
}, 'A PostgreSQL URL with a database name is required');

export const databaseConfigurationSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl.optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1).default(5000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10000),
  DB_SSL_MODE: z.enum(['url', 'disable', 'verify-full']).default('url'),
  DB_SSL_CA_FILE: z.string().min(1).optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1).default(30000),
});
export type DatabaseConfiguration = z.infer<typeof databaseConfigurationSchema>;

const tlsParameters = [
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslnegotiation',
];

export function validateDatabaseSecurity(
  config: DatabaseConfiguration,
  ctx: z.RefinementCtx,
) {
  if (!URL.canParse(config.DATABASE_URL)) return;
  const url = new URL(config.DATABASE_URL);
  if (
    config.DB_SSL_MODE !== 'url' &&
    tlsParameters.some((key) => url.searchParams.has(key))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['DB_SSL_MODE'],
      message: 'Use either URL TLS parameters or DB_SSL_MODE, not both.',
    });
  }
  if (config.DB_SSL_CA_FILE && config.DB_SSL_MODE !== 'verify-full') {
    ctx.addIssue({
      code: 'custom',
      path: ['DB_SSL_CA_FILE'],
      message: 'DB_SSL_CA_FILE requires DB_SSL_MODE=verify-full.',
    });
  }
  if (
    config.NODE_ENV === 'production' &&
    !(
      config.DB_SSL_MODE === 'verify-full' ||
      (config.DB_SSL_MODE === 'url' &&
        url.searchParams.get('sslmode') === 'verify-full')
    )
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['DB_SSL_MODE'],
      message:
        'Production requires verified TLS: DB_SSL_MODE=verify-full or URL sslmode=verify-full.',
    });
  }
}

export function databasePoolConfig(
  connectionString: string,
  config: DatabaseConfiguration,
): PoolConfig {
  const url = new URL(connectionString);
  if (
    config.DB_SSL_MODE !== 'url' &&
    tlsParameters.some((key) => url.searchParams.has(key))
  ) {
    throw new Error('Conflicting database TLS configuration');
  }
  return {
    connectionString,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
    ...(config.DB_SSL_MODE === 'disable' ? { ssl: false } : {}),
    ...(config.DB_SSL_MODE === 'verify-full'
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(config.DB_SSL_CA_FILE
              ? { ca: readFileSync(config.DB_SSL_CA_FILE, 'utf8') }
              : {}),
          },
        }
      : {}),
  };
}

// Database failures can contain connection details. Logs receive only a bounded code.
export function databaseErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,50}$/.test(error.code)
  )
    return error.code;
  return 'DATABASE_ERROR';
}

/** Prisma CLI uses the URL directly, independently of node-postgres pool settings. */
export function migrationDatabaseUrl(source: NodeJS.ProcessEnv): string {
  const parsed = postgresUrl.safeParse(source.DATABASE_URL);
  if (!parsed.success)
    throw new Error('DATABASE_URL must name a PostgreSQL database');
  if (
    source.NODE_ENV === 'production' &&
    new URL(parsed.data).searchParams.get('sslmode') !== 'verify-full'
  ) {
    throw new Error(
      'Production Prisma commands require URL sslmode=verify-full',
    );
  }
  return parsed.data;
}
