import { createHash } from 'node:crypto';
import { securityConfigurationSchema } from './security-options.js';
import { workerConfigurationSchema } from './worker-options.js';
import {
  emailConfigurationSchema,
  validateEmailConfiguration,
} from './email-options.js';
import 'dotenv/config';
import { z } from 'zod';
import {
  paymentConfigurationSchema,
  validatePaymentConfiguration,
} from './payment-options.js';
import {
  databaseConfigurationSchema,
  validateDatabaseSecurity,
} from './database-options.js';

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    OPS_METRICS_TOKEN: z
      .string()
      .min(32)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    WORKER_OPS_PORT: z.coerce.number().int().min(0).max(65535).default(0),
    OPS_BIND_HOST: z.string().trim().min(1).default('127.0.0.1'),

    PORT: z.coerce.number().int().positive().default(3000),

    API_PREFIX: z.string().min(1).default('/api/v1'),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

    BODY_LIMIT: z.string().default('1mb'),

    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value) => value === 'true'),

    ENABLE_API_DOCS: z
      .string()
      .default('true')
      .transform((value) => value === 'true'),

    JWT_ACCESS_SECRET: z.string().min(32),

    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),

    REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),

    EMAIL_VERIFICATION_EXPIRES_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(24),

    PASSWORD_RESET_EXPIRES_HOURS: z.coerce.number().int().positive().default(1),

    SECURITY_FINGERPRINT_SECRET: z
      .string()
      .trim()
      .min(32)
      .default('default_secure_fingerprint_secret_min_32_chars_long_for_security'),

    GOOGLE_APPLICATION_CREDENTIALS: z.string().trim().optional(),
    FIREBASE_PROJECT_ID: z.string().trim().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().trim().optional(),
    FIREBASE_PRIVATE_KEY: z.string().trim().optional(),

    NOTIFICATION_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
    NOTIFICATION_WORKER_LEASE_MS: z.coerce.number().int().positive().default(30000),
    NOTIFICATION_WORKER_MAX_RETRIES: z.coerce.number().int().positive().default(5),

    UPLOAD_DIR: z.string().default('./uploads'),

    UPLOAD_BASE_URL: z.string().url().default('http://localhost:3000/uploads'),

    MAX_IMAGE_SIZE_MB: z.coerce.number().int().positive().default(5),
  })
  .extend(securityConfigurationSchema.shape)
  .extend(workerConfigurationSchema.shape)
  .extend(emailConfigurationSchema.shape)
  .extend(databaseConfigurationSchema.shape)
  .extend(paymentConfigurationSchema.shape)
  .superRefine((config, ctx) => {
    if (
      config.NODE_ENV === 'production' &&
      (config.JWT_ACCESS_SECRET.startsWith('replace-') ||
        createHash('sha256').update(config.JWT_ACCESS_SECRET).digest('hex') ===
          '3ffc452381aa1f1b79bed9d2f0c29150c201ff30190ce1ab3297bedc32a11b17')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message:
          'Production requires a private independently generated signing key',
      });
    if (
      config.NODE_ENV === 'production' &&
      config.RATE_LIMIT_STORE === 'memory'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_STORE'],
        message: 'Production requires shared rate limiting',
      });
    if (
      config.CORS_ORIGINS.some(
        (origin) =>
          origin === '*' ||
          origin === 'null' ||
          !URL.canParse(origin) ||
          !['http:', 'https:'].includes(new URL(origin).protocol),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS requires explicit HTTP(S) origins',
      });
  })
  .superRefine(validateDatabaseSecurity)
  .superRefine(validateEmailConfiguration)
  .superRefine(validatePaymentConfiguration);

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment configuration:');

  console.error(
    parsedEnv.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  );

  process.exit(1);
}

export const env = parsedEnv.data;
