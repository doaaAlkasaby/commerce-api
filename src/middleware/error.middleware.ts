import { metrics } from '../common/observability/metrics.js';
import type { NextFunction, Request, Response } from 'express';

import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../common/errors/app-error.js';

import { logger } from '../common/logger/logger.js';
import { env } from '../config/env.js';
import { errorDiagnostics } from '../common/logger/error-diagnostics.js';

export const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.id;
  // Parser/upload errors often carry raw bodies. Never serialize them into logs.
  if (error instanceof ZodError)
    error = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
  if (error instanceof multer.MulterError)
    error = new AppError(
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded file is too large'
        : 'Invalid upload',
      error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
      error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD',
    );
  if (error && typeof error === 'object' && 'type' in error) {
    if (
      ['charset.unsupported', 'encoding.unsupported'].includes(
        String(error.type),
      )
    )
      error = new AppError(
        'Unsupported request encoding',
        415,
        'UNSUPPORTED_MEDIA_TYPE',
      );
    else if (error.type === 'entity.too.large')
      error = new AppError(
        'Request body is too large',
        413,
        'REQUEST_BODY_TOO_LARGE',
      );
    else if (error.type === 'entity.parse.failed')
      error = new AppError('Malformed JSON request', 400, 'MALFORMED_JSON');
    else if (
      ['parameters.too.many', 'querystring.parse.rangeError'].includes(
        String(error.type),
      )
    )
      error = new AppError(
        'Request parameters exceed supported limits',
        400,
        'VALIDATION_ERROR',
      );
  }

  if (error instanceof AppError) {
    metrics.increment(
      'commerce_application_errors_total',
      `class="${error.statusCode >= 500 ? 'dependency_or_operational' : 'client'}"`,
    );
    logger.warn(
      {
        requestId,
        statusCode: error.statusCode,
        code: error.code,
        category: 'OPERATIONAL_APPLICATION_ERROR',
      },
      'Operational application error',
    );

    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      data: null,
    });

    return;
  }

  metrics.increment('commerce_application_errors_total', 'class="unexpected"');
  logger.error(
    {
      requestId,
      category: 'UNHANDLED_APPLICATION_ERROR',
      ...(env.NODE_ENV === 'development'
        ? { diagnostic: errorDiagnostics(error) }
        : {}),
    },
    'Unhandled application error',
  );

  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred.',
    code: 'INTERNAL_SERVER_ERROR',
    data: null,
  });
};
