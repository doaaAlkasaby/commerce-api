import helmet from 'helmet';
import cors from 'cors';

import { env } from '../config/env.js';
import { globalRateLimiter } from '../config/rate-limit.js';

export const securityMiddleware = {
  helmet: helmet(),

  cors: cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  }),

  rateLimit: globalRateLimiter,
};
  