import type {
  PaymentMethod,
  PaymentProvider,
  PaymentRefundStatus,
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

  refundId?: string;

  refundAmount?: string;

  providerPaymentId?: string | null;

  providerTransactionId?: string | null;

  failureCode?: string | null;

  failureMessage?: string | null;

  metadata?: Record<string, unknown> | null;
}

export type TrustedPaymentTransition =
  | {
      kind: 'COD_CONFIRMATION';
      referenceId: string;
      actorUserId: string;
    }
  | {
      kind: 'PROVIDER_VERIFICATION';
      provider: PaymentProvider;
      providerPaymentId: string;
    }
  | {
      kind: 'PROVIDER_INITIATION';
    }
  | {
      kind: 'ORDER_LIFECYCLE';
    }
  | {
      kind: 'PAYMENT_CANCEL';
    }
  | {
      kind: 'PAYMENT_REFUND';
      refundId?: string;
      allowRollbackToPaid?: boolean;
    };

export interface ApplyPaymentStatusOptions {
  transition?: TrustedPaymentTransition;
  allowCodFulfillmentCancellation?: boolean;
  allowRefundPendingRollback?: boolean;
  preserveProviderTransactionId?: boolean;
  skipInventorySideEffects?: boolean;
  skipPaymentNotification?: boolean;
}

export interface PaymentFilterInput {
  orderId?: string;
  status?: PaymentStatus;
  provider?: PaymentProvider;
  method?: PaymentMethod;
}

export interface PaymentProviderCreateInput {
  idempotencyKey: string;
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
  initiationState: string;
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

export interface VerifiedProviderPayment {
  invoiceId: string;
  customerReference: string;
  orderReference: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  transactionId?: string;
  transactionPaymentId?: string;
  transactionPaymentIds: string[];
}

export type ProviderRefundOutcome =
  | 'SUCCEEDED'
  | 'SUBMITTED'
  | 'PENDING'
  | 'FAILED'
  | 'UNKNOWN';

export interface ProviderRefundInput {
  refundId: string;
  idempotencyKey: string;
  providerPaymentId: string;
  amount: string;
  currency: string;
  reason: string;
}

export interface ProviderRefundResult {
  outcome: ProviderRefundOutcome;
  refundId?: string | null;
  originalProviderPaymentId?: string | null;
  amount?: string;
  currency?: string;
  definitiveFailure?: boolean;
  providerRefundId?: string | null;
  providerRefundReference?: string | null;
  providerRefundInvoiceId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PaymentRefundSummary {
  capturedAmount: string;
  settledRefundedAmount: string;
  reservedInFlightAmount: string;
  remainingRefundableAmount: string;
  currency: string;
}

export interface PaymentRefundResponse {
  id: string;
  tenantId: string;
  paymentId: string;
  orderId: string;
  provider: PaymentProvider;
  method: PaymentMethod;
  amount: string;
  currency: string;
  status: PaymentRefundStatus;
  idempotencyKey: string;
  providerRefundId: string | null;
  providerRefundReference: string | null;
  providerRefundInvoiceId: string | null;
  reason: string;
  requestedByUserId: string;
  failureCode: string | null;
  failureMessage: string | null;
  reconciliationReason: string | null;
  requestedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundExecutionResponse {
  refund: PaymentRefundResponse;
  payment: PaymentResponse;
  summary: PaymentRefundSummary;
  idempotentReplay: boolean;
}
