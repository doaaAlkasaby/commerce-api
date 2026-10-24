import app from './app.js';

import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

import { logger } from './common/logger/logger.js';

let server: ReturnType<typeof app.listen> | undefined;

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();

    logger.info('Database connection established');

    server = app.listen(env.PORT, () => {
      logger.info(
        {
          port: env.PORT,
          environment: env.NODE_ENV,
        },
        'Commerce API started',
      );
    });
  } catch (error) {
    logger.error(
      {
        error,
      },
      'Failed to start application',
    );

    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  logger.info(
    {
      signal,
    },
    'Shutdown signal received',
  );

  if (server) {
    server.close(async (error) => {
      if (error) {
        logger.error(
          {
            error,
          },
          'Error while closing HTTP server',
        );

        process.exit(1);
      }

      try {
        await disconnectDatabase();

        logger.info('Database connection closed');
        logger.info('HTTP server closed');

        process.exit(0);
      } catch (disconnectError) {
        logger.error(
          {
            error: disconnectError,
          },
          'Error while disconnecting database',
        );

        process.exit(1);
      }
    });
  } else {
    await disconnectDatabase();
    process.exit(0);
  }
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

void startServer();
