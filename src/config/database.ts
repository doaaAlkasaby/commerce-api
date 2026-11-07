import { metrics } from '../common/observability/metrics.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

import { env } from './env.js';
import { databasePoolConfig, databaseErrorCode } from './database-options.js';
import { logger } from '../common/logger/logger.js';

const adapter = new PrismaPg(databasePoolConfig(env.DATABASE_URL, env), {
  schema: new URL(env.DATABASE_URL).searchParams.get('schema') ?? 'public',
  onPoolError: (error) => {
    metrics.increment(
      'commerce_database_connectivity_failures_total',
      'source="pool"',
    );
    logger.error({ code: databaseErrorCode(error) }, 'Database pool error');
  },
  onConnectionError: (error) => {
    metrics.increment(
      'commerce_database_connectivity_failures_total',
      'source="connection"',
    );
    logger.error(
      { code: databaseErrorCode(error) },
      'Database connection error',
    );
  },
});

export const prisma = new PrismaClient({
  adapter,
});

export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    // The driver pool is lazy: verify reachability before accepting HTTP requests.
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    metrics.increment(
      'commerce_database_connectivity_failures_total',
      'source="startup"',
    );
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
