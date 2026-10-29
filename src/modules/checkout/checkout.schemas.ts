import { z } from 'zod';
import {
  PaymentMethod,
  PaymentProvider,
} from '../../generated/prisma/client.js';

const options = z.object({
  shippingAddressId: z.string().uuid(),
  billingAddressId: z.string().uuid().optional(),
  billingSameAsShipping: z.boolean().optional().default(true),
  shippingMethodCode: z.string().trim().min(1).max(100).optional(),
  couponCode: z.string().trim().min(1).max(100).optional(),
});
const validateBilling = (
  value: z.infer<typeof options>,
  ctx: z.RefinementCtx,
) => {
  if (!value.billingSameAsShipping && !value.billingAddressId)
    ctx.addIssue({
      code: 'custom',
      path: ['billingAddressId'],
      message:
        'billingAddressId is required when billingSameAsShipping is false',
    });
  if (value.billingSameAsShipping && value.billingAddressId)
    ctx.addIssue({
      code: 'custom',
      path: ['billingAddressId'],
      message:
        'billingAddressId should not be provided when billingSameAsShipping is true',
    });
};
export const checkoutSchema = options
  .extend({
    shippingMethodId: z.string().uuid().optional(),
    paymentMethod: z.enum(Object.values(PaymentMethod)),
    paymentProvider: z.enum(Object.values(PaymentProvider)).optional(),
    // Compatibility only; checkout currency remains server-controlled.
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
  })
  .superRefine(validateBilling);
export const checkoutPreviewSchema = options
  .strict()
  .superRefine(validateBilling);
export type CheckoutSchemaInput = z.infer<typeof checkoutSchema>;
export type CheckoutPreviewSchemaInput = z.infer<typeof checkoutPreviewSchema>;
