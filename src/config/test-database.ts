import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

import { env } from './env.js';

if (!env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is required for tests',
  );
}

const adapter = new PrismaPg({
  connectionString: env.TEST_DATABASE_URL,
});

export const testPrisma = new PrismaClient({
  adapter,
});