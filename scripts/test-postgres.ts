import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';

export function verificationDatabaseSettings(source: NodeJS.ProcessEnv) {
  if (!source.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback.',
    );
  }
  const template = new URL(source.TEST_DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(template.protocol) ||
    !decodeURIComponent(template.pathname).toLowerCase().includes('test')
  ) {
    throw new Error('TEST_DATABASE_URL must name a PostgreSQL test database.');
  }
  if (source.NODE_ENV === 'production') {
    throw new Error(
      'The disposable test runner cannot run with NODE_ENV=production.',
    );
  }
  const databaseName = `commerce_api_test_phase1b_${randomUUID().replaceAll('-', '')}`;
  const database = new URL(template);
  database.pathname = `/${databaseName}`;
  const admin = new URL(template);
  admin.pathname = '/postgres';
  // Prisma-specific query options do not belong to the maintenance connection.
  admin.searchParams.delete('schema');
  const env: NodeJS.ProcessEnv = {
    ...source,
    NODE_ENV: 'test',
    DATABASE_URL: database.href,
    TEST_DATABASE_URL: database.href,
    RUN_CHECKOUT_INTEGRATION: '1',
    RUN_COUPON_CONCURRENCY_INTEGRATION: '1',
    RUN_INVENTORY_CONCURRENCY_INTEGRATION: '1',
    RUN_RESERVATION_LIFECYCLE_INTEGRATION: '1',
    RUN_TENANT_INTEGRATION: '1',
  };
  return { databaseName, adminUrl: admin.href, env };
}

export function disposableDatabaseIdentifier(name: string): string {
  if (!/^commerce_api_test_phase1b_[a-f0-9]{32}$/.test(name)) {
    throw new Error('Refusing a non-disposable database identifier');
  }
  return `"${name}"`;
}

function command(
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(program, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand();
      else reject(new Error(`${program} failed (${signal ?? code}).`));
    });
  });
}

async function main() {
  const { databaseName, adminUrl, env } = verificationDatabaseSettings(
    process.env,
  );
  const admin = new pg.Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  let created = false;
  try {
    await admin.connect();
    // Identifier contains only the fixed prefix and UUID hex, never user input.
    await admin.query(
      `CREATE DATABASE ${disposableDatabaseIdentifier(databaseName)}`,
    );
    created = true;
    console.log(`Disposable PostgreSQL database: ${databaseName}`);
    await command(
      'node_modules/.bin/prisma',
      ['migrate', 'deploy', '--config', 'prisma7.config.ts'],
      env,
    );
    await command(
      'node_modules/.bin/prisma',
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
        '--config',
        'prisma7.config.ts',
      ],
      env,
    );
    if (!process.argv.slice(2).includes('--schema-only')) {
      await command(
        'npm',
        ['test', '--', '--no-file-parallelism', ...process.argv.slice(2)],
        env,
      );
    }
  } finally {
    try {
      if (created) {
        // No existing database is ever reset, altered, or marked as migrated.
        await admin.query(
          `DROP DATABASE ${disposableDatabaseIdentifier(databaseName)} WITH (FORCE)`,
        );
        console.log(`Removed disposable database: ${databaseName}`);
      }
    } finally {
      await admin.end();
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'PostgreSQL verification failed.',
    );
    process.exitCode = 1;
  });
}
