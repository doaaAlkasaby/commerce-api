import { z } from 'zod';

import {
  OrderStatus,
  PaymentStatus,
} from '../../generated/prisma/client.js';

const orderStatusValues = Object.values(OrderStatus);

const paymentStatusValues = Object.values(
  PaymentStatus,
);

export const orderIdParamsSchema =
  z.object({
    id: z.string().uuid(),
  });

export const orderListQuerySchema =
  z.object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .default(1),

    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20),

    status: z
      .enum(
        orderStatusValues as [
          typeof orderStatusValues[number],
          ...typeof orderStatusValues,
        ],
      )
      .optional(),

    paymentStatus: z
      .enum(
        paymentStatusValues as [
          typeof paymentStatusValues[number],
          ...typeof paymentStatusValues,
        ],
      )
      .optional(),
  });

export const updateOrderStatusSchema =
  z.object({
    status: z.enum(
      orderStatusValues as [
        typeof orderStatusValues[number],
        ...typeof orderStatusValues,
      ],
    ),
  });

const codReferenceIdSchema = z
  .string()
  .trim()
  .min(1, 'referenceId is required')
  .max(128, 'referenceId must be at most 128 characters')
  .regex(
    /^[A-Za-z0-9:._-]+$/,
    'referenceId must contain only alphanumeric characters, colons, dots, underscores, or hyphens',
  );

export const confirmCodPaymentSchema = z
  .object({
    referenceId: codReferenceIdSchema,
    collectedAmount: z
      .string()
      .trim()
      .regex(
        /^\d+(\.\d{1,4})?$/,
        'collectedAmount must be a valid non-negative decimal string',
      ),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter uppercase ISO code'),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const markCodRefusedSchema = z
  .object({
    referenceId: codReferenceIdSchema,
    reason: z
      .string()
      .trim()
      .min(3, 'reason must be at least 3 characters')
      .max(500, 'reason must be at most 500 characters'),
    courierReference: z.string().trim().max(128).optional(),
  })
  .strict();

export const confirmCodReturnSchema = z
  .object({
    referenceId: codReferenceIdSchema,
    warehouseId: z.string().uuid(),
    receivedCondition: z.enum(['RESELLABLE', 'DAMAGED']),
    note: z
      .string()
      .trim()
      .min(3, 'note must be at least 3 characters')
      .max(500, 'note must be at most 500 characters'),
  })
  .strict();

export type OrderIdParamsInput =
  z.infer<typeof orderIdParamsSchema>;

export type OrderListQueryInput =
  z.infer<typeof orderListQuerySchema>;

export type UpdateOrderStatusSchemaInput =
  z.infer<typeof updateOrderStatusSchema>;

export type ConfirmCodPaymentSchemaInput =
  z.infer<typeof confirmCodPaymentSchema>;

export type MarkCodRefusedSchemaInput =
  z.infer<typeof markCodRefusedSchema>;

export type ConfirmCodReturnSchemaInput =
  z.infer<typeof confirmCodReturnSchema>;
