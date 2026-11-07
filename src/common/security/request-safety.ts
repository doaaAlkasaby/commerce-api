import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export const requestSafety: RequestHandler = (req, res, next) => {
  if (req.headers.authorization || req.path.startsWith('/api/v1/auth'))
    res.setHeader('Cache-Control', 'no-store');
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: req.body, depth: 0 },
  ];
  while (queue.length) {
    const current = queue.pop();
    if (!current) break;
    if (current.depth > 64)
      throw new AppError(
        'Request nesting exceeds supported limit',
        400,
        'VALIDATION_ERROR',
      );
    if (current.value && typeof current.value === 'object') {
      for (const [key, value] of Object.entries(current.value)) {
        if (
          key === '__proto__' ||
          (key === 'constructor' &&
            value &&
            typeof value === 'object' &&
            Object.hasOwn(value, 'prototype'))
        )
          throw new AppError(
            'Unsafe request properties',
            400,
            'VALIDATION_ERROR',
          );
        queue.push({ value, depth: current.depth + 1 });
      }
    }
  }
  next();
};
