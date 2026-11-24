import { createHash, randomUUID } from 'node:crypto';
import {
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import type { Payment, PaymentRefund } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logger/logger.js';
import { currencyPrecision } from '../../common/pricing/currency.js';
import { validateAmount } from '../../common/pricing/money.js';
import { paymentNotificationService } from '../notifications/payment-notification.service.js';
import { mapPaymentToResponse } from './payment.mapper.js';
import { PaymentService } from './payment.service.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';
import { paymentRefundRepository } from './payment-refund.repository.js';
import {
  computeRefundAccountingDecimals,
  deriveAggregatePaymentStatusFromLedger,
  formatRefundSummary,
  type RefundAccountingDecimals,
} from './payment-refund.accounting.js';
import type {
  PaymentRefundResponse,
  PaymentRefundSummary,
  ProviderRefundOutcome,
  ProviderRefundResult,
  RefundExecutionResponse,
} from './payment.types.js';

export {
  computeRefundAccountingDecimals,
  deriveAggregatePaymentStatusFromLedger,
  formatRefundSummary,
  type RefundAccountingDecimals,
};

export const REFUND_STATUS_TRANSITIONS: Readonly<
  Record<PaymentRefundStatus, readonly PaymentRefundStatus[]>
> = {
  REQUESTED: [
    PaymentRefundStatus.SUBMITTED,
    PaymentRefundStatus.PENDING,
    PaymentRefundStatus.SUCCEEDED,
    PaymentRefundStatus.FAILED,
    PaymentRefundStatus.RECONCILIATION_REQUIRED,
  ],
  SUBMITTED: [
    PaymentRefundStatus.PENDING,
    PaymentRefundStatus.SUCCEEDED,
    PaymentRefundStatus.FAILED,
    PaymentRefundStatus.RECONCILIATION_REQUIRED,
  ],
  PENDING: [
    PaymentRefundStatus.SUCCEEDED,
    PaymentRefundStatus.FAILED,
    PaymentRefundStatus.RECONCILIATION_REQUIRED,
  ],
  RECONCILIATION_REQUIRED: [
    PaymentRefundStatus.PENDING,
    PaymentRefundStatus.SUCCEEDED,
    PaymentRefundStatus.FAILED,
  ],
  SUCCEEDED: [],
  FAILED: [],
};

const VALID_PROVIDER_OUTCOMES: ReadonlySet<ProviderRefundOutcome> = new Set([
  'SUCCEEDED',
  'SUBMITTED',
  'PENDING',
  'FAILED',
  'UNKNOWN',
]);

const CAPTURED_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUNDED,
]);

export interface RequestRefundInput {
  amount?: string;
  idempotencyKey?: string;
  reason?: string;
  requestedByUserId: string;
}

export interface RefundDispatchClaim {
  readonly refundId: string;
  readonly token: string;
}

export interface ReserveRefundResult {
  refund: PaymentRefund;
  payment: Payment;
  summary: PaymentRefundSummary;
  claimedForDispatch: boolean;
  dispatchClaim: RefundDispatchClaim | null;
}

export interface ApplyRefundOutcomeInput {
  outcome: ProviderRefundOutcome;
  amount?: string | null;
  currency?: string | null;
  originalProviderPaymentId?: string | null;
  refundId?: string | null;
  definitiveFailure?: boolean | null;
  providerRefundId?: string | null;
  providerRefundReference?: string | null;
  providerRefundInvoiceId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  reconciliationReason?: string | null;
  providerMetadata?: Record<string, unknown> | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeOptionalNonEmpty = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export function mapPaymentRefundToResponse(
  refund: PaymentRefund,
): PaymentRefundResponse {
  const scale = currencyPrecision(refund.currency);
  return {
    id: refund.id,
    tenantId: refund.tenantId,
    paymentId: refund.paymentId,
    orderId: refund.orderId,
    provider: refund.provider,
    method: refund.method,
    amount: refund.amount.toFixed(scale),
    currency: refund.currency,
    status: refund.status,
    idempotencyKey: refund.idempotencyKey,
    providerRefundId: refund.providerRefundId,
    providerRefundReference: refund.providerRefundReference,
    providerRefundInvoiceId: refund.providerRefundInvoiceId,
    reason: refund.reason,
    requestedByUserId: refund.requestedByUserId,
    failureCode: refund.failureCode,
    failureMessage: refund.failureMessage,
    reconciliationReason: refund.reconciliationReason,
    requestedAt: refund.requestedAt.toISOString(),
    submittedAt: refund.submittedAt ? refund.submittedAt.toISOString() : null,
    completedAt: refund.completedAt ? refund.completedAt.toISOString() : null,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}

export function assertRefundTransitionAllowed(
  current: PaymentRefundStatus,
  next: PaymentRefundStatus,
): 'NOOP' | 'TRANSITION' {
  if (current === next) {
    if (
      current === PaymentRefundStatus.SUCCEEDED ||
      current === PaymentRefundStatus.FAILED
    ) {
      return 'NOOP';
    }
    return 'NOOP';
  }

  if (!REFUND_STATUS_TRANSITIONS[current].includes(next)) {
    throw new AppError(
      `Cannot transition refund from ${current} to ${next}`,
      409,
      'REFUND_STATE_CONFLICT',
    );
  }

  return 'TRANSITION';
}

export function computeRefundRequestFingerprint(params: {
  amount: string;
  currency: string;
  reason: string;
  provider: string;
  method: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        amount: params.amount,
        currency: params.currency,
        reason: params.reason,
        provider: params.provider,
        method: params.method,
      }),
      'utf8',
    )
    .digest('hex');
}

interface RefundEvidenceCandidate {
  outcome: ProviderRefundOutcome;
  amount?: unknown;
  currency?: unknown;
  providerRefundId?: unknown;
  providerRefundReference?: unknown;
  providerRefundInvoiceId?: unknown;
  originalProviderPaymentId?: unknown;
  refundId?: unknown;
  definitiveFailure?: unknown;
  metadata?: unknown;
}

function validateRefundEvidenceCore(
  candidate: RefundEvidenceCandidate,
  expectedRefund: Pick<PaymentRefund, 'id' | 'amount' | 'currency'>,
  expectedOriginalProviderPaymentId: string | null,
  options: {
    requireCompleteForSucceeded: boolean;
    requireDefinitiveForFailed: boolean;
    persistedProviderRefundId?: string | null;
  },
): { valid: true } | { valid: false; reason: string; errorCode: string } {
  for (const field of [
    'providerRefundId',
    'providerRefundReference',
    'providerRefundInvoiceId',
    'refundId',
    'originalProviderPaymentId',
  ] as const) {
    const val = candidate[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'string' || val.trim().length === 0) {
        return {
          valid: false,
          reason: `PROVIDER_${field.toUpperCase()}_INVALID`,
          errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
        };
      }
    }
  }

  if (
    candidate.metadata !== undefined &&
    candidate.metadata !== null &&
    !isPlainObject(candidate.metadata)
  ) {
    return {
      valid: false,
      reason: 'PROVIDER_METADATA_INVALID',
      errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
    };
  }

  if (candidate.currency !== undefined && candidate.currency !== null) {
    if (
      typeof candidate.currency !== 'string' ||
      candidate.currency !== expectedRefund.currency
    ) {
      return {
        valid: false,
        reason: 'PROVIDER_CURRENCY_MISMATCH',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
      };
    }
  }

  if (candidate.amount !== undefined && candidate.amount !== null) {
    if (typeof candidate.amount !== 'string') {
      return {
        valid: false,
        reason: 'PROVIDER_AMOUNT_INVALID',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
      };
    }
    try {
      const returnedAmount = validateAmount(
        candidate.amount,
        expectedRefund.currency,
      );
      if (!returnedAmount.equals(expectedRefund.amount)) {
        return {
          valid: false,
          reason: 'PROVIDER_AMOUNT_MISMATCH',
          errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
        };
      }
    } catch {
      return {
        valid: false,
        reason: 'PROVIDER_AMOUNT_INVALID',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
      };
    }
  }

  const returnedOriginalPaymentId = normalizeOptionalNonEmpty(
    candidate.originalProviderPaymentId,
  );
  if (
    returnedOriginalPaymentId !== null &&
    expectedOriginalProviderPaymentId !== null &&
    returnedOriginalPaymentId !== expectedOriginalProviderPaymentId
  ) {
    return {
      valid: false,
      reason: 'PROVIDER_ORIGINAL_PAYMENT_BINDING_MISMATCH',
      errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
    };
  }

  const returnedRefundId = normalizeOptionalNonEmpty(candidate.refundId);
  if (returnedRefundId !== null && returnedRefundId !== expectedRefund.id) {
    return {
      valid: false,
      reason: 'PROVIDER_REFUND_IDENTITY_MISMATCH',
      errorCode: 'REFUND_FINANCIAL_EVIDENCE_MISMATCH',
    };
  }

  // Every NEW SUCCEEDED settlement requires complete, verified provider financial evidence.
  if (options.requireCompleteForSucceeded && candidate.outcome === 'SUCCEEDED') {
    if (candidate.amount === undefined || candidate.amount === null) {
      return {
        valid: false,
        reason: 'PROVIDER_AMOUNT_MISSING',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_INCOMPLETE',
      };
    }
    if (candidate.currency === undefined || candidate.currency === null) {
      return {
        valid: false,
        reason: 'PROVIDER_CURRENCY_MISSING',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_INCOMPLETE',
      };
    }
    const effectiveProviderRefundId =
      normalizeOptionalNonEmpty(candidate.providerRefundId) ??
      normalizeOptionalNonEmpty(options.persistedProviderRefundId);
    if (!effectiveProviderRefundId) {
      return {
        valid: false,
        reason: 'PROVIDER_REFUND_ID_MISSING',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_INCOMPLETE',
      };
    }
    if (
      returnedOriginalPaymentId === null ||
      expectedOriginalProviderPaymentId === null
    ) {
      return {
        valid: false,
        reason: 'PROVIDER_ORIGINAL_PAYMENT_BINDING_MISSING',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_INCOMPLETE',
      };
    }
    if (returnedRefundId === null) {
      return {
        valid: false,
        reason: 'PROVIDER_REFUND_IDENTITY_MISSING',
        errorCode: 'REFUND_FINANCIAL_EVIDENCE_INCOMPLETE',
      };
    }
  }

  // Every NEW FAILED settlement that releases capacity requires explicit definitiveFailure === true.
  if (options.requireDefinitiveForFailed && candidate.outcome === 'FAILED') {
    if (candidate.definitiveFailure !== true) {
      return {
        valid: false,
        reason: 'PROVIDER_FAILURE_AMBIGUOUS',
        errorCode: 'REFUND_FAILURE_NOT_DEFINITIVE',
      };
    }
  }

  return { valid: true };
}

function validateProviderRefundResult(
  raw: unknown,
  expectedRefund: Pick<PaymentRefund, 'id' | 'amount' | 'currency'>,
  expectedOriginalProviderPaymentId: string,
): { valid: true; result: ProviderRefundResult } | { valid: false; reason: string } {
  if (!isPlainObject(raw)) {
    return { valid: false, reason: 'PROVIDER_RESPONSE_NOT_OBJECT' };
  }

  const outcome = raw.outcome;
  if (
    typeof outcome !== 'string' ||
    !VALID_PROVIDER_OUTCOMES.has(outcome as ProviderRefundOutcome)
  ) {
    return { valid: false, reason: 'PROVIDER_OUTCOME_INVALID' };
  }

  const check = validateRefundEvidenceCore(
    {
      outcome: outcome as ProviderRefundOutcome,
      amount: raw.amount,
      currency: raw.currency,
      providerRefundId: raw.providerRefundId,
      providerRefundReference: raw.providerRefundReference,
      providerRefundInvoiceId: raw.providerRefundInvoiceId,
      originalProviderPaymentId: raw.originalProviderPaymentId,
      refundId: raw.refundId,
      definitiveFailure: raw.definitiveFailure,
      metadata: raw.metadata,
    },
    expectedRefund,
    expectedOriginalProviderPaymentId,
    {
      requireCompleteForSucceeded: true,
      requireDefinitiveForFailed: true,
    },
  );
  if (!check.valid) {
    return { valid: false, reason: check.reason };
  }

  return { valid: true, result: raw as unknown as ProviderRefundResult };
}

export class PaymentRefundService {
  // In-memory active dispatch ownership tokens bound strictly to newly created REQUESTED rows.
  private readonly activeDispatchClaims = new Map<string, string>();

  constructor(
    private readonly repository = paymentRefundRepository,
    private readonly paymentService = new PaymentService(),
    private readonly providerRegistry = new PaymentProviderRegistry(),
  ) {}

  async getRefundSummary(
    tenantId: string,
    paymentId: string,
  ): Promise<{ summary: PaymentRefundSummary; refunds: PaymentRefundResponse[] }> {
    return prisma.$transaction(async (tx) => {
      const identity = await this.repository.findPaymentOrderIdentity(
        tx,
        tenantId,
        paymentId,
      );
      if (!identity) {
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      }
      const { payment } = await this.repository.findPaymentAndOrder(
        tx,
        tenantId,
        paymentId,
        identity.orderId,
      );
      if (!payment) {
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      }
      const refunds = await this.repository.findRefundsByPayment(
        tx,
        tenantId,
        paymentId,
      );
      const accounting = computeRefundAccountingDecimals(payment, refunds);
      return {
        summary: formatRefundSummary(accounting),
        refunds: refunds.map(mapPaymentRefundToResponse),
      };
    });
  }

  /**
   * Transactional Step 1: Lock owning Order FOR UPDATE, validate authorization &
   * capacity, resolve idempotency, insert PaymentRefund(REQUESTED), and update
   * aggregate Payment/Order status before committing and returning dispatch ownership.
   */
  async reserveRefund(
    tenantId: string,
    paymentId: string,
    input: RequestRefundInput,
  ): Promise<ReserveRefundResult> {
    const requestedByUserId = normalizeOptionalNonEmpty(input.requestedByUserId);
    if (!requestedByUserId) {
      throw new AppError(
        'Authenticated actor is required to issue a refund',
        401,
        'AUTHENTICATION_REQUIRED',
      );
    }

    return prisma.$transaction(async (tx) => {
      const identity = await this.repository.findPaymentOrderIdentity(
        tx,
        tenantId,
        paymentId,
      );
      if (!identity) {
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      }

      const locked = await this.repository.lockOrderForUpdate(
        tx,
        tenantId,
        identity.orderId,
      );
      if (!locked) {
        throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
      }

      const { payment, order, siblingCount } =
        await this.repository.findPaymentAndOrder(
          tx,
          tenantId,
          paymentId,
          identity.orderId,
        );
      if (!payment) {
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      }
      if (!order) {
        throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
      }
      if (
        siblingCount !== 1 ||
        order.paymentStatus !== payment.status ||
        !payment.amount.equals(order.totalAmount) ||
        payment.currency !== order.currency ||
        payment.reconciliationRequired
      ) {
        throw new AppError(
          'Payment requires reconciliation before refunding',
          409,
          'PAYMENT_RECONCILIATION_REQUIRED',
        );
      }

      // Reject COD / NONE immediately before any capacity reservation.
      if (
        payment.method === 'CASH_ON_DELIVERY' ||
        payment.provider === 'NONE'
      ) {
        throw new AppError(
          'COD refunds require a dedicated auditable refund workflow',
          409,
          'COD_REFUND_WORKFLOW_REQUIRED',
        );
      }

      if (!CAPTURED_PAYMENT_STATUSES.has(payment.status)) {
        throw new AppError(
          'Only captured payments can be refunded',
          400,
          'PAYMENT_NOT_REFUNDABLE',
        );
      }

      if (!payment.providerPaymentId) {
        throw new AppError(
          'Payment does not have a provider payment ID',
          400,
          'MISSING_PROVIDER_PAYMENT_ID',
        );
      }

      const rawAmount = normalizeOptionalNonEmpty(input.amount);
      if (!rawAmount) {
        throw new AppError(
          'Exact refund amount is required',
          400,
          'INVALID_REFUND_AMOUNT',
        );
      }
      const requestedDecimal = validateAmount(rawAmount, payment.currency);
      if (requestedDecimal.lte(0)) {
        throw new AppError(
          'Refund amount must be strictly positive',
          400,
          'INVALID_REFUND_AMOUNT',
        );
      }

      // Reject unsupported providers BEFORE reserving any refund capacity.
      const adapter = this.providerRegistry.getProvider(payment.provider);
      if (adapter.supportsRefunds !== true || !adapter.executeRefund) {
        throw new AppError(
          `Refunds are not supported for provider ${payment.provider}`,
          409,
          'PAYMENT_PROVIDER_OPERATION_NOT_SUPPORTED',
        );
      }

      const idempotencyKey = normalizeOptionalNonEmpty(input.idempotencyKey);
      if (!idempotencyKey || idempotencyKey.length > 128) {
        throw new AppError(
          'A valid refund idempotency key (1-128 characters) is required',
          400,
          'IDEMPOTENCY_KEY_REQUIRED',
        );
      }

      const reason = normalizeOptionalNonEmpty(input.reason);
      if (!reason || reason.length < 3 || reason.length > 500) {
        throw new AppError(
          'A refund business reason (3-500 characters) is required',
          400,
          'REFUND_REASON_REQUIRED',
        );
      }

      const scale = currencyPrecision(payment.currency);
      const normalizedAmount = requestedDecimal.toFixed(scale);
      const requestFingerprint = computeRefundRequestFingerprint({
        amount: normalizedAmount,
        currency: payment.currency,
        reason,
        provider: payment.provider,
        method: payment.method,
      });

      const existingRefunds = await this.repository.findRefundsByPayment(
        tx,
        tenantId,
        paymentId,
      );
      const existingAccounting = computeRefundAccountingDecimals(
        payment,
        existingRefunds,
      );

      // Resolve idempotency AFTER acquiring the Order FOR UPDATE lock.
      const existingByKey = await this.repository.findByIdempotencyKey(
        tx,
        tenantId,
        paymentId,
        idempotencyKey,
      );
      if (existingByKey) {
        if (existingByKey.requestFingerprint !== requestFingerprint) {
          throw new AppError(
            'Refund idempotency key was already used with different request details',
            409,
            'IDEMPOTENCY_KEY_REUSED',
          );
        }
        return {
          refund: existingByKey,
          payment,
          summary: formatRefundSummary(existingAccounting),
          claimedForDispatch: false,
          dispatchClaim: null,
        };
      }

      if (requestedDecimal.gt(existingAccounting.remainingRefundableAmount)) {
        throw new AppError(
          'Requested refund amount exceeds remaining refundable capacity',
          409,
          'REFUND_AMOUNT_EXCEEDS_REMAINING',
        );
      }

      const created = await this.repository.createRequested(tx, {
        tenantId,
        paymentId: payment.id,
        orderId: order.id,
        provider: payment.provider,
        method: payment.method,
        amount: requestedDecimal,
        currency: payment.currency,
        idempotencyKey,
        requestFingerprint,
        reason,
        requestedByUserId,
      });

      const updatedRefunds = [...existingRefunds, created];
      const updatedAccounting = computeRefundAccountingDecimals(
        payment,
        updatedRefunds,
      );
      const targetAggregateStatus =
        deriveAggregatePaymentStatusFromLedger(updatedAccounting);

      let updatedPayment = payment;
      if (payment.status !== targetAggregateStatus) {
        updatedPayment = await this.paymentService.applyPaymentStatusWithClient(
          tenantId,
          payment.id,
          {
            status: targetAggregateStatus,
            refundId: created.id,
            ...(targetAggregateStatus === PaymentStatus.PARTIALLY_REFUNDED
              ? { refundAmount: normalizedAmount }
              : {}),
          },
          tx,
          {
            transition: {
              kind: 'PAYMENT_REFUND',
              refundId: created.id,
            },
            preserveProviderTransactionId: true,
            skipInventorySideEffects: true,
            skipPaymentNotification: true,
          },
        );
      }

      const dispatchToken = randomUUID();
      this.activeDispatchClaims.set(created.id, dispatchToken);

      return {
        refund: created,
        payment: updatedPayment,
        summary: formatRefundSummary(updatedAccounting),
        claimedForDispatch: true,
        dispatchClaim: { refundId: created.id, token: dispatchToken },
      };
    });
  }

  /**
   * Executes the provider refund strictly for the caller holding the active
   * dispatch claim, completely outside any Prisma transaction.
   */
  async dispatchReservedRefund(
    tenantId: string,
    reservation: ReserveRefundResult,
  ): Promise<RefundExecutionResponse> {
    if (!reservation.claimedForDispatch || !reservation.dispatchClaim) {
      throw new AppError(
        'Caller does not own dispatch claim for this refund',
        409,
        'REFUND_DISPATCH_NOT_OWNED',
      );
    }

    const { refundId, token } = reservation.dispatchClaim;
    const expectedToken = this.activeDispatchClaims.get(refundId);
    if (!expectedToken || expectedToken !== token) {
      throw new AppError(
        'Refund dispatch ownership claim is invalid or already consumed',
        409,
        'REFUND_DISPATCH_NOT_OWNED',
      );
    }
    // Consume ownership immediately so no duplicate dispatch can reuse this claim.
    this.activeDispatchClaims.delete(refundId);

    const { refund, payment } = reservation;
    const adapter = this.providerRegistry.getProvider(payment.provider);
    if (adapter.supportsRefunds !== true || !adapter.executeRefund) {
      return this.applyRefundOutcome(tenantId, refund.id, {
        outcome: 'FAILED',
        definitiveFailure: true,
        failureCode: 'PAYMENT_PROVIDER_OPERATION_NOT_SUPPORTED',
        failureMessage: `Refunds are not supported for provider ${payment.provider}`,
      });
    }

    const scale = currencyPrecision(refund.currency);
    const exactAmount = refund.amount.toFixed(scale);
    let rawProviderResult: unknown;

    try {
      rawProviderResult = await adapter.executeRefund({
        refundId: refund.id,
        idempotencyKey: refund.idempotencyKey,
        providerPaymentId: payment.providerPaymentId!,
        amount: exactAmount,
        currency: refund.currency,
        reason: refund.reason,
      });
    } catch (error) {
      const reasonCode =
        error instanceof AppError
          ? error.code
          : error instanceof Error &&
              ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'PROVIDER_REFUND_TIMEOUT'
            : 'PROVIDER_REFUND_OUTCOME_UNKNOWN';

      logger.warn(
        {
          operation: 'refund_dispatch',
          tenantId,
          paymentId: payment.id,
          refundId: refund.id,
          reasonCode,
        },
        'Provider refund outcome unknown; retaining reserved capacity for reconciliation',
      );

      await this.applyRefundOutcome(tenantId, refund.id, {
        outcome: 'UNKNOWN',
        reconciliationReason: reasonCode,
      });

      throw new AppError(
        'Refund outcome is unknown; check refund status before retrying',
        503,
        'REFUND_OUTCOME_UNKNOWN',
      );
    }

    const validation = validateProviderRefundResult(
      rawProviderResult,
      refund,
      payment.providerPaymentId!,
    );
    if (!validation.valid) {
      logger.warn(
        {
          operation: 'refund_dispatch',
          tenantId,
          paymentId: payment.id,
          refundId: refund.id,
          reasonCode: validation.reason,
        },
        'Provider refund response malformed or mismatched; flagging for reconciliation',
      );

      await this.applyRefundOutcome(tenantId, refund.id, {
        outcome: 'UNKNOWN',
        reconciliationReason: validation.reason,
      });

      throw new AppError(
        'Provider refund response could not be verified and requires reconciliation',
        502,
        'REFUND_RECONCILIATION_REQUIRED',
      );
    }

    const result = validation.result;
    if (result.outcome === 'UNKNOWN') {
      await this.applyRefundOutcome(tenantId, refund.id, {
        outcome: 'UNKNOWN',
        reconciliationReason:
          normalizeOptionalNonEmpty(result.failureCode) ??
          'PROVIDER_REFUND_OUTCOME_UNKNOWN',
        providerMetadata: result.metadata ?? null,
      });

      throw new AppError(
        'Refund outcome is unknown; check refund status before retrying',
        503,
        'REFUND_OUTCOME_UNKNOWN',
      );
    }

    return this.applyRefundOutcome(tenantId, refund.id, {
      outcome: result.outcome,
      ...(result.amount === undefined ? {} : { amount: result.amount }),
      ...(result.currency === undefined ? {} : { currency: result.currency }),
      ...(result.originalProviderPaymentId === undefined
        ? {}
        : { originalProviderPaymentId: result.originalProviderPaymentId }),
      ...(result.refundId === undefined ? {} : { refundId: result.refundId }),
      ...(result.definitiveFailure === undefined
        ? {}
        : { definitiveFailure: result.definitiveFailure }),
      providerRefundId: result.providerRefundId ?? null,
      providerRefundReference: result.providerRefundReference ?? null,
      providerRefundInvoiceId: result.providerRefundInvoiceId ?? null,
      failureCode: result.failureCode ?? null,
      failureMessage: result.failureMessage ?? null,
      providerMetadata: result.metadata ?? null,
    });
  }

  /**
   * Full orchestrated refund entry point:
   * 1) Reserve capacity & claim dispatch atomically inside Order FOR UPDATE lock.
   * 2) If idempotent replay, return existing refund + summary with zero dispatch.
   * 3) Otherwise execute provider refund outside DB locks and apply outcome.
   */
  async refundPayment(
    tenantId: string,
    paymentId: string,
    input: RequestRefundInput,
  ): Promise<RefundExecutionResponse> {
    const reservation = await this.reserveRefund(tenantId, paymentId, input);

    if (!reservation.claimedForDispatch) {
      return {
        refund: mapPaymentRefundToResponse(reservation.refund),
        payment: mapPaymentToResponse(reservation.payment),
        summary: reservation.summary,
        idempotentReplay: true,
      };
    }

    return this.dispatchReservedRefund(tenantId, reservation);
  }

  /**
   * Internal trusted transition method for advancing a persisted PaymentRefund
   * row based on verified provider or reconciliation evidence.
   */
  async applyRefundOutcome(
    tenantId: string,
    refundId: string,
    input: ApplyRefundOutcomeInput,
  ): Promise<RefundExecutionResponse> {
    const targetStatus: PaymentRefundStatus =
      input.outcome === 'UNKNOWN'
        ? PaymentRefundStatus.RECONCILIATION_REQUIRED
        : PaymentRefundStatus[input.outcome];

    return prisma.$transaction(async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, refundId);
      if (!existing) {
        throw new AppError('Payment refund not found', 404, 'REFUND_NOT_FOUND');
      }

      const locked = await this.repository.lockOrderForUpdate(
        tx,
        tenantId,
        existing.orderId,
      );
      if (!locked) {
        throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
      }

      const currentRefund = await this.repository.findById(
        tx,
        tenantId,
        refundId,
      );
      if (!currentRefund) {
        throw new AppError('Payment refund not found', 404, 'REFUND_NOT_FOUND');
      }

      const { payment } = await this.repository.findPaymentAndOrder(
        tx,
        tenantId,
        currentRefund.paymentId,
        currentRefund.orderId,
      );
      if (!payment) {
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      }

      const incomingProviderRefundId = normalizeOptionalNonEmpty(
        input.providerRefundId,
      );
      const incomingProviderRefundRef = normalizeOptionalNonEmpty(
        input.providerRefundReference,
      );
      const incomingProviderRefundInvoiceId = normalizeOptionalNonEmpty(
        input.providerRefundInvoiceId,
      );

      // Validate provider reference immutability BEFORE any NOOP short-circuit
      // so terminal replays cannot silently accept conflicting identifiers.
      const providerRefConflicts: string[] = [];
      if (
        currentRefund.providerRefundId &&
        incomingProviderRefundId &&
        currentRefund.providerRefundId !== incomingProviderRefundId
      ) {
        providerRefConflicts.push('providerRefundId');
      }
      if (
        currentRefund.providerRefundReference &&
        incomingProviderRefundRef &&
        currentRefund.providerRefundReference !== incomingProviderRefundRef
      ) {
        providerRefConflicts.push('providerRefundReference');
      }
      if (
        currentRefund.providerRefundInvoiceId &&
        incomingProviderRefundInvoiceId &&
        currentRefund.providerRefundInvoiceId !==
          incomingProviderRefundInvoiceId
      ) {
        providerRefConflicts.push('providerRefundInvoiceId');
      }
      if (providerRefConflicts.length > 0) {
        logger.error(
          {
            operation: 'refund_outcome',
            category: 'REFUND_PROVIDER_REFERENCE_CONFLICT',
            tenantId,
            paymentId: payment.id,
            orderId: currentRefund.orderId,
            refundId: currentRefund.id,
            currentStatus: currentRefund.status,
            targetStatus,
            conflictingFields: providerRefConflicts,
          },
          'Provider refund identifier conflict rejected; preserving immutable ledger record',
        );
        throw new AppError(
          `Provider refund identifier conflict on ${providerRefConflicts.join(', ')}`,
          409,
          'REFUND_PROVIDER_REFERENCE_CONFLICT',
        );
      }

      // Validate any newly supplied financial evidence for conflicts BEFORE
      // allowing a terminal NOOP replay.
      const suppliedEvidenceCheck = validateRefundEvidenceCore(
        {
          outcome: input.outcome,
          amount: input.amount,
          currency: input.currency,
          providerRefundId: input.providerRefundId,
          providerRefundReference: input.providerRefundReference,
          providerRefundInvoiceId: input.providerRefundInvoiceId,
          originalProviderPaymentId: input.originalProviderPaymentId,
          refundId: input.refundId,
          definitiveFailure: input.definitiveFailure,
          metadata: input.providerMetadata,
        },
        currentRefund,
        payment.providerPaymentId,
        {
          requireCompleteForSucceeded: false,
          requireDefinitiveForFailed: false,
          persistedProviderRefundId: currentRefund.providerRefundId,
        },
      );
      if (!suppliedEvidenceCheck.valid) {
        throw new AppError(
          `Refund financial evidence mismatch (${suppliedEvidenceCheck.reason})`,
          409,
          suppliedEvidenceCheck.errorCode,
        );
      }

      const nextProviderRefundId =
        incomingProviderRefundId ?? currentRefund.providerRefundId;
      const nextProviderRefundRef =
        incomingProviderRefundRef ?? currentRefund.providerRefundReference;
      const nextProviderRefundInvoiceId =
        incomingProviderRefundInvoiceId ??
        currentRefund.providerRefundInvoiceId;

      let transitionDecision: 'NOOP' | 'TRANSITION';
      try {
        transitionDecision = assertRefundTransitionAllowed(
          currentRefund.status,
          targetStatus,
        );
      } catch (error) {
        logger.error(
          {
            operation: 'refund_outcome',
            category: 'REFUND_TERMINAL_CONFLICT',
            tenantId,
            paymentId: payment.id,
            orderId: currentRefund.orderId,
            refundId: currentRefund.id,
            fromStatus: currentRefund.status,
            toStatus: targetStatus,
          },
          'Conflicting refund state transition rejected; preserving terminal history',
        );
        throw error;
      }

      if (transitionDecision === 'NOOP') {
        const currentRefunds = await this.repository.findRefundsByPayment(
          tx,
          tenantId,
          payment.id,
        );
        const accounting = computeRefundAccountingDecimals(
          payment,
          currentRefunds,
        );
        return {
          refund: mapPaymentRefundToResponse(currentRefund),
          payment: mapPaymentToResponse(payment),
          summary: formatRefundSummary(accounting),
          idempotentReplay: true,
        };
      }

      // Every NEW SUCCEEDED or FAILED settlement transition must pass the same
      // strict evidence & definitive-failure validation regardless of caller.
      const newTransitionCheck = validateRefundEvidenceCore(
        {
          outcome: input.outcome,
          amount: input.amount,
          currency: input.currency,
          providerRefundId: input.providerRefundId,
          providerRefundReference: input.providerRefundReference,
          providerRefundInvoiceId: input.providerRefundInvoiceId,
          originalProviderPaymentId: input.originalProviderPaymentId,
          refundId: input.refundId,
          definitiveFailure: input.definitiveFailure,
          metadata: input.providerMetadata,
        },
        currentRefund,
        payment.providerPaymentId,
        {
          requireCompleteForSucceeded:
            targetStatus === PaymentRefundStatus.SUCCEEDED,
          requireDefinitiveForFailed:
            targetStatus === PaymentRefundStatus.FAILED,
          persistedProviderRefundId: currentRefund.providerRefundId,
        },
      );
      if (!newTransitionCheck.valid) {
        throw new AppError(
          `Refund settlement validation failed (${newTransitionCheck.reason})`,
          409,
          newTransitionCheck.errorCode,
        );
      }

      const now = new Date();

      const updatedRefund = await this.repository.updateRefund(
        tx,
        tenantId,
        currentRefund.id,
        {
          status: targetStatus,
          providerRefundId: nextProviderRefundId,
          providerRefundReference: nextProviderRefundRef,
          providerRefundInvoiceId: nextProviderRefundInvoiceId,
          ...(input.providerMetadata === undefined
            ? {}
            : {
                providerMetadata:
                  input.providerMetadata === null
                    ? null
                    : (input.providerMetadata as Prisma.InputJsonObject),
              }),
          ...(targetStatus === PaymentRefundStatus.SUBMITTED ||
          targetStatus === PaymentRefundStatus.PENDING ||
          targetStatus === PaymentRefundStatus.SUCCEEDED
            ? { submittedAt: currentRefund.submittedAt ?? now }
            : {}),
          ...(targetStatus === PaymentRefundStatus.SUCCEEDED ||
          targetStatus === PaymentRefundStatus.FAILED
            ? { completedAt: currentRefund.completedAt ?? now }
            : {}),
          ...(targetStatus === PaymentRefundStatus.FAILED
            ? {
                failureCode:
                  normalizeOptionalNonEmpty(input.failureCode) ??
                  'REFUND_REJECTED',
                failureMessage:
                  normalizeOptionalNonEmpty(input.failureMessage) ??
                  'Provider rejected refund request',
              }
            : {}),
          ...(targetStatus === PaymentRefundStatus.RECONCILIATION_REQUIRED
            ? {
                reconciliationReason:
                  normalizeOptionalNonEmpty(input.reconciliationReason) ??
                  'PROVIDER_REFUND_OUTCOME_UNKNOWN',
              }
            : targetStatus === PaymentRefundStatus.SUCCEEDED ||
                targetStatus === PaymentRefundStatus.FAILED
              ? { reconciliationReason: null }
              : {}),
        },
      );

      const allRefunds = await this.repository.findRefundsByPayment(
        tx,
        tenantId,
        payment.id,
      );
      const accounting = computeRefundAccountingDecimals(payment, allRefunds);
      const targetAggregateStatus =
        deriveAggregatePaymentStatusFromLedger(accounting);

      const isRollbackToPaid =
        payment.status === PaymentStatus.REFUND_PENDING &&
        targetAggregateStatus === PaymentStatus.PAID;

      let updatedPayment = payment;
      if (payment.status !== targetAggregateStatus) {
        const refundAmountStr = updatedRefund.amount.toFixed(accounting.scale);
        updatedPayment = await this.paymentService.applyPaymentStatusWithClient(
          tenantId,
          payment.id,
          {
            status: targetAggregateStatus,
            refundId: updatedRefund.id,
            ...(targetAggregateStatus === PaymentStatus.PARTIALLY_REFUNDED ||
            targetAggregateStatus === PaymentStatus.REFUNDED
              ? { refundAmount: refundAmountStr }
              : {}),
          },
          tx,
          {
            transition: {
              kind: 'PAYMENT_REFUND',
              refundId: updatedRefund.id,
              ...(isRollbackToPaid ? { allowRollbackToPaid: true } : {}),
            },
            allowRefundPendingRollback: isRollbackToPaid,
            preserveProviderTransactionId: true,
            skipInventorySideEffects: true,
            // Refund-success notifications are emitted below strictly once per settled refundId.
            skipPaymentNotification: true,
          },
        );
      }

      // Emit exactly one refund-success notification per newly SUCCEEDED refund row.
      if (targetStatus === PaymentRefundStatus.SUCCEEDED) {
        const refundAmountStr = updatedRefund.amount.toFixed(accounting.scale);
        const eventType =
          targetAggregateStatus === PaymentStatus.REFUNDED
            ? 'PAYMENT_REFUNDED'
            : 'PAYMENT_PARTIALLY_REFUNDED';
        const isIncrementalFinalRefund =
          eventType === 'PAYMENT_REFUNDED' &&
          updatedRefund.amount.lt(accounting.capturedAmount);
        await paymentNotificationService.createPaymentNotification({
          eventType,
          paymentId: updatedPayment.id,
          expectedTenantId: tenantId,
          tx,
          refundId: updatedRefund.id,
          refundAmount: refundAmountStr,
          ...(isIncrementalFinalRefund
            ? { isIncrementalFinalRefund: true }
            : {}),
          ...(updatedRefund.providerRefundId
            ? { providerTransactionId: updatedRefund.providerRefundId }
            : {}),
        });
      }

      logger.info(
        {
          operation: 'refund_outcome',
          tenantId,
          paymentId: payment.id,
          orderId: currentRefund.orderId,
          refundId: updatedRefund.id,
          fromStatus: currentRefund.status,
          toStatus: updatedRefund.status,
          aggregatePaymentStatus: updatedPayment.status,
        },
        'Payment refund state updated',
      );

      return {
        refund: mapPaymentRefundToResponse(updatedRefund),
        payment: mapPaymentToResponse(updatedPayment),
        summary: formatRefundSummary(accounting),
        idempotentReplay: false,
      };
    });
  }
}
