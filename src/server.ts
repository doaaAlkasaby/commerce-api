import { readiness } from './common/observability/operations.js';
import { installFatalHandlers } from './common/lifecycle/fatal-errors.js';
import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { databaseErrorCode } from './config/database-options.js';
import { shutdownApplication } from './common/lifecycle/shutdown.js';
import { logger } from './common/logger/logger.js';

let server: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();
    if (shuttingDown) return;
    logger.info('Database connection established');
    server = app.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, environment: env.NODE_ENV },
        'Commerce API started',
      );
    });
    server.on('error', () => {
      process.exitCode = 1;
      void shutdown('HTTP_LISTENER_ERROR');
    });
  } catch (error) {
    logger.error(
      { code: databaseErrorCode(error) },
      'Failed to start application',
    );
    try {
      await shutdownApplication(
        undefined,
        disconnectDatabase,
        env.SHUTDOWN_TIMEOUT_MS,
      );
    } catch {
      /* Startup still exits unsuccessfully. */
    }
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  readiness.draining = true;
  logger.info({ signal }, 'Shutdown signal received');
  try {
    await shutdownApplication(
      server,
      disconnectDatabase,
      env.SHUTDOWN_TIMEOUT_MS,
    );
    logger.info('HTTP server and database connections closed');
    process.exit(process.exitCode === 1 ? 1 : 0);
  } catch (error) {
    logger.error(
      { code: databaseErrorCode(error) },
      'Application shutdown failed or timed out',
    );
    process.exit(1);
  }
};
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
installFatalHandlers(() => {
  void shutdown('FATAL_ERROR');
});
void startServer();
