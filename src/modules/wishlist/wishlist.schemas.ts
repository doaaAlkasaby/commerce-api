import { z } from 'zod';

export const addWishlistItemSchema = z.object({
  productId: z.string().uuid(),
});

export const wishlistProductParamsSchema = z.object({
  productId: z.string().uuid(),
});