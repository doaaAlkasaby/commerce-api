import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

import { env } from './env.js';
import { databasePoolConfig } from './database-options.js';

if (!env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for tests');
}

const testUrl = new URL(env.TEST_DATABASE_URL);
const testDbName = testUrl.pathname.replace(/^\//, '');

if (testDbName === 'commerce_api_dev' || testDbName.endsWith('_dev')) {
  throw new Error(
    `SECURITY GUARD REJECTION: TEST_DATABASE_URL must point exclusively to an isolated test database (e.g. "commerce_api_test"), not development database ("${testDbName}").`,
  );
}

const adapter = new PrismaPg(databasePoolConfig(env.TEST_DATABASE_URL, env), {
  schema: testUrl.searchParams.get('schema') ?? 'public',
});

export const testPrisma = new PrismaClient({
  adapter,
});
