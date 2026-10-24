import { z } from 'zod';

import { paginationQuerySchema } from '../../common/pagination/pagination.js';

export const collectionIdParamsSchema = z.object({
  id: z.uuid(),
});

export const collectionProductParamsSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
});

const productCollectionFields = {
  name: z
    .string()
    .trim()
    .min(1, 'Collection name is required')
    .max(150, 'Collection name must not exceed 150 characters'),

  slug: z
    .string()
    .trim()
    .min(1, 'Collection slug is required')
    .max(180, 'Collection slug must not exceed 180 characters')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug must contain lowercase letters, numbers and hyphens only',
    ),

  description: z
    .string()
    .trim()
    .max(2000, 'Description must not exceed 2000 characters')
    .nullable()
    .optional(),

  imageStorageKey: z
    .string()
    .trim()
    .max(500, 'Image storage key must not exceed 500 characters')
    .nullable()
    .optional(),

  imageUrl: z
    .string()
    .url('Invalid image URL')
    .max(2000, 'Image URL must not exceed 2000 characters')
    .nullable()
    .optional(),

  isActive: z.boolean().optional(),

  sortOrder: z.number().int().min(0).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
};

const validateCollectionDateRange = (
  data: {
    startsAt?: Date | null | undefined;
    endsAt?: Date | null | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'endsAt must be after startsAt',
    });
  }
};

export const createProductCollectionSchema = z
  .object(productCollectionFields)
  .superRefine(validateCollectionDateRange);

export const updateProductCollectionSchema = z
  .object(productCollectionFields)
  .partial()
  .superRefine(validateCollectionDateRange);

export const addProductToCollectionSchema = z.object({
  productId: z.uuid(),

  sortOrder: z.number().int().min(0).optional(),
});

export const updateCollectionProductOrderSchema = z.object({
  sortOrder: z.number().int().min(0),
});

export const collectionProductsQuerySchema = paginationQuerySchema;

export const collectionProductsParamsSchema = z.object({
  id: z.uuid(),
});

export type CollectionProductsParams = z.infer<
  typeof collectionProductsParamsSchema
>;
