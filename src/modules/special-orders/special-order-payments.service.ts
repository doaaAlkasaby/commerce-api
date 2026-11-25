import { allocateCancelledCollections } from './special-order-refunds.service.js';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import { currencyPrecision } from '../../common/pricing/currency.js';
import { parseDecimal } from '../../common/pricing/money.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { MyFatoorahEvent } from '../payments/myfatoorah.webhook.js';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry.js';
import type { VerifiedProviderPayment } from '../payments/payment.types.js';
import {
  financialRelations,
  financialSummary,
  obligationCanPay,
  presentAttempt,
  presentObligations,
  type FinancialOrder,
} from './special-order-financial-summary.js';
import {
  specialOrderMarket,
  specialProviderAccount,
  unavailableProvider,
} from './special-order-provider.js';
import { notify, type Scope } from './special-order.service.js';

const RECHECK_MS = 60_000;
const LEASE_MS = 60_000;
const attemptRelations = {
  obligation: { include: { order: true } },
} satisfies Prisma.SpecialOrderPaymentAttemptInclude;
type Attempt = Prisma.SpecialOrderPaymentAttemptGetPayload<{
  include: typeof attemptRelations;
}>;
type Tx = Prisma.TransactionClient;

function missing(): never {
  throw new AppError(
    'Special order payment not found',
    404,
    'SPECIAL_PAYMENT_NOT_FOUND',
  );
}
function conflict(code: string): never {
  throw new AppError(
    'Special order payment requires reconciliation or is unavailable',
    409,
    code,
  );
}

async function findOrder(tx: Tx, scope: Scope, id: string) {
  const order = await tx.specialOrder.findFirst({
    where: { ...scope, id },
    include: financialRelations,
  });
  return order ?? missing();
}

async function lockOrder(tx: Tx, scope: Scope, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SpecialOrder" WHERE id = ${id} AND "tenantId" = ${scope.tenantId}
      AND (${scope.customerId ?? null}::text IS NULL OR "customerId" = ${scope.customerId ?? null})
    FOR UPDATE
  `;
  if (!rows.length) missing();
  return findOrder(tx, scope, id);
}

async function findAttempt(scope: Scope, orderId: string, attemptId: string) {
  return (
    (await prisma.specialOrderPaymentAttempt.findFirst({
      where: {
        id: attemptId,
        tenantId: scope.tenantId,
        obligation: { orderId, order: scope },
      },
      include: attemptRelations,
    })) ?? missing()
  );
}

export async function getPaymentDetails(
  scope: Scope,
  id: string,
  merchant = false,
) {
  const order = await findOrder(prisma, scope, id);
  const summary = financialSummary(order);
  const binding = summary.furtherPaymentAllowed
    ? await specialProviderAccount(
        prisma,
        order.tenantId,
        specialOrderMarket(order.commercialTerms),
        order.currency,
      )
    : null;
  const allowed = Boolean(binding);
  return {
    ...summary,
    furtherPaymentAllowed: allowed,
    obligations: presentObligations(order, merchant).map((obligation) => ({
      ...obligation,
      payable: allowed && obligation.payable,
    })),
  };
}

async function formatAttempt(order: FinancialOrder, attempt: Attempt) {
  const obligation = order.paymentObligations.find(
    ({ id }) => id === attempt.obligationId,
  );
  const binding =
    obligation && obligationCanPay(order, obligation)
      ? await specialProviderAccount(
          prisma,
          order.tenantId,
          specialOrderMarket(order.commercialTerms),
          order.currency,
        )
      : null;
  return presentAttempt(
    attempt,
    Boolean(
      binding &&
      binding.account.id === attempt.providerAccountId &&
      binding.account.credentialVersion === attempt.credentialVersion,
    ),
  );
}

export async function getSpecialAttempt(
  scope: Scope,
  orderId: string,
  id: string,
) {
  const attempt = await findAttempt(scope, orderId, id);
  return formatAttempt(await findOrder(prisma, scope, orderId), attempt);
}

async function accountForAttempt(attempt: Attempt, initiating = false) {
  const { order, currency } = attempt.obligation;
  if (initiating) {
    const binding = await specialProviderAccount(
      prisma,
      order.tenantId,
      specialOrderMarket(order.commercialTerms),
      currency,
    );
    if (
      !binding ||
      binding.account.id !== attempt.providerAccountId ||
      binding.account.environment !== attempt.providerEnvironment ||
      binding.account.credentialVersion !== attempt.credentialVersion
    )
      unavailableProvider();
    return binding.adapter;
  }

  // Read-only verification continues for already-issued invoices after tenant
  // authorization is revoked, provided the bound gateway credential still matches.
  const environment =
    env.PAYMENT_PROVIDER === 'MOCK'
      ? 'MOCK'
      : env.PAYMENT_PROVIDER === 'MYFATOORAH'
        ? 'SANDBOX'
        : null;
  if (attempt.providerEnvironment !== environment) unavailableProvider();
  const account = await prisma.paymentProviderAccount.findFirst({
    where: {
      id: attempt.providerAccountId,
      provider: attempt.provider,
      environment,
      credentialVersion: attempt.credentialVersion,
      currency,
      countryCode: 'KWT',
      ...(environment === 'SANDBOX' && {
        credentialRef: 'env:MYFATOORAH_API_TOKEN',
      }),
    },
    select: { id: true },
  });
  if (!account) unavailableProvider();
  return new PaymentProviderRegistry().getProvider(attempt.provider);
}

export async function initiateSpecialPayment(
  scope: Scope,
  orderId: string,
  obligationId: string,
  key: string,
) {
  const claim = await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, scope, orderId);
    const obligation = order.paymentObligations.find(
      ({ id }) => id === obligationId,
    );
    if (!obligation) missing();
    const previous = obligation.attempts.find(
      ({ idempotencyKey }) => idempotencyKey === key,
    );
    if (previous) return { id: previous.id, token: null };
    if (!obligationCanPay(order, obligation))
      conflict('SPECIAL_PAYMENT_NOT_PAYABLE');
    if (
      obligation.attempts.some(
        ({ status }) => status !== 'FAILED' && status !== 'CANCELLED',
      )
    ) {
      conflict('SPECIAL_PAYMENT_OUTCOME_UNRESOLVED');
    }
    const binding = await specialProviderAccount(
      tx,
      order.tenantId,
      specialOrderMarket(order.commercialTerms),
      obligation.currency,
    );
    if (!binding) unavailableProvider();
    const { account, adapter } = binding;
    adapter.validatePayment?.({
      amount: obligation.amount.toFixed(currencyPrecision(obligation.currency)),
      currency: obligation.currency,
    });
    const token = randomUUID();
    const leaseUntil = new Date(Date.now() + LEASE_MS);
    const attempt = await tx.specialOrderPaymentAttempt.create({
      data: {
        tenantId: scope.tenantId,
        obligationId,
        idempotencyKey: key,
        provider: account.provider,
        providerAccountId: account.id,
        providerEnvironment: account.environment,
        credentialVersion: account.credentialVersion,
        claimToken: token,
        leaseUntil,
        recheckAt: leaseUntil,
      },
      select: { id: true },
    });
    return { id: attempt.id, token };
  });
  if (claim.token)
    await executeInitiation(
      await findAttempt(scope, orderId, claim.id),
      claim.token,
    );
  return {
    attempt: await getSpecialAttempt(scope, orderId, claim.id),
    replayed: claim.token === null,
  };
}

const providerOrderReference = (id: string) => `SO:${id}`;

async function executeInitiation(attempt: Attempt, token: string) {
  const { orderId, currency, amount } = attempt.obligation;
  try {
    const adapter = await accountForAttempt(attempt, true);
    const result = await adapter.createPayment({
      idempotencyKey: attempt.id,
      paymentId: attempt.id,
      orderId: providerOrderReference(orderId),
      currency,
      amount: amount.toFixed(currencyPrecision(currency)),
      method: 'CARD',
    });
    if (
      !result.providerPaymentId ||
      !result.checkoutUrl ||
      !['PENDING', 'REQUIRES_ACTION'].includes(result.status)
    ) {
      conflict('SPECIAL_PAYMENT_INITIATION_UNVERIFIED');
    }
    await prisma.specialOrderPaymentAttempt.updateMany({
      where: {
        id: attempt.id,
        claimToken: token,
        initiationState: 'IN_PROGRESS',
        invoiceId: null,
      },
      data: {
        initiationState: 'INITIATED',
        status: 'REQUIRES_ACTION',
        invoiceId: result.providerPaymentId,
        checkoutUrl: result.checkoutUrl,
        claimToken: null,
        leaseUntil: null,
        recheckAt: new Date(Date.now() + RECHECK_MS),
        ...(attempt.providerEnvironment === 'MOCK' && {
          mockStatus: 'REQUIRES_ACTION',
        }),
      },
    });
  } catch (error) {
    const identityConflict =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2004'].includes(error.code);
    await prisma.specialOrderPaymentAttempt.updateMany({
      where: {
        id: attempt.id,
        claimToken: token,
        initiationState: 'IN_PROGRESS',
        invoiceId: null,
      },
      data: {
        initiationState: 'UNKNOWN',
        claimToken: null,
        leaseUntil: null,
        recheckAt:
          attempt.providerEnvironment === 'MOCK' && !identityConflict
            ? new Date(Date.now() + RECHECK_MS)
            : null,
        ...(identityConflict && {
          conflictCode: 'SPECIAL_PAYMENT_PROVIDER_IDENTITY_CONFLICT',
        }),
      },
    });
  }
}

export async function verifySpecialPayment(
  scope: Scope,
  orderId: string,
  attemptId: string,
) {
  const attempt = await findAttempt(scope, orderId, attemptId);
  if (attempt.invoiceId) await verifyKnownInvoice(attempt);
  return {
    attempt: await getSpecialAttempt(scope, orderId, attemptId),
    financials: await getPaymentDetails(scope, orderId),
  };
}

async function verifyKnownInvoice(
  attempt: Attempt,
  invoiceId = attempt.invoiceId,
  event?: MyFatoorahEvent,
  observed?: VerifiedProviderPayment,
) {
  const adapter = await accountForAttempt(attempt);
  if (!invoiceId || !adapter.getPaymentStatus) unavailableProvider();
  let result: VerifiedProviderPayment;
  try {
    result =
      observed ??
      (await adapter.getPaymentStatus(invoiceId, {
        allowMultipleCollections: true,
      }));
  } catch (error) {
    if (
      !(error instanceof AppError) ||
      ![
        'MYFATOORAH_STATUS_UNVERIFIED',
        'MYFATOORAH_AMOUNT_OR_CURRENCY_MISMATCH',
        'MYFATOORAH_CURRENCY_MISMATCH',
        'MYFATOORAH_IDENTITY_MISMATCH',
      ].includes(error.code)
    )
      throw error;
    await prisma.$transaction(async (tx) => {
      await lockOrder(
        tx,
        { tenantId: attempt.tenantId },
        attempt.obligation.orderId,
      );
      await flagConflict(tx, attempt.id, error.code);
    });
    return;
  }
  if (
    result.invoiceId !== invoiceId ||
    (event &&
      !result.transactionPaymentIds.includes(event.transactionPaymentId))
  )
    conflict(evidenceConflict);
  await applyEvidence(attempt, result);
}

const evidenceConflict = 'SPECIAL_PAYMENT_PROVIDER_IDENTITY_CONFLICT';

async function flagConflict(tx: Tx, attemptId: string, code: string) {
  await tx.specialOrderPaymentAttempt.update({
    where: { id: attemptId },
    data: {
      conflictCode: code,
      checkoutUrl: null,
      claimToken: null,
      leaseUntil: null,
      recheckAt: null,
    },
  });
}

async function applyEvidence(attempt: Attempt, proof: VerifiedProviderPayment) {
  const { order } = attempt.obligation;
  await prisma.$transaction(async (tx) => {
    const snapshot = await lockOrder(
      tx,
      { tenantId: order.tenantId },
      order.id,
    );
    const obligation = snapshot.paymentObligations.find(
      ({ id }) => id === attempt.obligationId,
    );
    const current = obligation?.attempts.find(({ id }) => id === attempt.id);
    if (!obligation || !current) missing();
    if (
      proof.customerReference !== current.id ||
      proof.orderReference !== providerOrderReference(order.id) ||
      (current.invoiceId && current.invoiceId !== proof.invoiceId)
    ) {
      await flagConflict(tx, current.id, evidenceConflict);
      return;
    }
    // This lock is shared with the regular invoice-binding trigger.
    await tx.$queryRaw`SELECT true AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended('gateway-invoice:' || ${proof.invoiceId}, 0))) AS claim`;
    const otherInvoice = await tx.myFatoorahInvoice.findUnique({
      where: { invoiceId: proof.invoiceId },
      select: { paymentId: true },
    });
    const otherSpecial = await tx.specialOrderPaymentAttempt.findUnique({
      where: { invoiceId: proof.invoiceId },
      select: { id: true },
    });
    if (otherInvoice || (otherSpecial && otherSpecial.id !== current.id)) {
      await flagConflict(tx, current.id, evidenceConflict);
      return;
    }
    const amountMatches = parseDecimal(proof.amount).equals(
      obligation.amount.toFixed(),
    );
    let issue =
      proof.currency === obligation.currency && amountMatches
        ? null
        : 'SPECIAL_PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH';
    const collections =
      proof.collections ??
      (proof.status === 'PAID' &&
      proof.transactionId &&
      proof.transactionPaymentId
        ? [
            {
              transactionId: proof.transactionId,
              paymentId: proof.transactionPaymentId,
              amount: proof.amount,
              currency: proof.currency,
            },
          ]
        : []);
    if (proof.status === 'PAID' && !collections.length)
      issue = evidenceConflict;
    let newlyCollected = false;
    const seenPaymentIds = new Set<string>();
    for (const record of [...collections].sort((a, b) =>
      a.paymentId.localeCompare(b.paymentId),
    )) {
      if (
        !proof.transactionPaymentIds.includes(record.paymentId) ||
        !record.transactionId ||
        !parseDecimal(record.amount).gt(0)
      ) {
        issue = evidenceConflict;
        continue;
      }
      if (seenPaymentIds.has(record.paymentId)) continue;
      seenPaymentIds.add(record.paymentId);
      // All fields are verified provider values. Save conflicting evidence but
      // count a provider transaction only once across regular and special orders.
      const identities = [
        ...new Set([record.transactionId, record.paymentId]),
      ].sort();
      for (const identity of identities) {
        await tx.$queryRaw`SELECT true AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended('gateway-collection:' || ${identity}, 0))) AS claim`;
      }
      const already = current.settlements.find(
        (item) => item.providerTransactionId === record.paymentId,
      );
      if (already) {
        if (
          !already.amount.equals(record.amount) ||
          already.currency !== record.currency ||
          already.transactionId !== record.transactionId
        )
          issue = evidenceConflict;
        continue;
      }
      const regular = await tx.payment.findFirst({
        where: {
          provider: current.provider,
          providerTransactionId: { in: identities },
        },
        select: { id: true },
      });
      const special = await tx.specialOrderPaymentSettlement.findFirst({
        where: {
          provider: current.provider,
          attributable: true,
          OR: [
            { transactionId: { in: identities } },
            { providerTransactionId: { in: identities } },
          ],
        },
        select: { id: true },
      });
      if (regular || special) issue = evidenceConflict;
      const amount = parseDecimal(record.amount);
      if (
        record.currency !== obligation.currency ||
        !amount.equals(obligation.amount.toFixed())
      ) {
        issue ??= 'SPECIAL_PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH';
      }
      await tx.specialOrderPaymentSettlement.create({
        data: {
          tenantId: order.tenantId,
          attemptId: current.id,
          provider: current.provider,
          transactionId: record.transactionId,
          providerTransactionId: record.paymentId,
          amount,
          currency: record.currency,
          attributable: !regular && !special,
        },
      });
      newlyCollected = true;
    }
    const paid = current.status === 'PAID' || proof.status === 'PAID';
    const terminal = proof.status === 'FAILED' || proof.status === 'CANCELLED';
    const wasTerminal =
      current.status === 'FAILED' || current.status === 'CANCELLED';
    // Late success on a previously closed attempt needs reconciliation, even
    // when its cash still belongs to the customer/order.
    if (
      newlyCollected &&
      (wasTerminal || (obligation.kind === 'BALANCE' && order.readyAt === null))
    )
      issue ??= 'SPECIAL_PAYMENT_LATE_COLLECTION';
    await tx.specialOrderPaymentAttempt.update({
      where: { id: current.id },
      data: {
        invoiceId: proof.invoiceId,
        initiationState: 'INITIATED',
        claimToken: null,
        leaseUntil: null,
        status: paid
          ? 'PAID'
          : wasTerminal
            ? current.status
            : terminal || proof.status === 'AUTHORIZED'
              ? proof.status
              : current.status,
        ...(paid || terminal || issue
          ? { checkoutUrl: null, recheckAt: null }
          : { recheckAt: new Date(Date.now() + RECHECK_MS) }),
        conflictCode: current.conflictCode ?? issue,
      },
    });
    let latest = await findOrder(tx, { tenantId: order.tenantId }, order.id);
    const attributed =
      latest.paymentObligations
        .find(({ id }) => id === obligation.id)
        ?.attempts.flatMap(({ settlements }) => settlements)
        .filter(({ attributable }) => attributable) ?? [];
    if (attributed.length > 1) {
      await flagConflict(
        tx,
        current.id,
        'SPECIAL_PAYMENT_MULTIPLE_COLLECTIONS',
      );
      latest = await findOrder(tx, { tenantId: order.tenantId }, order.id);
    }
    if (latest.cancellationStatus === 'CANCELLED') {
      await allocateCancelledCollections(tx, order.id);
      return;
    }
    const summary = financialSummary(latest);
    if (
      summary.status === 'PAID' &&
      !summary.financialConflict &&
      order.paymentStatus !== 'PAID'
    ) {
      await tx.specialOrder.update({
        where: { id: order.id },
        data: { paymentStatus: 'PAID' },
      });
    }
    if (
      newlyCollected &&
      !summary.financialConflict &&
      summary.initialSourcingPrerequisiteSatisfied
    ) {
      await notify(
        tx,
        order.tenantId,
        order.requestId,
        order.customerId,
        summary.status === 'PAID'
          ? 'SPECIAL_ORDER_PAYMENT_VERIFIED'
          : 'SPECIAL_ORDER_DEPOSIT_VERIFIED',
        obligation.id,
      );
    }
    if (terminal && !wasTerminal && !paid && !summary.financialConflict) {
      await notify(
        tx,
        order.tenantId,
        order.requestId,
        order.customerId,
        'SPECIAL_ORDER_PAYMENT_FAILED',
        current.id,
      );
    }
  });
}

export async function processSpecialPaymentWebhook(
  event: MyFatoorahEvent,
  observed?: VerifiedProviderPayment,
) {
  const attempt = await prisma.specialOrderPaymentAttempt.findFirst({
    where: {
      provider: 'MYFATOORAH',
      providerEnvironment: 'SANDBOX',
      ...(observed
        ? { id: observed.customerReference }
        : { invoiceId: event.invoiceId }),
    },
    include: attemptRelations,
  });
  if (!attempt) return null;
  if (env.PAYMENT_PROVIDER !== 'MYFATOORAH') unavailableProvider();
  await verifyKnownInvoice(attempt, event.invoiceId, event, observed);
  return { received: true };
}

async function canResumeAttempt(attempt: Attempt) {
  const order = await findOrder(
    prisma,
    { tenantId: attempt.tenantId },
    attempt.obligation.orderId,
  );
  const obligation = order.paymentObligations.find(
    ({ id }) => id === attempt.obligationId,
  );
  return Boolean(
    obligation &&
    obligationCanPay(order, {
      ...obligation,
      attempts: obligation.attempts.filter(({ id }) => id !== attempt.id),
    }),
  );
}

export async function recoverSpecialPaymentAttempts(
  limit: number,
  signal: AbortSignal,
) {
  if (env.PAYMENT_PROVIDER === 'NONE') return;
  const now = new Date();
  const candidates = await prisma.specialOrderPaymentAttempt.findMany({
    where: {
      recheckAt: { lte: now },
      conflictCode: null,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    orderBy: { recheckAt: 'asc' },
    take: limit,
    include: attemptRelations,
  });
  for (const attempt of candidates) {
    if (signal.aborted) return;
    const token = randomUUID();
    const claim = await prisma.specialOrderPaymentAttempt.updateMany({
      where: {
        id: attempt.id,
        updatedAt: attempt.updatedAt,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: {
        claimToken: token,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        ...(!attempt.invoiceId &&
          attempt.providerEnvironment === 'MOCK' && {
            initiationState: 'IN_PROGRESS',
          }),
      },
    });
    if (claim.count !== 1) continue;
    try {
      if (attempt.invoiceId) await verifyKnownInvoice(attempt);
      else if (
        attempt.providerEnvironment === 'MOCK' &&
        (await canResumeAttempt(attempt))
      )
        await executeInitiation(attempt, token);
      else
        await prisma.specialOrderPaymentAttempt.updateMany({
          where: { id: attempt.id, claimToken: token, invoiceId: null },
          data: {
            initiationState: 'UNKNOWN',
            claimToken: null,
            leaseUntil: null,
            recheckAt: null,
          },
        });
    } catch {
      await prisma.specialOrderPaymentAttempt.updateMany({
        where: { id: attempt.id, claimToken: token },
        data: {
          claimToken: null,
          leaseUntil: null,
          recheckAt: new Date(Date.now() + RECHECK_MS),
        },
      });
    }
  }
}
