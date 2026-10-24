import { z } from 'zod';

export const createProductAttributeSchema = z.object({
  productId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1, 'Attribute name is required')
    .max(100, 'Attribute name must not exceed 100 characters'),
  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional(),
});

export const updateProductAttributeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),

  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional(),
});

export const createProductAttributeValueSchema = z.object({
  attributeId: z.uuid(),

  value: z
    .string()
    .trim()
    .min(1, 'Attribute value is required')
    .max(100, 'Attribute value must not exceed 100 characters'),

  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional(),
});

export const updateProductAttributeValueSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),

  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional(),
});

export const productAttributeIdParamsSchema = z.object({
  id: z.uuid(),
});

export const productAttributeValueIdParamsSchema = z.object({
  valueId: z.uuid(),
});

export const productIdParamsSchema = z.object({
  productId: z.uuid(),
});

export const attributeIdParamsSchema = z.object({
  attributeId: z.uuid(),
});