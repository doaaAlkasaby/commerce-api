import { Prisma as MoneyPrisma } from '../../generated/prisma/client.js';
import { z } from 'zod';

const moneySchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Invalid monetary value');

const couponCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .transform((value) => value.toUpperCase());

export const createCouponSchema = z
  .object({
    code: couponCodeSchema,

    discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),

    discountValue: moneySchema,

    minimumOrderAmount: moneySchema.nullable().optional(),

    maximumDiscountAmount: moneySchema.nullable().optional(),

    startsAt: z.coerce.date().nullable().optional(),

    endsAt: z.coerce.date().nullable().optional(),

    usageLimit: z.number().int().positive().nullable().optional(),

    perUserLimit: z.number().int().positive().nullable().optional(),

    isActive: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    if (
      [
        data.discountValue,
        data.minimumOrderAmount,
        data.maximumDiscountAmount,
      ].some((value) => value != null && !/^\d+(\.\d{1,4})?$/.test(value))
    )
      return;
    const discountValue = new MoneyPrisma.Decimal(data.discountValue);

    if (
      data.discountType === 'PERCENTAGE' &&
      (discountValue.lte(0) ||
        discountValue.gt(100) ||
        discountValue.decimalPlaces() > 2)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'Percentage discount must be between 0 and 100',
      });
    }

    if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'endsAt must be after startsAt',
      });
    }

    if (
      data.minimumOrderAmount !== undefined &&
      data.minimumOrderAmount !== null &&
      new MoneyPrisma.Decimal(data.minimumOrderAmount).lt(0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['minimumOrderAmount'],
        message: 'minimumOrderAmount cannot be negative',
      });
    }

    if (
      data.maximumDiscountAmount !== undefined &&
      data.maximumDiscountAmount !== null &&
      new MoneyPrisma.Decimal(data.maximumDiscountAmount).lte(0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['maximumDiscountAmount'],
        message: 'maximumDiscountAmount must be greater than zero',
      });
    }
  });

export const updateCouponSchema = z
  .object({
    code: couponCodeSchema.optional(),

    discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']).optional(),

    discountValue: moneySchema.optional(),

    minimumOrderAmount: moneySchema.nullable().optional(),

    maximumDiscountAmount: moneySchema.nullable().optional(),

    startsAt: z.coerce.date().nullable().optional(),

    endsAt: z.coerce.date().nullable().optional(),

    usageLimit: z.number().int().positive().nullable().optional(),

    perUserLimit: z.number().int().positive().nullable().optional(),

    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

export const couponIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const validateCouponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((value) => value.toUpperCase()),

  subtotal: moneySchema,
});
