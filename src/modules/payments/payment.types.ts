import type {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../generated/prisma/client.js';

export interface CreatePaymentInput {
  orderId: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  provider: PaymentProvider;
  metadata?: Record<string, unknown> | null;
}

export interface UpdatePaymentStatusInput {
  status: PaymentStatus;

  providerPaymentId?: string | null;

  providerTransactionId?: string | null;

  failureCode?: string | null;

  failureMessage?: string | null;

  metadata?: Record<string, unknown> | null;
}

export interface PaymentFilterInput {
  orderId?: string;
  status?: PaymentStatus;
  provider?: PaymentProvider;
  method?: PaymentMethod;
}

export interface PaymentProviderCreateInput {
  paymentId: string;
  orderId: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  metadata?: Record<string, unknown> | null;
}

export interface PaymentProviderCreateResult {
  status: PaymentStatus;

  providerPaymentId?: string | null;

  providerTransactionId?: string | null;

  checkoutUrl?: string | null;

  clientSecret?: string | null;

  failureCode?: string | null;

  failureMessage?: string | null;

  metadata?: Record<string, unknown> | null;
}

export interface PaymentResponse {
  id: string;

  orderId: string;

  provider: PaymentProvider;

  method: PaymentMethod;

  status: PaymentStatus;

  amount: string;

  currency: string;

  providerPaymentId: string | null;

  providerTransactionId: string | null;

  failureCode: string | null;

  failureMessage: string | null;

  metadata: Record<string, unknown> | null;

  createdAt: string;

  updatedAt: string;
}
