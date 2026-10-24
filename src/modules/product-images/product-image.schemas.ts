import { z } from 'zod';

export const productImageIdSchema = z.object({
  id: z.string().uuid(),
});

export const productImageProductIdSchema = z.object({
  productId: z.string().uuid(),
});

export const createProductImageSchema = z.object({
  productId: z.string().uuid(),

  storageKey: z
    .string()
    .trim()
    .min(1)
    .max(500),

  url: z
    .string()
    .trim()
    .url()
    .max(2000),

  altText: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),

  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional(),

  isPrimary: z
    .boolean()
    .optional(),
});

export const updateProductImageSchema = z.object({
  altText: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),

  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional(),
});

export const uploadProductImageSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  altText: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),
  sortOrder: z
    .union([z.string(), z.number()])
    .transform((value) =>
      value === '' ? 0 : Number(value),
    )
    .pipe(z.number().int().min(0))
    .optional()
    .default(0),
  isPrimary: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .default(false),
});

export const primaryImageSchema = z.object({
  isPrimary: z.boolean(),
});