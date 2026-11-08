import { z } from 'zod';

export const emailConfigurationSchema = z.object({
  EMAIL_DELIVERY_MODE: z
    .enum(['disabled', 'development_file'])
    .default('disabled'),
  EMAIL_DEVELOPMENT_OUTBOX_DIR: z.string().min(1).optional(),
});
export function validateEmailConfiguration(
  config: z.infer<typeof emailConfigurationSchema> & { NODE_ENV: string },
  ctx: z.RefinementCtx,
) {
  if (
    config.EMAIL_DELIVERY_MODE === 'development_file' &&
    (config.NODE_ENV === 'production' || !config.EMAIL_DEVELOPMENT_OUTBOX_DIR)
  )
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_DELIVERY_MODE'],
      message:
        'Development email requires a private outbox path and a non-production environment',
    });
}
