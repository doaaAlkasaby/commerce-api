import type {
  PaymentProvider as PrismaPaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/client.js';

import type {
  VerifiedProviderPayment,
  PaymentProviderCreateInput,
  PaymentProviderCreateResult,
} from '../payment.types.js';

export interface PaymentProviderAdapter {
  readonly provider: PrismaPaymentProvider;
  // Opt in only when repeated createPayment calls with the same stable key are
  // guaranteed not to create another provider intent. Absent means unsupported.
  readonly supportsIdempotentInitiation?: boolean;

  validatePayment?(
    input: Pick<PaymentProviderCreateInput, 'amount' | 'currency'>,
  ): void;
  getPaymentStatus?(invoiceId: string): Promise<VerifiedProviderPayment>;

  createPayment(
    input: PaymentProviderCreateInput,
  ): Promise<PaymentProviderCreateResult>;

  cancelPayment(providerPaymentId: string): Promise<{
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
