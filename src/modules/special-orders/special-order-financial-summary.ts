import { currencyPrecision } from '../../common/pricing/currency.js';
import { parseDecimal } from '../../common/pricing/money.js';
import type {
  Prisma,
  SpecialOrderPaymentAttempt,
} from '../../generated/prisma/client.js';

export const financialRelations = {
  refunds: { orderBy: { createdAt: 'asc' } },
  paymentObligations: {
    orderBy: { kind: 'asc' },
    include: {
      cashSettlement: true,
      attempts: {
        orderBy: { createdAt: 'desc' },
        include: { settlements: true },
      },
    },
  },
} satisfies Prisma.SpecialOrderInclude;

export type FinancialOrder = Prisma.SpecialOrderGetPayload<{
  include: typeof financialRelations;
}>;
export type OrderObligation = FinancialOrder['paymentObligations'][number];

function attemptCanPay(attempt: SpecialOrderPaymentAttempt) {
  return (
    attempt.initiationState === 'INITIATED' &&
    ['PENDING', 'REQUIRES_ACTION'].includes(attempt.status) &&
    !attempt.conflictCode
  );
}

export function presentAttempt(
  attempt: SpecialOrderPaymentAttempt,
  canPay = false,
) {
  return {
    id: attempt.id,
    obligationId: attempt.obligationId,
    provider: attempt.provider,
    status: attempt.status,
    initiationState: attempt.initiationState,
    checkoutUrl: canPay && attemptCanPay(attempt) ? attempt.checkoutUrl : null,
    conflictCode: attempt.conflictCode,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

export function paymentPosition(order: FinancialOrder) {
  const attempts = order.paymentObligations.flatMap(({ attempts }) => attempts);
  const collected = [
    ...attempts.flatMap(({ settlements }) => settlements),
    ...order.paymentObligations.flatMap(({ cashSettlement }) =>
      cashSettlement ? [cashSettlement] : [],
    ),
  ]
    .filter(
      ({ attributable, currency }) =>
        attributable && currency === order.currency,
    )
    .reduce((sum, { amount }) => sum.plus(amount.toFixed()), parseDecimal('0'));
  const initialCollected = order.paymentObligations
    .filter(({ kind }) => kind === 'INITIAL')
    .flatMap(({ attempts }) => attempts)
    .flatMap(({ settlements }) => settlements)
    .filter(
      ({ attributable, currency }) =>
        attributable && currency === order.currency,
    )
    .reduce((sum, { amount }) => sum.plus(amount.toFixed()), parseDecimal('0'));
  const outstanding = parseDecimal(order.grandTotal.toFixed()).minus(collected);
  const conflict =
    attempts.find(({ conflictCode }) => conflictCode)?.conflictCode ??
    (outstanding.lt(0) ? 'SPECIAL_PAYMENT_OVERPAYMENT' : null);
  const initial = order.paymentObligations.find(
    ({ kind }) => kind === 'INITIAL',
  );
  return { initial, collected, initialCollected, outstanding, conflict };
}

export function obligationCanPay(
  order: FinancialOrder,
  obligation: OrderObligation,
) {
  const { conflict, initialCollected, outstanding } = paymentPosition(order);
  if (
    conflict ||
    order.cancellationStatus !== 'NONE' ||
    obligation.method !== 'ONLINE' ||
    obligation.currency !== order.currency ||
    !obligation.attempts.every(
      (attempt) =>
        attemptCanPay(attempt) ||
        ['FAILED', 'CANCELLED'].includes(attempt.status),
    )
  )
    return false;
  if (obligation.kind === 'INITIAL') {
    return (
      order.state === 'PENDING_SOURCING' &&
      obligation.amount.equals(order.initialPayment) &&
      obligation.expiresAt !== null &&
      obligation.expiresAt.getTime() > Date.now() &&
      initialCollected.isZero()
    );
  }
  return (
    order.state === 'READY_FOR_FULFILLMENT' &&
    order.readyAt !== null &&
    order.warehouseId !== null &&
    initialCollected.gte(order.initialPayment) &&
    obligation.amount.equals(order.remainingBalance) &&
    outstanding.equals(obligation.amount)
  );
}

export function financialSummary(order: FinancialOrder) {
  const { initial, collected, initialCollected, outstanding, conflict } =
    paymentPosition(order);
  const format = (amount: Prisma.Decimal) =>
    amount.toFixed(currencyPrecision(order.currency));
  const refunded = order.refunds
    .filter(
      (refund) =>
        refund.state === 'SETTLED' && refund.currency === order.currency,
    )
    .reduce(
      (sum, refund) => sum.plus(refund.amount.toFixed()),
      parseDecimal('0'),
    );
  const refundDue = order.refunds
    .filter(
      (refund) =>
        refund.state !== 'SETTLED' && refund.currency === order.currency,
    )
    .reduce(
      (sum, refund) => sum.plus(refund.amount.toFixed()),
      parseDecimal('0'),
    );
  return {
    currency: order.currency,
    settledRefunds: format(refunded),
    refundDue: format(refundDue),
    netCollected: format(collected.minus(refunded)),
    grandTotal: format(order.grandTotal),
    requiredInitialPayment: format(order.initialPayment),
    verifiedCollected: format(collected),
    outstanding: format(
      order.cancellationStatus === 'CANCELLED' || outstanding.lt(0)
        ? parseDecimal('0')
        : outstanding,
    ),
    overpaid: format(
      outstanding.lt(0) ? outstanding.negated() : parseDecimal('0'),
    ),
    status: collected.isZero()
      ? 'PENDING'
      : outstanding.gt(0)
        ? 'PARTIALLY_PAID'
        : 'PAID',
    initialPaymentDeadline: initial?.expiresAt ?? null,
    initialSourcingPrerequisiteSatisfied:
      !conflict &&
      order.cancellationStatus === 'NONE' &&
      initialCollected.gte(order.initialPayment.toFixed()),
    furtherPaymentAllowed: order.paymentObligations.some((obligation) =>
      obligationCanPay(order, obligation),
    ),
    onlinePaymentPrerequisiteSatisfied:
      !conflict &&
      order.paymentObligations
        .filter(({ method }) => method === 'ONLINE')
        .every(({ amount, attempts }) =>
          attempts
            .flatMap(({ settlements }) => settlements)
            .filter(
              ({ attributable, currency }) =>
                attributable && currency === order.currency,
            )
            .reduce(
              (sum, settlement) => sum.plus(settlement.amount.toFixed()),
              parseDecimal('0'),
            )
            .gte(amount),
        ),
    financialConflict: conflict,
    latestInitialAttempt: initial?.attempts[0]
      ? presentAttempt(initial.attempts[0])
      : null,
  };
}

export function unallocatedRefundCapacity(
  original: string,
  allocations: { amount: { toFixed(): string } }[],
) {
  return allocations.reduce(
    (remaining, refund) => remaining.minus(refund.amount.toFixed()),
    parseDecimal(original),
  );
}

function settlementCapacity(
  order: FinancialOrder,
  settlement: {
    id: string;
    amount: Prisma.Decimal;
    currency: string;
    attributable: boolean;
  },
) {
  const allocations = order.refunds.filter(
    (refund) => refund.settlementId === settlement.id,
  );
  const settled = allocations.filter((refund) => refund.state === 'SETTLED');
  const outstanding = allocations.filter(
    (refund) => refund.state !== 'SETTLED',
  );
  const format = (value: Prisma.Decimal) =>
    value.toFixed(currencyPrecision(settlement.currency));
  const original = settlement.amount.toFixed();
  return {
    currency: settlement.currency,
    originalVerifiedAmount: format(settlement.amount),
    settledRefundAmount: format(
      unallocatedRefundCapacity('0', settled).negated(),
    ),
    outstandingAllocatedAmount: format(
      unallocatedRefundCapacity('0', outstanding).negated(),
    ),
    unallocatedRefundableCapacity: format(
      settlement.attributable
        ? unallocatedRefundCapacity(original, allocations)
        : parseDecimal('0'),
    ),
  };
}

export function presentObligations(order: FinancialOrder, merchant: boolean) {
  const format = (amount: Prisma.Decimal) =>
    amount.toFixed(currencyPrecision(order.currency));
  if (!order.paymentObligations.length && order.initialPayment.isZero()) {
    return [
      {
        id: null,
        kind: 'BALANCE',
        method: 'CASH',
        amount: format(order.grandTotal),
        currency: order.currency,
        expiresAt: null,
        payable: false,
      },
    ];
  }
  return order.paymentObligations.map((obligation) => ({
    id: obligation.id,
    kind: obligation.kind,
    method: obligation.method,
    amount: format(obligation.amount),
    currency: obligation.currency,
    expiresAt: obligation.expiresAt,
    payable: obligationCanPay(order, obligation),
    ...(merchant && {
      cashSettlement: obligation.cashSettlement && {
        ...obligation.cashSettlement,
        refundableCapacity: settlementCapacity(
          order,
          obligation.cashSettlement,
        ),
      },
      attempts: obligation.attempts.map((attempt) => ({
        ...presentAttempt(attempt),
        invoiceId: attempt.invoiceId,
        providerAccountId: attempt.providerAccountId,
        providerEnvironment: attempt.providerEnvironment,
        settlements: attempt.settlements.map((settlement) => ({
          id: settlement.id,
          transactionId: settlement.transactionId,
          providerTransactionId: settlement.providerTransactionId,
          amount: settlement.amount.toFixed(),
          currency: settlement.currency,
          attributable: settlement.attributable,
          verifiedAt: settlement.verifiedAt,
          refundableCapacity: settlementCapacity(order, settlement),
        })),
      })),
    }),
  }));
}
