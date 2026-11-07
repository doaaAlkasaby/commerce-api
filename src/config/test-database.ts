import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

import { env } from './env.js';
import { databasePoolConfig } from './database-options.js';

if (!env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for tests');
}

const adapter = new PrismaPg(databasePoolConfig(env.TEST_DATABASE_URL, env), {
  schema: new URL(env.TEST_DATABASE_URL).searchParams.get('schema') ?? 'public',
});

export const testPrisma = new PrismaClient({
  adapter,
});
