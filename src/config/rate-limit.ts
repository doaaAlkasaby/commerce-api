import rateLimit from 'express-rate-limit';

import { env } from './env.js';

export const globalRateLimiter =
  rateLimit({
    windowMs:
      env.RATE_LIMIT_WINDOW_MS,

    limit:
      env.RATE_LIMIT_MAX_REQUESTS,

    standardHeaders: 'draft-8',
    legacyHeaders: false,

    message: {
      success: false,
      message:
        'Too many requests, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
      data: null,
    },
  });

export const authRateLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,

    limit: 10,

    standardHeaders: 'draft-8',
    legacyHeaders: false,

    message: {
      success: false,
      message:
        'Too many authentication attempts, please try again later',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      data: null,
    },
  });