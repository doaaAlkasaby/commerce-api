import { z } from 'zod';
import {
  PaymentMethod,
  PaymentProvider,
} from '../../generated/prisma/client.js';

const paymentMethods = Object.values(
  PaymentMethod,
) as [
  PaymentMethod,
  ...PaymentMethod[],
];

const paymentProviders = Object.values(
  PaymentProvider,
) as [
  PaymentProvider,
  ...PaymentProvider[],
];

export const checkoutSchema = z
  .object({
    shippingAddressId: z.string().uuid(),

    billingAddressId: z
      .string()
      .uuid()
      .optional(),

    billingSameAsShipping: z
      .boolean()
      .optional()
      .default(true),

    couponCode: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    paymentMethod: z.enum(paymentMethods),

    paymentProvider: z
      .enum(paymentProviders)
      .optional(),

    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) =>
        value.toUpperCase(),
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.billingSameAsShipping === false &&
      !value.billingAddressId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingAddressId'],
        message:
          'billingAddressId is required when billingSameAsShipping is false',
      });
    }

    if (
      value.billingSameAsShipping === true &&
      value.billingAddressId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingAddressId'],
        message:
          'billingAddressId should not be provided when billingSameAsShipping is true',
      });
    }
  });

export type CheckoutSchemaInput =
  z.infer<typeof checkoutSchema>;