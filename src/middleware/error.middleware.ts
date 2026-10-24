import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../common/errors/app-error.js';

import { logger } from '../common/logger/logger.js';

export const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.id;

  if (error instanceof AppError) {
    logger.warn(
      {
        requestId,
        statusCode: error.statusCode,
        code: error.code,
        error: error.message,
      },
      'Operational application error',
    );

    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      data: null,
    });

    return;
  }

  logger.error(
    {
      requestId,
      error,
    },
    'Unhandled application error',
  );

  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred.',
    code: 'INTERNAL_SERVER_ERROR',
    data: null,
  });
};
