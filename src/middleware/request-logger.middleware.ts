import { metrics, routeFamily } from '../common/observability/metrics.js';
import { env } from '../config/env.js';
import type { NextFunction, Request, Response } from 'express';

import { logger } from '../common/logger/logger.js';

export const requestLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startTime = process.hrtime.bigint();

  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const statusCode = res.writableFinished ? res.statusCode : 499;
    const endTime = process.hrtime.bigint();

    const durationMs = Number(endTime - startTime) / 1_000_000;

    const route = routeFamily(
      req.originalUrl.split('?')[0] ?? '',
      env.API_PREFIX,
    );
    metrics.http(req.method, route, statusCode, durationMs / 1000);
    logger.info(
      {
        requestId: req.id,
        route,
        tenantId: req.tenant?.tenantId,
        userId: req.user?.userId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      },
      'HTTP request completed',
    );
  };
  res.once('finish', record);
  res.once('close', record);

  next();
};
