import {
  AppError,
} from '../../common/errors/app-error.js';

import type {
  Request,
} from 'express';

export const getIdempotencyKey = (
  req: Request,
): string => {
  const key =
    req.header('Idempotency-Key');

  if (!key) {
    throw new AppError(
      'Idempotency-Key header is required',
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const normalized = key.trim();

  if (
    normalized.length < 16 ||
    normalized.length > 255
  ) {
    throw new AppError(
      'Invalid Idempotency-Key',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }

  return normalized;
};