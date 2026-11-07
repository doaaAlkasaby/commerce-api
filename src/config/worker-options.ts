import { z } from 'zod';

export const workerConfigurationSchema = z.object({
  RESERVATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(900),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  WORKER_SCAN_BATCH: z.coerce.number().int().min(1).max(500).default(100),
  WORKER_LEASE_MS: z.coerce.number().int().min(5000).max(600000).default(60000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(12),
  WORKER_RETRY_BASE_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .default(5000),
  WORKER_RETRY_MAX_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(86400000)
    .default(900000),
  WORKER_INITIATION_GRACE_MS: z.coerce
    .number()
    .int()
    .min(30000)
    .max(86400000)
    .default(120000),
});
export type WorkerConfiguration = z.infer<typeof workerConfigurationSchema>;
