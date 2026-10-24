import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { logger } from '../common/logger/logger.js';

export const requestLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();

    const durationMs =
      Number(endTime - startTime) / 1_000_000;

    logger.info(
      {
        requestId: req.id,
        userId: req.user?.userId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Number(
          durationMs.toFixed(2),
        ),
      },
      'HTTP request completed',
    );
  });

  next();
};