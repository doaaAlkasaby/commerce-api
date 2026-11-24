import {
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import type { Payment, PaymentRefund } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { currencyPrecision } from '../../common/pricing/currency.js';
import { validateAmount } from '../../common/pricing/money.js';
import type { PaymentRefundSummary } from './payment.types.js';

export const IN_FLIGHT_REFUND_STATUSES: ReadonlySet<PaymentRefundStatus> =
  new Set([
    PaymentRefundStatus.REQUESTED,
    PaymentRefundStatus.SUBMITTED,
    PaymentRefundStatus.PENDING,
    PaymentRefundStatus.RECONCILIATION_REQUIRED,
  ]);

export interface RefundAccountingDecimals {
  capturedAmount: Prisma.Decimal;
  settledRefundedAmount: Prisma.Decimal;
  reservedInFlightAmount: Prisma.Decimal;
  remainingRefundableAmount: Prisma.Decimal;
  currency: string;
  scale: number;
}

export function computeRefundAccountingDecimals(
  payment: Pick<Payment, 'amount' | 'currency' | 'provider' | 'method'>,
  refunds: ReadonlyArray<
    Pick<PaymentRefund, 'amount' | 'currency' | 'provider' | 'method' | 'status'>
  >,
): RefundAccountingDecimals {
  const scale = currencyPrecision(payment.currency);
  const capturedAmount = validateAmount(
    payment.amount.toString(),
    payment.currency,
  );
  if (capturedAmount.lte(0)) {
    throw new AppError(
      'Captured payment amount is invalid for refund accounting',
      409,
      'REFUND_LEDGER_INCONSISTENT',
    );
  }

  let settledRefundedAmount = new Prisma.Decimal(0);
  let reservedInFlightAmount = new Prisma.Decimal(0);

  for (const refund of refunds) {
    if (
      refund.currency !== payment.currency ||
      refund.provider !== payment.provider ||
      refund.method !== payment.method
    ) {
      throw new AppError(
        'Refund ledger record does not match payment currency, provider, or method',
        409,
        'REFUND_LEDGER_INCONSISTENT',
      );
    }

    const rowAmount = new Prisma.Decimal(refund.amount);
    if (!rowAmount.isFinite() || rowAmount.lte(0)) {
      throw new AppError(
        'Refund ledger contains a non-positive amount',
        409,
        'REFUND_LEDGER_INCONSISTENT',
      );
    }

    if (refund.status === PaymentRefundStatus.SUCCEEDED) {
      settledRefundedAmount = settledRefundedAmount.add(rowAmount);
    } else if (IN_FLIGHT_REFUND_STATUSES.has(refund.status)) {
      reservedInFlightAmount = reservedInFlightAmount.add(rowAmount);
    }
  }

  const totalAllocated = settledRefundedAmount.add(reservedInFlightAmount);
  if (totalAllocated.gt(capturedAmount)) {
    throw new AppError(
      'Refund ledger totals exceed captured payment amount',
      409,
      'REFUND_LEDGER_INCONSISTENT',
    );
  }

  const remainingRefundableAmount = capturedAmount.sub(totalAllocated);
  if (remainingRefundableAmount.lt(0)) {
    throw new AppError(
      'Remaining refundable balance cannot be negative',
      409,
      'REFUND_LEDGER_INCONSISTENT',
    );
  }

  return {
    capturedAmount,
    settledRefundedAmount,
    reservedInFlightAmount,
    remainingRefundableAmount,
    currency: payment.currency,
    scale,
  };
}

export function formatRefundSummary(
  accounting: RefundAccountingDecimals,
): PaymentRefundSummary {
  return {
    capturedAmount: accounting.capturedAmount.toFixed(accounting.scale),
    settledRefundedAmount: accounting.settledRefundedAmount.toFixed(
      accounting.scale,
    ),
    reservedInFlightAmount: accounting.reservedInFlightAmount.toFixed(
      accounting.scale,
    ),
    remainingRefundableAmount: accounting.remainingRefundableAmount.toFixed(
      accounting.scale,
    ),
    currency: accounting.currency,
  };
}

export function deriveAggregatePaymentStatusFromLedger(
  accounting: RefundAccountingDecimals,
): PaymentStatus {
  const { capturedAmount, settledRefundedAmount, reservedInFlightAmount } =
    accounting;

  if (settledRefundedAmount.add(reservedInFlightAmount).gt(capturedAmount)) {
    throw new AppError(
      'Refund ledger totals exceed captured payment amount',
      409,
      'REFUND_LEDGER_INCONSISTENT',
    );
  }

  if (settledRefundedAmount.equals(capturedAmount)) {
    return PaymentStatus.REFUNDED;
  }

  if (settledRefundedAmount.gt(0)) {
    return PaymentStatus.PARTIALLY_REFUNDED;
  }

  if (reservedInFlightAmount.gt(0)) {
    return PaymentStatus.REFUND_PENDING;
  }

  return PaymentStatus.PAID;
}
