import pino from 'pino';
import { requestContext } from '../observability/context.js';

import { env } from '../../config/env.js';

export const loggerOptions: pino.LoggerOptions = {
  mixin: () => ({ ...requestContext.getStore() }),
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',

  base: {
    service: 'commerce-api',
    environment: env.NODE_ENV,
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'accessToken',
      'refreshToken',
      'token',
      '*.password',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
      'req.body',
      'req.query',
      'headers.authorization',
      'headers.cookie',
      'OPS_METRICS_TOKEN',
      '*.OPS_METRICS_TOKEN',
      'MYFATOORAH_API_TOKEN',
      'MYFATOORAH_WEBHOOK_SECRET',
      '*.MYFATOORAH_API_TOKEN',
      '*.MYFATOORAH_WEBHOOK_SECRET',
      'req.headers["myfatoorah-signature"]',
    ],
    censor: '[REDACTED]',
  },
};

export const logger = pino(loggerOptions);
