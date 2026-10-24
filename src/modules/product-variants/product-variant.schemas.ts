import { z } from 'zod';

const moneySchema = z
  .string()
  .regex(
    /^\d+(\.\d{1,2})?$/,
    'Invalid monetary value',
  );

const discountSchema = z
  .object({
    type: z.enum([
      'PERCENTAGE',
      'FIXED_AMOUNT',
    ]),

    value: moneySchema,

    startsAt: z.coerce
      .date()
      .nullable()
      .optional(),

    endsAt: z.coerce
      .date()
      .nullable()
      .optional(),
  })
  .superRefine((discount, ctx) => {
    const amount = Number(discount.value);

    if (
      discount.type === 'PERCENTAGE' &&
      (amount <= 0 || amount > 100)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message:
          'Percentage discount must be greater than 0 and at most 100',
      });
    }

    if (
      discount.type === 'FIXED_AMOUNT' &&
      amount <= 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message:
          'Fixed discount must be greater than 0',
      });
    }

    if (
      discount.startsAt &&
      discount.endsAt &&
      discount.startsAt > discount.endsAt
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message:
          'Discount end date must be after start date',
      });
    }
  });

export const createProductVariantSchema =
  z.object({
    productId: z.uuid(),

    sku: z
      .string()
      .trim()
      .min(1)
      .max(100),

    price: moneySchema
      .nullable()
      .optional(),

    isActive: z
      .boolean()
      .optional(),

    discount: discountSchema
      .nullable()
      .optional(),

    attributeValueIds: z
      .array(z.uuid())
      .min(
        1,
        'At least one attribute value is required',
      )
      .refine(
        (ids) =>
          new Set(ids).size === ids.length,
        {
          message:
            'Duplicate attribute values are not allowed',
        },
      ),
  });

export const updateProductVariantSchema =
  z.object({
    sku: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    price: moneySchema
      .nullable()
      .optional(),

    isActive: z
      .boolean()
      .optional(),

    discount: discountSchema
      .nullable()
      .optional(),

    attributeValueIds: z
      .array(z.uuid())
      .min(1)
      .refine(
        (ids) =>
          new Set(ids).size === ids.length,
        {
          message:
            'Duplicate attribute values are not allowed',
        },
      )
      .optional(),
  });

export const productVariantIdParamsSchema =
  z.object({
    id: z.uuid(),
  });

export const productIdParamsSchema =
  z.object({
    productId: z.uuid(),
  });