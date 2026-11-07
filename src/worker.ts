import express from 'express';
import type { Server } from 'node:http';
import {
  operationalRouter,
  readiness,
} from './common/observability/operations.js';
import { shutdownApplication } from './common/lifecycle/shutdown.js';
import { installFatalHandlers } from './common/lifecycle/fatal-errors.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { logger } from './common/logger/logger.js';
import { RecoveryWorker } from './modules/recovery/recovery.worker.js';

let operationalServer: Server | undefined;
const controller = new AbortController();
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
const stop = (signal: string) => {
  if (controller.signal.aborted) return;
  logger.info({ signal }, 'Recovery worker draining');
  readiness.draining = true;
  controller.abort();
  shutdownTimer = setTimeout(() => {
    logger.error(
      { category: 'WORKER_SHUTDOWN_TIMEOUT' },
      'Recovery leases will be recovered after shutdown timeout',
    );
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  shutdownTimer.unref();
};
installFatalHandlers(() => stop('FATAL_ERROR'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
try {
  if (env.WORKER_CONCURRENCY + 2 > env.DB_POOL_MAX)
    throw new Error(
      'Worker concurrency requires two spare database connections',
    );
  if (
    env.WORKER_RETRY_MAX_MS < env.WORKER_RETRY_BASE_MS ||
    env.WORKER_LEASE_MS < (env.MYFATOORAH_TIMEOUT_MS ?? 10000) + 10000 ||
    env.WORKER_INITIATION_GRACE_MS <
      (env.MYFATOORAH_TIMEOUT_MS ?? 10000) + 10000
  )
    throw new Error('Worker timing configuration is unsafe');
  await connectDatabase();
  if (env.WORKER_OPS_PORT && !controller.signal.aborted) {
    const ops = express();
    ops.disable('x-powered-by');
    ops.use('/ops', operationalRouter());
    operationalServer = ops.listen(env.WORKER_OPS_PORT, env.OPS_BIND_HOST);
    operationalServer.on('error', () => {
      process.exitCode = 1;
      stop('OPS_LISTENER_ERROR');
    });
  }
  logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'Recovery worker ready');
  await new RecoveryWorker().run(controller.signal);
  await shutdownApplication(
    operationalServer,
    disconnectDatabase,
    env.SHUTDOWN_TIMEOUT_MS,
  );
  if (shutdownTimer) clearTimeout(shutdownTimer);
  logger.info('Recovery worker stopped');
} catch {
  logger.error(
    { category: 'WORKER_STARTUP_OR_SHUTDOWN_FAILED' },
    'Recovery worker failed',
  );
  try {
    readiness.draining = true;
    controller.abort();
    await shutdownApplication(
      operationalServer,
      disconnectDatabase,
      env.SHUTDOWN_TIMEOUT_MS,
    );
  } catch {
    /* Exit unsuccessfully; leases remain durable. */
  }
  if (shutdownTimer) clearTimeout(shutdownTimer);
  process.exit(1);
}
