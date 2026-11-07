import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from './env.js';
import { PostgresRateStore } from '../common/rate-limit/postgres-rate-store.js';

const shared =
  env.RATE_LIMIT_STORE === 'postgres' ||
  (env.RATE_LIMIT_STORE === 'auto' && env.NODE_ENV === 'production');
const store = (prefix: string) =>
  shared ? { store: new PostgresRateStore(prefix) } : {};
const message = (auth = false) => ({
  success: false,
  message: auth
    ? 'Too many authentication attempts, please try again later'
    : 'Too many requests, please try again later',
  code: auth ? 'AUTH_RATE_LIMIT_EXCEEDED' : 'RATE_LIMIT_EXCEEDED',
  data: null,
});
export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message(),
  ...store('global'),
});
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message(true),
  ...store('auth'),
  keyGenerator: (req) =>
    `${req.path.toLowerCase().replace(/\/+$/, '')}:${ipKeyGenerator(req.ip ?? 'unknown')}`,
});
export const sensitiveRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message(),
  ...store('sensitive'),
  keyGenerator: (req) =>
    req.user
      ? `${req.tenant?.tenantId ?? 'account'}:${req.user.userId}`
      : ipKeyGenerator(req.ip ?? 'unknown'),
});

export const administrativeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message(),
  ...store('administrative'),
  keyGenerator: (req) =>
    req.user
      ? `${req.tenant?.tenantId ?? 'account'}:${req.user.userId}`
      : ipKeyGenerator(req.ip ?? 'unknown'),
});
