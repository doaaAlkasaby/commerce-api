import { z } from 'zod';

export const addCartItemSchema = z.object({
  variantId: z.string().uuid(),

  quantity: z
    .number()
    .int()
    .min(1, 'Quantity must be at least 1')
    .max(
      1000,
      'Quantity cannot exceed 1000',
    ),
});

export const updateCartItemSchema = z.object({
  quantity: z
    .number()
    .int()
    .min(1, 'Quantity must be at least 1')
    .max(
      1000,
      'Quantity cannot exceed 1000',
    ),
});

export const cartVariantParamsSchema =
  z.object({
    variantId: z.string().uuid(),
  });

export const CART_RECOMMENDATIONS_DEFAULT_LIMIT = 15;
export const CART_RECOMMENDATIONS_MAX_LIMIT = 15;

export const cartRecommendationsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CART_RECOMMENDATIONS_MAX_LIMIT)
    .default(CART_RECOMMENDATIONS_DEFAULT_LIMIT),
});

export type AddCartItemSchemaInput =
  z.infer<typeof addCartItemSchema>;

export type UpdateCartItemSchemaInput =
  z.infer<typeof updateCartItemSchema>;

export type CartVariantParamsInput =
  z.infer<
    typeof cartVariantParamsSchema
  >;

export type CartRecommendationsQueryInput =
  z.infer<typeof cartRecommendationsQuerySchema>;