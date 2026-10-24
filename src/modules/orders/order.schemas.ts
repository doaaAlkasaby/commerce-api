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

export type OrderIdParamsInput =
  z.infer<typeof orderIdParamsSchema>;

export type OrderListQueryInput =
  z.infer<typeof orderListQuerySchema>;

export type UpdateOrderStatusSchemaInput =
  z.infer<typeof updateOrderStatusSchema>;