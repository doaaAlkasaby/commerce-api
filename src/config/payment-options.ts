import { z } from 'zod';

const returnUrl = z
  .url()
  .max(254)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  }, 'A public HTTPS return URL without credentials is required');

export const myFatoorahSettingsSchema = z.object({
  MYFATOORAH_ENV: z.literal('sandbox').default('sandbox'),
  MYFATOORAH_API_VERSION: z.literal('v2'),
  MYFATOORAH_ACCOUNT_COUNTRY: z.literal('KWT'),
  MYFATOORAH_ACCOUNT_CURRENCY: z.literal('KWD'),
  MYFATOORAH_API_TOKEN: z.string().trim().min(1),
  MYFATOORAH_WEBHOOK_SECRET: z.string().min(1),
  MYFATOORAH_CALLBACK_URL: returnUrl,
  MYFATOORAH_ERROR_URL: returnUrl,
  MYFATOORAH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1)
    .max(30000)
    .default(10000),
});
export type MyFatoorahSettings = z.infer<typeof myFatoorahSettingsSchema>;
export const paymentConfigurationSchema = myFatoorahSettingsSchema
  .partial()
  .extend({
    PAYMENT_PROVIDER: z.enum(['NONE', 'MYFATOORAH', 'MOCK']).default('NONE'),
    MOCK_CHECKOUT_BASE_URL: z.string().url().optional(),
    MOCK_CHECKOUT_SECRET: z.string().trim().min(32, 'MOCK_CHECKOUT_SECRET must be at least 32 characters').optional(),
  });
export type PaymentConfiguration = z.infer<typeof paymentConfigurationSchema>;
export function validatePaymentConfiguration(
  config: PaymentConfiguration,
  ctx: z.RefinementCtx,
) {
  if (config.PAYMENT_PROVIDER === 'MOCK') {
    if (process.env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'Mock payment provider is prohibited in production',
      });
    }
    const secret = process.env.MOCK_CHECKOUT_SECRET || config.MOCK_CHECKOUT_SECRET;
    if (!secret || secret.trim().length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOCK_CHECKOUT_SECRET'],
        message: 'MOCK_CHECKOUT_SECRET must be configured and at least 32 characters long when PAYMENT_PROVIDER is MOCK',
      });
    }
    return;
  }
  if (config.PAYMENT_PROVIDER !== 'MYFATOORAH') return;
  const result = myFatoorahSettingsSchema.safeParse(config);
  if (!result.success)
    for (const issue of result.error.issues)
      ctx.addIssue({
        code: 'custom',
        path: issue.path,
        message:
          'Required MyFatoorah sandbox configuration is missing or invalid',
      });
}
