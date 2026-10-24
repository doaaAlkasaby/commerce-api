import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  API_PREFIX: z.string().min(1).default('/api/v1'),

  DATABASE_URL: z.url(),

  TEST_DATABASE_URL: z.url().optional(),

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

    JWT_ACCESS_SECRET: z
      .string()
      .min(32),

    JWT_ACCESS_EXPIRES_IN: z
      .string()
      .default('15m'),

    REFRESH_TOKEN_EXPIRES_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(30),

    EMAIL_VERIFICATION_EXPIRES_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(24),

    PASSWORD_RESET_EXPIRES_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(1),

    UPLOAD_DIR: z
      .string()
      .default('./uploads'),

    UPLOAD_BASE_URL: z
      .string()
      .url()
      .default('http://localhost:3000/uploads'),

    MAX_IMAGE_SIZE_MB: z.coerce
      .number()
      .int()
      .positive()
      .default(5),

});


const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment configuration:');

  console.error(parsedEnv.error.format());

  process.exit(1);
}

export const env = parsedEnv.data;
