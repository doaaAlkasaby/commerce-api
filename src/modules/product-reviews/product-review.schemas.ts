import { z } from 'zod';

export const productReviewProductIdParamSchema = z.object({
  productId: z.uuid(),
});

export const productReviewIdParamSchema = z.object({
  productId: z.uuid(),
  reviewId: z.uuid(),
});

export const createProductReviewSchema = z
  .object({
    rating: z
      .number()
      .int('Rating must be an integer')
      .min(1, 'Rating must be at least 1')
      .max(5, 'Rating must not exceed 5'),

    title: z
      .string()
      .trim()
      .min(1, 'Review title cannot be empty')
      .max(200, 'Review title must not exceed 200 characters')
      .optional(),

    comment: z
      .string()
      .trim()
      .min(1, 'Review comment cannot be empty')
      .max(2000, 'Review comment must not exceed 2000 characters')
      .optional(),
  })
  .refine((data) => data.title !== undefined || data.comment !== undefined, {
    message: 'Review must contain a title or comment',
    path: ['comment'],
  });

export const updateProductReviewSchema = z
  .object({
    rating: z
      .number()
      .int('Rating must be an integer')
      .min(1, 'Rating must be at least 1')
      .max(5, 'Rating must not exceed 5')
      .optional(),

    title: z
      .string()
      .trim()
      .min(1, 'Review title cannot be empty')
      .max(200, 'Review title must not exceed 200 characters')
      .nullable()
      .optional(),

    comment: z
      .string()
      .trim()
      .min(1, 'Review comment cannot be empty')
      .max(2000, 'Review comment must not exceed 2000 characters')
      .nullable()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one review field must be provided',
  });

export const productReviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProductReviewRequest = z.infer<
  typeof createProductReviewSchema
>;

export type UpdateProductReviewRequest = z.infer<
  typeof updateProductReviewSchema
>;

export type ProductReviewListQuery = z.infer<
  typeof productReviewListQuerySchema
>;
