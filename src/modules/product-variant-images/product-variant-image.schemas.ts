import { z } from 'zod';

export const productVariantIdParamsSchema = z.object({
  variantId: z.uuid(),
});

export const productVariantImageIdParamsSchema = z.object({
  id: z.uuid(),
});

export const updateProductVariantImageSchema = z.object({
  altText: z.string().trim().max(500).nullable().optional(),

  sortOrder: z.number().int().min(0).optional(),
});

export const createProductVariantImageSchema = z.object({
  altText: z.string().trim().max(500).nullable().optional(),

  sortOrder: z.number().int().min(0).optional(),

  isPrimary: z.boolean().optional(),
});

const multipartSortOrderSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  z.number().int().min(0).optional(),
);

const multipartBooleanSchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean().optional());

export const uploadProductVariantImageSchema = z.object({
  variantId: z.uuid(),
  altText: z.string().trim().max(500).nullable().optional(),
  sortOrder: multipartSortOrderSchema,
  isPrimary: multipartBooleanSchema,
});
