import { z } from 'zod';

const MAX_QUANTITY_DELTA = 1_000_000_000;

const positiveInteger = z.number().int().positive().max(MAX_QUANTITY_DELTA);

const nonZeroInteger = z
  .number()
  .int()
  .min(-MAX_QUANTITY_DELTA)
  .max(MAX_QUANTITY_DELTA)
  .refine((value) => value !== 0, {
    message: 'Quantity cannot be zero',
  });

const optionalReferenceId = z.string().trim().min(1).max(255).optional();

export const createInventorySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  variantId: z.string().uuid(),

  quantity: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_QUANTITY_DELTA)
    .optional()
    .default(0),
});

export const inventoryIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const stockInSchema = z.object({
  quantity: positiveInteger,

  reason: z.string().trim().max(500).optional(),

  referenceId: optionalReferenceId,
});

export const stockOutSchema = z.object({
  quantity: positiveInteger,

  reason: z.string().trim().max(500).optional(),

  referenceId: optionalReferenceId,
});

export const adjustmentSchema = z.object({
  quantity: nonZeroInteger,

  reason: z.string().trim().min(1).max(500),

  referenceId: optionalReferenceId,
});

export const inventoryListQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),

  limit: z.coerce.number().int().positive().max(100).default(20),

  variantId: z.string().uuid().optional(),

  search: z.string().trim().min(1).max(200).optional(),

  lowStock: z.coerce.number().int().nonnegative().optional(),
});

export const transactionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),

  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const inventoryVariantParamsSchema = z.object({
  variantId: z.string().uuid(),
});

export type CreateInventoryRequest = z.infer<typeof createInventorySchema>;

export type StockInRequest = z.infer<typeof stockInSchema>;

export type StockOutRequest = z.infer<typeof stockOutSchema>;

export type AdjustmentRequest = z.infer<typeof adjustmentSchema>;

export type InventoryListQueryRequest = z.infer<
  typeof inventoryListQuerySchema
>;

export type TransactionListQueryRequest = z.infer<
  typeof transactionListQuerySchema
>;
