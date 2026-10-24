import { z } from 'zod';

import {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../generated/prisma/client.js';

const paymentMethods = Object.values(PaymentMethod);

const paymentProviders = Object.values(PaymentProvider);

const paymentStatuses = Object.values(PaymentStatus);

export const createPaymentSchema = z.object({
  orderId: z
    .string()
    .uuid(),

  amount: z
    .string()
    .regex(
      /^\d+(\.\d{1,2})?$/,
      'Amount must be a valid monetary value',
    ),

  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),

  method: z.enum(paymentMethods as [
    PaymentMethod,
    ...PaymentMethod[],
  ]),

  provider: z.enum(paymentProviders as [
    PaymentProvider,
    ...PaymentProvider[],
  ]),

  metadata: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional(),
});

export const updatePaymentStatusSchema = z.object({
  status: z.enum(paymentStatuses as [
    PaymentStatus,
    ...PaymentStatus[],
  ]),

  providerPaymentId: z
    .string()
    .trim()
    .nullable()
    .optional(),

  providerTransactionId: z
    .string()
    .trim()
    .nullable()
    .optional(),

  failureCode: z
    .string()
    .trim()
    .nullable()
    .optional(),

  failureMessage: z
    .string()
    .trim()
    .nullable()
    .optional(),

  metadata: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional(),
});

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const orderIdParamsSchema = z.object({
  orderId: z.string().uuid(),
});

export const paymentListQuerySchema = z.object({
  orderId: z
    .string()
    .uuid()
    .optional(),

  status: z
    .enum(paymentStatuses as [
      PaymentStatus,
      ...PaymentStatus[],
    ])
    .optional(),

  provider: z
    .enum(paymentProviders as [
      PaymentProvider,
      ...PaymentProvider[],
    ])
    .optional(),

  method: z
    .enum(paymentMethods as [
      PaymentMethod,
      ...PaymentMethod[],
    ])
    .optional(),
});

export const refundPaymentSchema = z.object({
  amount: z
    .string()
    .regex(
      /^\d+(\.\d{1,2})?$/,
      'Amount must be a valid monetary value',
    )
    .optional(),
});