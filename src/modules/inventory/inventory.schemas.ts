import { z } from 'zod';

const positiveInteger = z
  .number()
  .int()
  .positive();

const nonZeroInteger = z
  .number()
  .int()
  .refine(
    (value) => value !== 0,
    {
      message: 'Quantity cannot be zero',
    },
  );

export const createInventorySchema = z.object({
  variantId: z.string().uuid(),

  quantity: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0),
});

export const inventoryIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const stockInSchema = z.object({
  quantity: positiveInteger,

  reason: z
    .string()
    .trim()
    .max(500)
    .optional(),

  referenceId: z
    .string()
    .trim()
    .max(255)
    .optional(),
});

export const stockOutSchema = z.object({
  quantity: positiveInteger,

  reason: z
    .string()
    .trim()
    .max(500)
    .optional(),

  referenceId: z
    .string()
    .trim()
    .max(255)
    .optional(),
});

export const adjustmentSchema = z.object({
  quantity: nonZeroInteger,

  reason: z
    .string()
    .trim()
    .min(1)
    .max(500),

  referenceId: z
    .string()
    .trim()
    .max(255)
    .optional(),
});

export const reservationSchema = z.object({
  quantity: positiveInteger,

  referenceId: z
    .string()
    .trim()
    .min(1)
    .max(255),

  reason: z
    .string()
    .trim()
    .max(500)
    .optional(),
});

export const releaseSchema = z.object({
  quantity: positiveInteger,

  referenceId: z
    .string()
    .trim()
    .min(1)
    .max(255),

  reason: z
    .string()
    .trim()
    .max(500)
    .optional(),
});

export const saleSchema = z.object({
  quantity: positiveInteger,

  referenceId: z
    .string()
    .trim()
    .min(1)
    .max(255),

  reason: z
    .string()
    .trim()
    .max(500)
    .optional(),
});

export const inventoryListQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive()
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .default(20),

  variantId: z
    .string()
    .uuid()
    .optional(),

  lowStock: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional(),
});

export const transactionListQuerySchema =
  z.object({
    page: z.coerce
      .number()
      .int()
      .positive()
      .default(1),

    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(20),
  });


  export const inventoryVariantParamsSchema =
  z.object({
    variantId: z.string().uuid(),
  });
  
export type CreateInventoryRequest = z.infer<
  typeof createInventorySchema
>;

export type StockInRequest = z.infer<
  typeof stockInSchema
>;

export type StockOutRequest = z.infer<
  typeof stockOutSchema
>;

export type AdjustmentRequest = z.infer<
  typeof adjustmentSchema
>;

export type ReservationRequest = z.infer<
  typeof reservationSchema
>;

export type ReleaseRequest = z.infer<
  typeof releaseSchema
>;

export type SaleRequest = z.infer<
  typeof saleSchema
>;

export type InventoryListQueryRequest =
  z.infer<typeof inventoryListQuerySchema>;

export type TransactionListQueryRequest =
  z.infer<
    typeof transactionListQuerySchema
  >;