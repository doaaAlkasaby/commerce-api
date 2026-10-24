import type {
  PaymentProvider as PrismaPaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/client.js';

import type {
  PaymentProviderCreateInput,
  PaymentProviderCreateResult,
} from '../payment.types.js';

export interface PaymentProviderAdapter {
  readonly provider: PrismaPaymentProvider;

  createPayment(
    input: PaymentProviderCreateInput,
  ): Promise<PaymentProviderCreateResult>;

  cancelPayment(
    providerPaymentId: string,
  ): Promise<{
    status: PaymentStatus;
  }>;

  refundPayment(
    providerPaymentId: string,
    amount: string,
  ): Promise<{
    status: PaymentStatus;
    providerTransactionId?: string | null;
  }>;
}