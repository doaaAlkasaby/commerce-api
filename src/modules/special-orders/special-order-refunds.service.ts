import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import { currencyPrecision } from '../../common/pricing/currency.js';
import { parseDecimal } from '../../common/pricing/money.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry.js';
import {
  financialRelations,
  unallocatedRefundCapacity,
  type FinancialOrder,
} from './special-order-financial-summary.js';
import { notify, type Actor, type Scope } from './special-order.service.js';

export type ResolutionTx = Prisma.TransactionClient;

export function resolutionConflict(code: string, message: string): never {
  throw new AppError(message, 409, code);
}

export async function lockResolutionOrder(
  tx: ResolutionTx,
  scope: Scope,
  id: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SpecialOrder" WHERE id=${id} AND "tenantId"=${scope.tenantId}
      AND (${scope.customerId ?? null}::text IS NULL OR "customerId"=${scope.customerId ?? null})
    FOR UPDATE
  `;
  if (!rows.length)
    throw new AppError(
      'Special order not found',
      404,
      'SPECIAL_ORDER_NOT_FOUND',
    );
}

export async function resolutionEvent(
  tx: ResolutionTx,
  actor: Actor,
  orderId: string,
  key: string,
  action: string,
  reason: string,
  evidence: Prisma.InputJsonObject,
) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ action, reason, evidence }))
    .digest('hex');
  const prior = await tx.specialOrderResolutionEvent.findUnique({
    where: { orderId_key: { orderId, key } },
  });
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      resolutionConflict(
        'SPECIAL_RESOLUTION_KEY_CONFLICT',
        'Use a new idempotency key for a different action',
      );
    return { record: prior, replayed: true };
  }
  const record = await tx.specialOrderResolutionEvent.create({
    data: {
      tenantId: actor.tenantId,
      orderId,
      actorId: actor.userId,
      key,
      action,
      reason,
      evidence,
      fingerprint,
    },
  });
  return { record, replayed: false };
}

export async function allocateRefunds(
  tx: ResolutionTx,
  order: FinancialOrder,
  sourceKey: string,
  cap?: Prisma.Decimal,
) {
  const payments = order.paymentObligations
    .flatMap(({ attempts, cashSettlement }) => [
      ...attempts.flatMap((attempt) => attempt.settlements),
      ...(cashSettlement ? [cashSettlement] : []),
    ])
    .filter(({ attributable }) => attributable);
  let available = cap ?? null;
  for (const payment of payments.sort(
    (a, b) =>
      a.verifiedAt.getTime() - b.verifiedAt.getTime() ||
      a.id.localeCompare(b.id),
  )) {
    if (available && !available.gt(0)) break;
    if (available && payment.currency !== order.currency) continue;
    const prior = await tx.specialOrderRefund.findMany({
      where: { settlementId: payment.id },
    });
    if (prior.some((refund) => refund.sourceKey === sourceKey)) continue;
    const capacity = unallocatedRefundCapacity(payment.amount.toFixed(), prior);
    const amount = available && available.lt(capacity) ? available : capacity;
    if (!amount.gt(0)) continue;
    await tx.specialOrderRefund.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        settlementId: payment.id,
        sourceKey,
        amount,
        currency: payment.currency,
      },
    });
    if (available) available = available.minus(amount);
  }
}

export async function allocateCancelledCollections(
  tx: ResolutionTx,
  orderId: string,
) {
  const order = await tx.specialOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: financialRelations,
  });
  if (order.cancellationStatus === 'CANCELLED')
    await allocateRefunds(tx, order, 'CANCELLATION');
}

const refundInclude = {
  settlement: {
    include: {
      attempt: {
        include: {
          providerAccount: true,
          _count: { select: { settlements: true } },
        },
      },
    },
  },
} satisfies Prisma.SpecialOrderRefundInclude;

type ExecutionRefund = Prisma.SpecialOrderRefundGetPayload<{
  include: typeof refundInclude;
}>;

function refundExecution(refund: ExecutionRefund) {
  const attempt = refund.settlement.attempt;
  const method = attempt ? 'ONLINE' : 'CASH';
  const blocked = (reason: string) => ({
    canExecute: false,
    reason,
    method,
    requiredEvidence: null,
  });
  if (!['DUE', 'UNSUPPORTED'].includes(refund.state))
    return blocked(`SPECIAL_REFUND_${refund.state}`);
  if (!attempt)
    return {
      canExecute: true,
      reason: null,
      method,
      requiredEvidence: 'CASH_REPAYMENT_REFERENCE',
    };
  if (
    attempt.providerEnvironment !== 'MOCK' ||
    env.PAYMENT_PROVIDER !== 'MOCK' ||
    env.NODE_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
  )
    return blocked('SPECIAL_REFUND_PROVIDER_UNSUPPORTED');
  if (attempt.credentialVersion !== attempt.providerAccount.credentialVersion)
    return blocked('SPECIAL_REFUND_CREDENTIAL_CHANGED');
  if (!attempt.invoiceId) return blocked('SPECIAL_REFUND_INVOICE_MISSING');
  if (attempt._count.settlements !== 1)
    return blocked('SPECIAL_REFUND_MULTIPLE_COLLECTIONS');
  const adapter = new PaymentProviderRegistry().getProvider(attempt.provider);
  if (!adapter.supportsRefunds || !adapter.executeRefund)
    return blocked('SPECIAL_REFUND_PROVIDER_UNSUPPORTED');
  return {
    canExecute: true,
    reason: null,
    method,
    requiredEvidence: 'VERIFIED_PROVIDER_RESULT',
  };
}

export async function refundCapabilities(tenantId: string, orderId: string) {
  const refunds = await prisma.specialOrderRefund.findMany({
    where: { tenantId, orderId },
    include: refundInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return new Map(refunds.map((refund) => [refund.id, refundExecution(refund)]));
}

export async function executeSpecialRefund(
  actor: Actor,
  orderId: string,
  key: string,
  input: {
    refundId: string;
    reference?: string | undefined;
    reason: string;
  },
) {
  const claim = await prisma.$transaction(async (tx) => {
    await lockResolutionOrder(tx, { tenantId: actor.tenantId }, orderId);
    const refund = await tx.specialOrderRefund.findFirst({
      where: { id: input.refundId, tenantId: actor.tenantId, orderId },
      include: refundInclude,
    });
    if (!refund)
      throw new AppError(
        'Special order refund not found',
        404,
        'SPECIAL_REFUND_NOT_FOUND',
      );
    const logged = await resolutionEvent(
      tx,
      actor,
      orderId,
      key,
      'REFUND_EXECUTE',
      input.reason,
      {
        refundId: input.refundId,
        ...(input.reference && { reference: input.reference }),
      },
    );
    if (logged.replayed)
      return { refund, claimed: false, eventId: logged.record.id };
    if (!['DUE', 'UNSUPPORTED'].includes(refund.state))
      resolutionConflict(
        'SPECIAL_REFUND_STATE',
        'This refund cannot be executed again',
      );
    const { attempt } = refund.settlement;
    if (!attempt) {
      if (!input.reference)
        resolutionConflict(
          'SPECIAL_CASH_REFUND_EVIDENCE_REQUIRED',
          'Record the actual repayment reference',
        );
      const result = await tx.specialOrderRefund.update({
        where: { id: refund.id },
        data: {
          state: 'SETTLED',
          outcome: {
            method: 'CASH',
            reference: input.reference,
            actorId: actor.userId,
            at: new Date().toISOString(),
          },
        },
        include: refundInclude,
      });
      await refundNotice(tx, refund.orderId, refund.id);
      return { refund: result, claimed: false, eventId: logged.record.id };
    }
    if (input.reference)
      resolutionConflict(
        'SPECIAL_ONLINE_REFUND_EVIDENCE',
        'Online refunds require provider evidence',
      );
    if (!refundExecution(refund).canExecute) {
      const result = await tx.specialOrderRefund.update({
        where: { id: refund.id },
        data: { state: 'UNSUPPORTED' },
        include: refundInclude,
      });
      return { refund: result, claimed: false, eventId: logged.record.id };
    }
    const result = await tx.specialOrderRefund.update({
      where: { id: refund.id },
      data: { state: 'IN_PROGRESS' },
      include: refundInclude,
    });
    return { refund: result, claimed: true, eventId: logged.record.id };
  });
  if (!claim.claimed) return publicRefund(claim.refund, true);
  const invoice = claim.refund.settlement.attempt?.invoiceId;
  const adapter = new PaymentProviderRegistry().getProvider('MYFATOORAH');
  let state: 'UNKNOWN' | 'DUE' | 'SETTLED' = 'UNKNOWN';
  let externalId: string | undefined;
  let observed = 'NO_TRUSTED_FINAL_RESULT';
  if (invoice && adapter.supportsRefunds && adapter.executeRefund) {
    try {
      const expectedAmount = claim.refund.amount.toFixed(
        currencyPrecision(claim.refund.currency),
      );
      const proof = await adapter.executeRefund({
        refundId: claim.refund.id,
        idempotencyKey: claim.eventId,
        providerPaymentId: invoice,
        amount: expectedAmount,
        currency: claim.refund.currency,
        reason: input.reason,
      });
      if (
        proof.refundId === claim.refund.id &&
        proof.originalProviderPaymentId === invoice &&
        proof.currency === claim.refund.currency &&
        typeof proof.amount === 'string' &&
        parseDecimal(proof.amount).equals(expectedAmount)
      ) {
        if (
          proof.outcome === 'SUCCEEDED' &&
          proof.providerRefundId &&
          proof.providerRefundInvoiceId === invoice
        ) {
          state = 'SETTLED';
          externalId = proof.providerRefundId;
        } else if (
          proof.outcome === 'FAILED' &&
          proof.definitiveFailure === true
        )
          state = 'DUE';
        observed = proof.outcome;
      }
    } catch {
      /* An exception cannot prove a failed refund. */
    }
  }
  return prisma.$transaction(async (tx) => {
    await lockResolutionOrder(tx, { tenantId: actor.tenantId }, orderId);
    if (externalId)
      await tx.$queryRaw`SELECT true AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended('special-refund:' || ${externalId}, 0))) lock`;
    if (
      externalId &&
      (await tx.specialOrderRefund.findUnique({
        where: { providerRefundId: externalId },
      }))
    ) {
      externalId = undefined;
      state = 'UNKNOWN';
      observed = 'PROVIDER_REFUND_ID_CONFLICT';
    }
    const outcome = { providerOutcome: observed, at: new Date().toISOString() };
    await resolutionEvent(
      tx,
      actor,
      orderId,
      `refund-result:${claim.eventId}`,
      'REFUND_RESULT',
      'Provider refund response',
      { refundId: claim.refund.id, ...outcome },
    );
    const refund = await tx.specialOrderRefund.update({
      where: { id: claim.refund.id },
      data: {
        state,
        outcome,
        ...(externalId && { providerRefundId: externalId }),
      },
    });
    if (state === 'SETTLED') await refundNotice(tx, orderId, refund.id);
    return publicRefund(refund, true);
  });
}

async function refundNotice(
  tx: ResolutionTx,
  orderId: string,
  refundId: string,
) {
  const order = await tx.specialOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { requestId: true, customerId: true, tenantId: true },
  });
  await notify(
    tx,
    order.tenantId,
    order.requestId,
    order.customerId,
    'SPECIAL_ORDER_REFUND_SETTLED',
    refundId,
  );
}

type Refund = FinancialOrder['refunds'][number];
export function publicRefund(refund: Refund, merchant: boolean) {
  return {
    id: refund.id,
    amount: refund.amount.toFixed(currencyPrecision(refund.currency)),
    currency: refund.currency,
    state: refund.state,
    updatedAt: refund.updatedAt,
    ...(merchant && {
      settlementId: refund.settlementId,
      outcome: refund.outcome,
      providerRefundId: refund.providerRefundId,
    }),
  };
}
