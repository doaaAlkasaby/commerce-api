import express from 'express';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { notificationPushWorker } from './modules/notifications/notification-push.worker.js';

export interface SupervisedWorker {
  name: string;
  crashCategory: string;
  run: (signal: AbortSignal) => Promise<void>;
}

export async function superviseWorkers(
  workers: SupervisedWorker[],
  controller: AbortController,
  onUnexpectedExit: (reason: string) => void,
): Promise<{ failed: boolean }> {
  let failed = false;

  const triggerFailure = (reason: string) => {
    failed = true;
    onUnexpectedExit(reason);
  };

  await Promise.allSettled(
    workers.map(async (worker) => {
      try {
        await worker.run(controller.signal);
        if (!controller.signal.aborted) {
          logger.error(
            { category: worker.crashCategory, worker: worker.name },
            `${worker.name} terminated unexpectedly without shutdown signal`,
          );
          triggerFailure(`${worker.crashCategory}_EXITED`);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          logger.error(
            { category: worker.crashCategory, worker: worker.name, error },
            `${worker.name} encountered unhandled crash`,
          );
          triggerFailure(worker.crashCategory);
        } else {
          logger.error(
            { category: worker.crashCategory, worker: worker.name, error },
            `${worker.name} failed during shutdown`,
          );
          failed = true;
        }
      }
    }),
  );

  return { failed };
}

export async function runStandaloneWorker(): Promise<void> {
  let operationalServer: Server | undefined;
  const controller = new AbortController();
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const shutdownOnce = () => {
    shutdownPromise ??= shutdownApplication(
      operationalServer,
      disconnectDatabase,
      env.SHUTDOWN_TIMEOUT_MS,
    );
    return shutdownPromise;
  };

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

  installFatalHandlers(() => {
    process.exitCode = 1;
    stop('FATAL_ERROR');
  });
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
    logger.info(
      { concurrency: env.WORKER_CONCURRENCY },
      'Background workers ready',
    );

    const { failed } = await superviseWorkers(
      [
        {
          name: 'RecoveryWorker',
          crashCategory: 'RECOVERY_WORKER_CRASH',
          run: (signal) => new RecoveryWorker().run(signal),
        },
        {
          name: 'NotificationPushWorker',
          crashCategory: 'PUSH_WORKER_CRASH',
          run: (signal) => notificationPushWorker.run(signal),
        },
      ],
      controller,
      (reason) => {
        process.exitCode = 1;
        stop(reason);
      },
    );

    if (failed) {
      process.exitCode = 1;
    }

    await shutdownOnce();
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
      await shutdownOnce();
    } catch {
      /* Exit unsuccessfully; leases remain durable. */
    }
    if (shutdownTimer) clearTimeout(shutdownTimer);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await runStandaloneWorker();
}
