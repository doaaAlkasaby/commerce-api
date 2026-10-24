import type { Payment } from '../../generated/prisma/client.js';

import type { PaymentResponse } from './payment.types.js';

export const mapPaymentToResponse = (
  payment: Payment,
): PaymentResponse => {
  return {
    id: payment.id,

    orderId: payment.orderId,

    provider: payment.provider,

    method: payment.method,

    status: payment.status,

    amount: payment.amount.toString(),

    currency: payment.currency,

    providerPaymentId:
      payment.providerPaymentId,

    providerTransactionId:
      payment.providerTransactionId,

    failureCode:
      payment.failureCode,

    failureMessage:
      payment.failureMessage,

    metadata:
      payment.metadata as Record<string, unknown> | null,

    createdAt:
      payment.createdAt.toISOString(),

    updatedAt:
      payment.updatedAt.toISOString(),
  };
};