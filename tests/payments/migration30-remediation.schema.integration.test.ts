import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import {
  OrderStatus,
  PaymentInitiationState,
  PaymentMethod,
  PaymentProvider,
  PaymentProviderAccountOwnership,
  PaymentProviderAccountStatus,
  PaymentProviderEnvironment,
  PaymentRefundAttemptOperation,
  PaymentRefundAttemptState,
  PaymentRefundConflictSource,
  PaymentRefundConflictType,
  PaymentStatus,
  RefundWebhookEventState,
  WebhookSignatureStatus,
} from '../../src/generated/prisma/client.js';

/**
 * Phase 2D.12 Step 2C-2A.3 — Migration 30 Final Database Integrity Remediation Suite
 *
 * Re-tests every Migration 29 Acceptance Gate probe (B-1 through B-5), including both
 * previously reproduced PostgreSQL 40P01 deadlock cycles and multi-connection concurrency.
 */
describe('Phase 2D.12 Step 2C-2A.3 — Migration 30 Final Database Integrity Remediation', () => {
  const runId = randomUUID().slice(0, 8);
  let tenantAId = '';
  let tenantBId = '';
  let userAId = '';
  let accActiveAId = '';
  let accRotatingAId = '';
  let accInactiveAId = '';
  let accRetiredAId = '';
  let accSuspendedAId = '';
  let accRevokedAuthAId = '';
  let accActiveBProdId = '';

  async function openPgClient(): Promise<pg.Client> {
    const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return client;
  }

  async function waitUntilBlocked(
    observer: pg.Client,
    pid: number,
    timeoutMs = 2500,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await observer.query<{ wait_event_type: string | null }>(
        `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
        [pid],
      );
      if (res.rows[0]?.wait_event_type === 'Lock') return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }

  async function seedPayment(params: {
    tenantId?: string;
    provider?: PaymentProvider;
    method?: PaymentMethod;
    status?: PaymentStatus;
    initiationState?: PaymentInitiationState;
    providerAccountId?: string | null;
    providerEnvironment?: PaymentProviderEnvironment | null;
    providerPaymentId?: string | null;
    providerTransactionId?: string | null;
    reconciliationRequired?: boolean;
  }) {
    const tId = params.tenantId ?? tenantAId;
    const status = params.status ?? PaymentStatus.PENDING;
    const order = await testPrisma.order.create({
      data: {
        tenantId: tId,
        orderNumber: `M30-${runId}-${randomUUID().slice(0, 8)}`,
        userId: userAId,
        status:
          status === PaymentStatus.PENDING
            ? OrderStatus.PENDING
            : OrderStatus.CONFIRMED,
        paymentStatus: status,
        currency: 'KWD',
        subtotal: '10.000',
        discountAmount: '0.000',
        shippingAmount: '0.000',
        taxAmount: '0.000',
        totalAmount: '10.000',
        shippingAddress: { city: 'Kuwait City' },
        billingAddress: { city: 'Kuwait City' },
      },
    });
    const payment = await testPrisma.payment.create({
      data: {
        orderId: order.id,
        provider: params.provider ?? PaymentProvider.MYFATOORAH,
        method: params.method ?? PaymentMethod.CARD,
        status,
        initiationState:
          params.initiationState ?? PaymentInitiationState.NOT_STARTED,
        amount: '10.000',
        currency: 'KWD',
        providerAccountId: params.providerAccountId ?? null,
        providerEnvironment: params.providerEnvironment ?? null,
        providerPaymentId: params.providerPaymentId ?? null,
        providerTransactionId: params.providerTransactionId ?? null,
        reconciliationRequired: params.reconciliationRequired ?? false,
      },
    });
    return { order, payment };
  }

  beforeAll(async () => {
    const tA = await testPrisma.tenant.create({
      data: {
        name: `M30 Tenant A ${runId}`,
        slug: `m30-a-${runId}`,
        code: `M30A${runId}`.toUpperCase(),
        defaultCurrency: 'KWD',
      },
    });
    const tB = await testPrisma.tenant.create({
      data: {
        name: `M30 Tenant B ${runId}`,
        slug: `m30-b-${runId}`,
        code: `M30B${runId}`.toUpperCase(),
        defaultCurrency: 'KWD',
      },
    });
    tenantAId = tA.id;
    tenantBId = tB.id;

    const uA = await testPrisma.user.create({
      data: {
        email: `m30-a-${runId}@test.local`,
        passwordHash: 'hash',
        firstName: 'M30',
        lastName: 'UserA',
        emailVerifiedAt: new Date(),
      },
    });
    userAId = uA.id;

    const createAcc = async (
      key: string,
      ownerTenantId: string,
      env: PaymentProviderEnvironment,
      status: PaymentProviderAccountStatus,
      isActive = true,
      revokedAt: Date | null = null,
    ) => {
      const acc = await testPrisma.paymentProviderAccount.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          environment: env,
          accountKey: `m30-${key}-${runId}`,
          ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
          ownerTenantId,
          countryCode: 'KWT',
          currency: 'KWD',
          status,
        },
      });
      await testPrisma.paymentProviderAccountTenant.create({
        data: {
          tenantId: ownerTenantId,
          providerAccountId: acc.id,
          provider: PaymentProvider.MYFATOORAH,
          environment: env,
          isActive,
          revokedAt,
        },
      });
      return acc.id;
    };

    accActiveAId = await createAcc(
      'active-a',
      tenantAId,
      PaymentProviderEnvironment.SANDBOX,
      PaymentProviderAccountStatus.ACTIVE,
    );
    accRotatingAId = await createAcc(
      'rotating-a',
      tenantAId,
      PaymentProviderEnvironment.SANDBOX,
      PaymentProviderAccountStatus.ROTATING,
    );
    accInactiveAId = await createAcc(
      'inactive-a',
      tenantAId,
      PaymentProviderEnvironment.SANDBOX,
      PaymentProviderAccountStatus.INACTIVE,
    );
    accRetiredAId = await createAcc(
      'retired-a',
      tenantAId,
      PaymentProviderEnvironment.SANDBOX,
      PaymentProviderAccountStatus.RETIRED,
    );
    accSuspendedAId = await createAcc(
      'suspended-a',
      tenantAId,
      PaymentProviderEnvironment.SANDBOX,
      PaymentProviderAccountStatus.SUSPENDED,
    );
    accRevokedAuthAId = await createAcc(
      'revoked-auth-a',
      tenantAId,
      PaymentProviderEnvironment.SANDBOX,
      PaymentProviderAccountStatus.ACTIVE,
      false,
      new Date(),
    );
    accActiveBProdId = await createAcc(
      'active-b-prod',
      tenantBId,
      PaymentProviderEnvironment.PRODUCTION,
      PaymentProviderAccountStatus.ACTIVE,
    );
  });

  // =========================================================================
  // B-1: STRICT Payment.provider IMMUTABILITY & EVIDENCE PRESERVATION
  // =========================================================================
  describe('B-1: Strict Payment.provider & Historical Evidence Integrity', () => {
    it('rejects all 8 prior provider-mutation & evidence-erasure probes and preserves reconciliationFlaggedAt across reconciliation resolution', async () => {
      // 1. Even untouched unbound PENDING/NOT_STARTED rejects provider mutation
      const { payment: p1 } = await seedPayment({});
      await expect(
        testPrisma.payment.update({
          where: { id: p1.id },
          data: { provider: PaymentProvider.NONE },
        }),
      ).rejects.toThrow(/provider is strictly immutable/);
      expect((await testPrisma.payment.findUniqueOrThrow({ where: { id: p1.id } })).provider).toBe(
        PaymentProvider.MYFATOORAH,
      );

      // 2-6. Unbound payments with IN_PROGRESS, UNKNOWN, REQUIRES_ACTION, providerPaymentId, providerTransactionId, reconciliationRequired
      const { payment: p2 } = await seedPayment({
        status: PaymentStatus.REQUIRES_ACTION,
        initiationState: PaymentInitiationState.INITIATED,
        providerPaymentId: `m30-pp-${runId}`,
        providerTransactionId: `m30-tx-${runId}`,
        reconciliationRequired: true,
      });
      expect(p2.reconciliationFlaggedAt).not.toBeNull();

      await expect(
        testPrisma.payment.update({
          where: { id: p2.id },
          data: { provider: PaymentProvider.STRIPE },
        }),
      ).rejects.toThrow(/provider is strictly immutable/);

      // Established providerPaymentId & providerTransactionId cannot be erased or replaced
      await expect(
        testPrisma.payment.update({
          where: { id: p2.id },
          data: { providerPaymentId: null },
        }),
      ).rejects.toThrow(/providerPaymentId cannot be erased or replaced/);
      await expect(
        testPrisma.payment.update({
          where: { id: p2.id },
          data: { providerPaymentId: `m30-pp-other-${runId}` },
        }),
      ).rejects.toThrow(/providerPaymentId cannot be erased or replaced/);
      await expect(
        testPrisma.payment.update({
          where: { id: p2.id },
          data: { providerTransactionId: null },
        }),
      ).rejects.toThrow(/providerTransactionId cannot be erased or replaced/);
      await expect(
        testPrisma.payment.update({
          where: { id: p2.id },
          data: { initiationState: PaymentInitiationState.NOT_STARTED },
        }),
      ).rejects.toThrow(/cannot regress to NOT_STARTED/);
      await expect(
        testPrisma.payment.update({
          where: { id: p2.id },
          data: { status: PaymentStatus.PENDING },
        }),
      ).rejects.toThrow(/cannot regress from REQUIRES_ACTION back to PENDING/);

      // 7. Combined evidence-clearing + provider change rejected
      await expect(
        testPrisma.payment.update({
          where: { id: p2.id },
          data: {
            provider: PaymentProvider.STRIPE,
            initiationState: PaymentInitiationState.NOT_STARTED,
            providerPaymentId: null,
            providerTransactionId: null,
            reconciliationRequired: false,
          },
        }),
      ).rejects.toThrow(/provider is strictly immutable/);

      // 8. Legitimate reconciliation resolution (reconciliationRequired: true -> false) SUCCEEDS
      //    on an unbound PENDING/NOT_STARTED payment, while reconciliationFlaggedAt remains
      //    permanently set and STILL blocks retroactive account binding!
      const { payment: pRec } = await seedPayment({
        status: PaymentStatus.PENDING,
        initiationState: PaymentInitiationState.NOT_STARTED,
        reconciliationRequired: true,
      });
      expect(pRec.reconciliationFlaggedAt).not.toBeNull();

      const resolved = await testPrisma.payment.update({
        where: { id: pRec.id },
        data: { reconciliationRequired: false },
      });
      expect(resolved.reconciliationRequired).toBe(false);
      expect(resolved.reconciliationFlaggedAt).not.toBeNull();

      // Cannot clear reconciliationFlaggedAt
      await expect(
        testPrisma.payment.update({
          where: { id: pRec.id },
          data: { reconciliationFlaggedAt: null },
        }),
      ).rejects.toThrow(/reconciliationFlaggedAt is immutable/);

      // Retroactive account binding STILL blocked after reconciliationRequired cleared!
      await expect(
        testPrisma.payment.update({
          where: { id: pRec.id },
          data: {
            providerAccountId: accActiveAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/Cannot assign provider account/);

      // Verify COD / NONE payment remains fully functional
      const { payment: cod } = await seedPayment({
        provider: PaymentProvider.NONE,
        method: PaymentMethod.CASH_ON_DELIVERY,
      });
      expect(cod.providerAccountId).toBeNull();
    });
  });

  // =========================================================================
  // B-3: ACTIVE AUTHORIZATION FOR NEW BINDING & HISTORICAL PRESERVATION
  // =========================================================================
  describe('B-3: Active Authorization Matrix & Historical Preservation', () => {
    it('allows ACTIVE+authorized bindings, rejects INACTIVE/ROTATING/SUSPENDED/RETIRED/revoked new bindings, and preserves historical updates after retirement/revocation', async () => {
      // Order.tenantId is immutable
      const { order: ord0 } = await seedPayment({});
      await expect(
        testPrisma.$executeRaw`UPDATE "Order" SET "tenantId" = ${tenantBId} WHERE "id" = ${ord0.id}`,
      ).rejects.toThrow(/Order tenantId is immutable/);

      // Active + authorized new binding succeeds
      const { payment: okPay } = await seedPayment({});
      const bound = await testPrisma.payment.update({
        where: { id: okPay.id },
        data: {
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        },
      });
      expect(bound.providerAccountId).toBe(accActiveAId);

      // Non-ACTIVE account statuses (INACTIVE, ROTATING, SUSPENDED, RETIRED) rejected on NEW binding
      for (const accId of [
        accInactiveAId,
        accRotatingAId,
        accSuspendedAId,
        accRetiredAId,
      ]) {
        const { payment: p } = await seedPayment({});
        await expect(
          testPrisma.payment.update({
            where: { id: p.id },
            data: {
              providerAccountId: accId,
              providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            },
          }),
        ).rejects.toThrow(/is not ACTIVE for new payment binding/);
      }

      // Revoked tenant authorization rejected on NEW binding
      const { payment: pRev } = await seedPayment({});
      await expect(
        testPrisma.payment.update({
          where: { id: pRev.id },
          data: {
            providerAccountId: accRevokedAuthAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/is inactive or revoked/);

      // Historical payment bound while ACTIVE continues accepting verification/status updates
      // AFTER its account is retired AND tenant authorization is revoked!
      const tempAcc = await testPrisma.paymentProviderAccount.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          accountKey: `m30-retire-hist-${runId}`,
          ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
          ownerTenantId: tenantAId,
          countryCode: 'KWT',
          currency: 'KWD',
          status: PaymentProviderAccountStatus.ACTIVE,
        },
      });
      await testPrisma.paymentProviderAccountTenant.create({
        data: {
          tenantId: tenantAId,
          providerAccountId: tempAcc.id,
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          isActive: true,
        },
      });
      const { payment: histPay } = await seedPayment({
        providerAccountId: tempAcc.id,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });

      // Now retire account and revoke tenant authorization
      await testPrisma.paymentProviderAccount.update({
        where: { id: tempAcc.id },
        data: { status: PaymentProviderAccountStatus.RETIRED, retiredAt: new Date() },
      });
      await testPrisma.paymentProviderAccountTenant.update({
        where: {
          tenantId_providerAccountId: {
            tenantId: tenantAId,
            providerAccountId: tempAcc.id,
          },
        },
        data: { isActive: false, revokedAt: new Date() },
      });

      // Historical payment update (verification settling PAID) STILL SUCCEEDS!
      const settled = await testPrisma.payment.update({
        where: { id: histPay.id },
        data: {
          status: PaymentStatus.PAID,
          initiationState: PaymentInitiationState.INITIATED,
          providerPaymentId: `hist-inv-${runId}`,
        },
      });
      expect(settled.status).toBe(PaymentStatus.PAID);
      expect(settled.providerAccountId).toBe(tempAcc.id);
    });
  });

  // =========================================================================
  // B-4: DURABLE ATTEMPT LIFECYCLE, TERMINAL FREEZE & AT-MOST-ONE-DISPATCH
  // =========================================================================
  describe('B-4: Durable Attempt Lifecycle & At-Most-One-Dispatch Safety', () => {
    it('enforces PREPARED start, dispatch boundary fields, complete terminal freeze, and blocks second SUBMIT_REFUND after dispatched DEFINITIVELY_FAILED', async () => {
      const { order, payment } = await seedPayment({
        status: PaymentStatus.PAID,
        initiationState: PaymentInitiationState.INITIATED,
        providerAccountId: accActiveAId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        providerPaymentId: `b4-inv-${runId}`,
      });
      const refund1 = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '3.000',
          currency: 'KWD',
          idempotencyKey: `b4-r1-${runId}`,
          requestFingerprint: 'fp-b4-r1',
          reason: 'B-4 lifecycle test',
          requestedByUserId: userAId,
        },
      });

      // Direct INSERT of SUBMIT_REFUND into DISPATCHING, DEFINITIVELY_FAILED, AMBIGUOUS, SUCCEEDED, ABANDONED all rejected
      for (const badState of [
        PaymentRefundAttemptState.DISPATCHING,
        PaymentRefundAttemptState.DEFINITIVELY_FAILED,
        PaymentRefundAttemptState.AMBIGUOUS,
        PaymentRefundAttemptState.SUCCEEDED,
        PaymentRefundAttemptState.ABANDONED,
      ]) {
        await expect(
          testPrisma.paymentRefundAttempt.create({
            data: {
              tenantId: tenantAId,
              paymentId: payment.id,
              orderId: order.id,
              refundId: refund1.id,
              provider: PaymentProvider.MYFATOORAH,
              providerAccountId: accActiveAId,
              providerEnvironment: PaymentProviderEnvironment.SANDBOX,
              attemptNumber: 1,
              operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
              state: badState,
              correlationId: `bad-ins-${badState}-${runId}`,
              requestFingerprint: 'fp-b4-r1',
            },
          }),
        ).rejects.toThrow(/must start in PREPARED state/);
      }

      // Valid PREPARED insert -> DISPATCHING without dispatch boundary fields rejected by CHECK
      const att1 = await testPrisma.paymentRefundAttempt.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: refund1.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          attemptNumber: 1,
          operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
          state: PaymentRefundAttemptState.PREPARED,
          correlationId: `b4-att1-${runId}`,
          requestFingerprint: 'fp-b4-r1',
        },
      });

      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: att1.id },
          data: { state: PaymentRefundAttemptState.DISPATCHING },
        }),
      ).rejects.toThrow(/PaymentRefundAttempt_dispatch_boundary_check/);

      // Atomic transition PREPARED -> DISPATCHING with required boundary fields succeeds
      await testPrisma.paymentRefundAttempt.update({
        where: { id: att1.id },
        data: {
          state: PaymentRefundAttemptState.DISPATCHING,
          dispatchOwner: 'pod-1',
          fencingToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 30_000),
          dispatchedAt: new Date(),
        },
      });

      // Transition DISPATCHING -> DEFINITIVELY_FAILED (dispatchedAt IS NOT NULL)
      await testPrisma.paymentRefundAttempt.update({
        where: { id: att1.id },
        data: {
          state: PaymentRefundAttemptState.DEFINITIVELY_FAILED,
          failureClassification: 'HTTP_400',
          failureCode: 'PROVIDER_VALIDATION_ERROR',
          completedAt: new Date(),
        },
      });

      // Complete terminal freeze: injecting previously NULL providerHttpStatus / providerRefundId OR modifying sanitizedResponseMetadata REJECTED!
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: att1.id },
          data: { providerHttpStatus: 400 },
        }),
      ).rejects.toThrow(/completely frozen/);
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: att1.id },
          data: { providerRefundId: 'injected-id' },
        }),
      ).rejects.toThrow(/completely frozen/);
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: att1.id },
          data: { sanitizedResponseMetadata: { tampered: true } },
        }),
      ).rejects.toThrow(/completely frozen/);

      // At-most-one-dispatched SUBMIT_REFUND: second SUBMIT_REFUND BLOCKED even after DEFINITIVELY_FAILED because att1 was dispatched!
      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund1.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accActiveAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 2,
            operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
            state: PaymentRefundAttemptState.PREPARED,
            correlationId: `b4-att2-${runId}`,
            requestFingerprint: 'fp-b4-r1',
          },
        }),
      ).rejects.toThrow(/already has a dispatched SUBMIT_REFUND attempt/);

      // Legitimate LOOKUP_STATUS and RECONCILE attempts remain allowed
      const lookup = await testPrisma.paymentRefundAttempt.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: refund1.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          attemptNumber: 2,
          operation: PaymentRefundAttemptOperation.LOOKUP_STATUS,
          state: PaymentRefundAttemptState.SUCCEEDED,
          correlationId: `b4-lookup-${runId}`,
          requestFingerprint: 'fp-b4-r1',
          completedAt: new Date(),
        },
      });
      expect(lookup.operation).toBe(PaymentRefundAttemptOperation.LOOKUP_STATUS);
    });
  });

  // =========================================================================
  // B-5: WEBHOOK & CONFLICT AUDIT LINEAGE + CONTROLLED ENRICHMENT
  // =========================================================================
  describe('B-5: Webhook & Conflict Audit Lineage', () => {
    it('enforces webhook linkage shapes, rejects cross-tenant/cross-env webhookEventId on ConflictAudit, and blocks contradicting webhook enrichment', async () => {
      const { order: oA, payment: pA } = await seedPayment({
        tenantId: tenantAId,
        status: PaymentStatus.PAID,
        initiationState: PaymentInitiationState.INITIATED,
        providerAccountId: accActiveAId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const refA = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: pA.id,
          orderId: oA.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '2.000',
          currency: 'KWD',
          idempotencyKey: `b5-ra-${runId}`,
          requestFingerprint: 'fp-b5-a',
          reason: 'B5 A',
          requestedByUserId: userAId,
        },
      });

      const { order: oB, payment: pB } = await seedPayment({
        tenantId: tenantBId,
        status: PaymentStatus.PAID,
        initiationState: PaymentInitiationState.INITIATED,
        providerAccountId: accActiveBProdId,
        providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
      });
      const refB = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantBId,
          paymentId: pB.id,
          orderId: oB.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accActiveBProdId,
          providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
          amount: '2.000',
          currency: 'KWD',
          idempotencyKey: `b5-rb-${runId}`,
          requestFingerprint: 'fp-b5-b',
          reason: 'B5 B',
          requestedByUserId: userAId,
        },
      });

      // Partial-NULL fabricated payment/order on MyFatoorahRefundWebhookEvent rejected
      await expect(
        testPrisma.myFatoorahRefundWebhookEvent.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accActiveAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            tenantId: null,
            paymentId: 'fake-payment',
            orderId: 'fake-order',
            refundId: null,
            eventCode: 2,
            eventName: 'REFUND_STATUS_CHANGED',
            eventReference: `b5-fake-${runId}`,
            payloadFingerprint: 'fp-fake',
            signatureStatus: WebhookSignatureStatus.VALID,
            state: RefundWebhookEventState.RECEIVED,
          },
        }),
      ).rejects.toThrow(/MyFatoorahRefundWebhookEvent_linkage_shape_check/);

      // Cross-tenant dedicated account without refund rejected
      await expect(
        testPrisma.myFatoorahRefundWebhookEvent.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accActiveAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            tenantId: tenantBId,
            eventCode: 2,
            eventName: 'REFUND_STATUS_CHANGED',
            eventReference: `b5-xta-${runId}`,
            payloadFingerprint: 'fp-xta',
            signatureStatus: WebhookSignatureStatus.VALID,
            state: RefundWebhookEventState.RECEIVED,
          },
        }),
      ).rejects.toThrow(/is not authorized for tenant/);

      // Valid webhook belonging to Tenant B / PRODUCTION / refB
      const whB = await testPrisma.myFatoorahRefundWebhookEvent.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accActiveBProdId,
          providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
          tenantId: tenantBId,
          orderId: oB.id,
          paymentId: pB.id,
          refundId: refB.id,
          eventCode: 2,
          eventName: 'REFUND_STATUS_CHANGED',
          eventReference: `b5-whb-${runId}`,
          payloadFingerprint: 'fp-whb',
          signatureStatus: WebhookSignatureStatus.VALID,
          state: RefundWebhookEventState.PROCESSED,
        },
      });

      // Cross-tenant / cross-env webhookEventId on Tenant A ConflictAudit REJECTED!
      await expect(
        testPrisma.paymentRefundConflictAudit.create({
          data: {
            tenantId: tenantAId,
            orderId: oA.id,
            paymentId: pA.id,
            refundId: refA.id,
            webhookEventId: whB.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accActiveAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            source: PaymentRefundConflictSource.WEBHOOK,
            conflictType: PaymentRefundConflictType.TERMINAL_STATE_CONTRADICTION,
            summary: 'Cross-tenant webhook link attempt',
          },
        }),
      ).rejects.toThrow(/contradicts referenced MyFatoorahRefundWebhookEvent/);

      // Unresolved webhook linked to Tenant A audit -> later enriching webhook to Tenant B REJECTED,
      // while consistent enrichment to Tenant A SUCCEEDS!
      const whUnres = await testPrisma.myFatoorahRefundWebhookEvent.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          eventCode: 2,
          eventName: 'REFUND_STATUS_CHANGED',
          eventReference: `b5-unres-${runId}`,
          payloadFingerprint: 'fp-unres',
          signatureStatus: WebhookSignatureStatus.UNVERIFIED_ACCOUNT,
          state: RefundWebhookEventState.QUARANTINED_UNKNOWN_REFUND,
        },
      });
      await testPrisma.paymentRefundConflictAudit.create({
        data: {
          tenantId: tenantAId,
          orderId: oA.id,
          paymentId: pA.id,
          refundId: refA.id,
          webhookEventId: whUnres.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          source: PaymentRefundConflictSource.WEBHOOK,
          conflictType: PaymentRefundConflictType.UNKNOWN_EXTERNAL_REFUND,
          summary: 'Linked unresolved webhook to Tenant A refund',
        },
      });

      // Contradicting enrichment to Tenant B rejected!
      await expect(
        testPrisma.myFatoorahRefundWebhookEvent.update({
          where: { id: whUnres.id },
          data: {
            tenantId: tenantBId,
            orderId: oB.id,
            paymentId: pB.id,
            refundId: refB.id,
            providerAccountId: accActiveBProdId,
            providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
          },
        }),
      ).rejects.toThrow(/enrichment contradicts an existing PaymentRefundConflictAudit/);

      // Consistent enrichment to Tenant A succeeds!
      const enriched = await testPrisma.myFatoorahRefundWebhookEvent.update({
        where: { id: whUnres.id },
        data: {
          tenantId: tenantAId,
          orderId: oA.id,
          paymentId: pA.id,
          refundId: refA.id,
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        },
      });
      expect(enriched.refundId).toBe(refA.id);
    });
  });

  // =========================================================================
  // B-2 & B-3 & B-5 CONCURRENCY: ZERO DEADLOCKS ON PREVIOUSLY REPRODUCED CYCLES
  // =========================================================================
  describe('B-2 Concurrency: Deadlock Elimination & Deterministic Serialization', () => {
    it('eliminates Deadlock #1 (Order FOR UPDATE vs Payment bind), eliminates Deadlock #2 (Attempt UPDATE -> Refund UPDATE vs ConflictAudit INSERT), and serializes revocation vs binding and concurrent webhook enrichment', async () => {
      const observer = await openPgClient();
      try {
        // --- Retest Deadlock #1: Order FOR UPDATE -> Payment UPDATE vs Direct Payment NULL->bound ---
        const { order: o1, payment: p1 } = await seedPayment({});
        const c1 = await openPgClient();
        const c2 = await openPgClient();
        try {
          await c1.query('BEGIN');
          await c1.query(`SELECT "id" FROM "Order" WHERE "id" = $1 FOR UPDATE`, [o1.id]);

          // Conn2 binds Payment WITHOUT locking Order first:
          // Because Order.tenantId is read unlocked (immutable), Conn2 does NOT block on Order FOR UPDATE
          // and commits cleanly while Conn1 holds Order FOR UPDATE!
          await c2.query('BEGIN');
          await c2.query(
            `UPDATE "Payment" SET "providerAccountId" = $1, "providerEnvironment" = 'SANDBOX' WHERE "id" = $2`,
            [accActiveAId, p1.id],
          );
          // Now Conn1 updates Payment while Conn2 holds Payment lock -> Conn1 blocks cleanly until Conn2 commits (ZERO 40P01!)
          const c1Pid = (await c1.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          const c1Update = c1
            .query(`UPDATE "Payment" SET "status" = 'REQUIRES_ACTION' WHERE "id" = $1`, [p1.id])
            .then(() => null)
            .catch((e: { code?: string; message: string }) => e);
          expect(await waitUntilBlocked(observer, c1Pid)).toBe(true);

          await c2.query('COMMIT');
          const c1Err = await c1Update;
          expect(c1Err).toBeNull();
          await c1.query('COMMIT');

          const finalP1 = await testPrisma.payment.findUniqueOrThrow({ where: { id: p1.id } });
          expect(finalP1.providerAccountId).toBe(accActiveAId);
          expect(finalP1.status).toBe(PaymentStatus.REQUIRES_ACTION);
        } finally {
          await c1.end().catch(() => {});
          await c2.end().catch(() => {});
        }

        // --- Retest Deadlock #2: Attempt UPDATE -> Refund UPDATE vs ConflictAudit INSERT (attemptId) ---
        const { order: o2, payment: p2 } = await seedPayment({
          status: PaymentStatus.PAID,
          initiationState: PaymentInitiationState.INITIATED,
          providerAccountId: accActiveAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        });
        const ref2 = await testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: p2.id,
            orderId: o2.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accActiveAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            amount: '2.000',
            currency: 'KWD',
            idempotencyKey: `d2-ref-${runId}`,
            requestFingerprint: 'fp-d2',
            reason: 'Deadlock #2 retest',
            requestedByUserId: userAId,
          },
        });
        const att2 = await testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: p2.id,
            orderId: o2.id,
            refundId: ref2.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accActiveAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 1,
            operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
            state: PaymentRefundAttemptState.PREPARED,
            correlationId: `d2-att-${runId}`,
            requestFingerprint: 'fp-d2',
          },
        });
        const c3 = await openPgClient();
        const c4 = await openPgClient();
        try {
          await c3.query('BEGIN');
          // Conn3 updates non-key column on Attempt (FOR NO KEY UPDATE)
          await c3.query(
            `UPDATE "PaymentRefundAttempt" SET "dispatchOwner" = 'w-d2' WHERE "id" = $1`,
            [att2.id],
          );

          // Conn4 inserts ConflictAudit referencing (ref2, att2):
          // Locks PaymentRefund FOR SHARE, reads Attempt.refundId unlocked (implicit FK takes FOR KEY SHARE,
          // which is compatible with FOR NO KEY UPDATE!) -> succeeds immediately without blocking on Conn3!
          await c4.query('BEGIN');
          await c4.query(
            `INSERT INTO "PaymentRefundConflictAudit" ("id","tenantId","orderId","paymentId","refundId","attemptId","provider","providerAccountId","providerEnvironment","source","conflictType","summary","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,'MYFATOORAH',$7,'SANDBOX','PROVIDER_SUBMISSION','AMBIGUOUS_PROVIDER_OUTCOME','Deadlock #2 retest',NOW())`,
            [randomUUID(), tenantAId, o2.id, p2.id, ref2.id, att2.id, accActiveAId],
          );

          // Conn3 now updates PaymentRefund -> blocks cleanly on Conn4's PaymentRefund FOR SHARE until Conn4 commits (ZERO 40P01!)
          const c3Pid = (await c3.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          const c3Update = c3
            .query(`UPDATE "PaymentRefund" SET "status" = 'PENDING' WHERE "id" = $1`, [ref2.id])
            .then(() => null)
            .catch((e: { code?: string; message: string }) => e);
          expect(await waitUntilBlocked(observer, c3Pid)).toBe(true);

          await c4.query('COMMIT');
          const c3Err = await c3Update;
          expect(c3Err).toBeNull();
          await c3.query('COMMIT');

          const finalRef2 = await testPrisma.paymentRefund.findUniqueOrThrow({ where: { id: ref2.id } });
          expect(finalRef2.status).toBe('PENDING');
        } finally {
          await c3.end().catch(() => {});
          await c4.end().catch(() => {});
        }

        // --- Concurrent Revocation vs New Payment Binding (B-3) ---
        const revAcc = await testPrisma.paymentProviderAccount.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
            accountKey: `m30-conc-rev-${runId}`,
            ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
            ownerTenantId: tenantAId,
            countryCode: 'KWT',
            currency: 'KWD',
            status: PaymentProviderAccountStatus.ACTIVE,
          },
        });
        await testPrisma.paymentProviderAccountTenant.create({
          data: {
            tenantId: tenantAId,
            providerAccountId: revAcc.id,
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
            isActive: true,
          },
        });
        const { payment: pRevConc } = await seedPayment({});
        const c5 = await openPgClient();
        const c6 = await openPgClient();
        try {
          const c6Pid = (await c6.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          await c5.query('BEGIN');
          await c5.query(
            `UPDATE "PaymentProviderAccountTenant" SET "isActive" = false, "revokedAt" = NOW() WHERE "tenantId" = $1 AND "providerAccountId" = $2`,
            [tenantAId, revAcc.id],
          );

          await c6.query('BEGIN');
          const c6Bind = c6
            .query(
              `UPDATE "Payment" SET "providerAccountId" = $1, "providerEnvironment" = 'SANDBOX' WHERE "id" = $2`,
              [revAcc.id, pRevConc.id],
            )
            .then(() => null)
            .catch((e: { code?: string; message: string }) => e);
          expect(await waitUntilBlocked(observer, c6Pid)).toBe(true);

          await c5.query('COMMIT');
          const c6Err = await c6Bind;
          expect(c6Err).not.toBeNull();
          expect(c6Err!.code).toBe('23514');
          expect(c6Err!.message).toMatch(/inactive or revoked/);
          await c6.query('ROLLBACK');

          const persisted = await testPrisma.payment.findUniqueOrThrow({ where: { id: pRevConc.id } });
          expect(persisted.providerAccountId).toBeNull();
        } finally {
          await c5.end().catch(() => {});
          await c6.end().catch(() => {});
        }

        // --- Concurrent Webhook Enrichment vs Conflict Audit Creation (B-5) ---
        const whConc = await testPrisma.myFatoorahRefundWebhookEvent.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            eventCode: 2,
            eventName: 'REFUND_STATUS_CHANGED',
            eventReference: `m30-conc-wh-${runId}`,
            payloadFingerprint: 'fp-conc-wh',
            signatureStatus: WebhookSignatureStatus.UNVERIFIED_ACCOUNT,
            state: RefundWebhookEventState.QUARANTINED_UNKNOWN_REFUND,
          },
        });
        const { order: oB2, payment: pB2 } = await seedPayment({
          tenantId: tenantBId,
          status: PaymentStatus.PAID,
          initiationState: PaymentInitiationState.INITIATED,
          providerAccountId: accActiveBProdId,
          providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
        });
        const refB2 = await testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantBId,
            paymentId: pB2.id,
            orderId: oB2.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accActiveBProdId,
            providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
            amount: '2.000',
            currency: 'KWD',
            idempotencyKey: `whc-rb-${runId}`,
            requestFingerprint: 'fp-whc-b',
            reason: 'WH conc B',
            requestedByUserId: userAId,
          },
        });
        const c7 = await openPgClient();
        const c8 = await openPgClient();
        try {
          const c8Pid = (await c8.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          await c7.query('BEGIN');
          // Conn7 enriches unresolved webhook to Tenant B / PRODUCTION / refB2
          await c7.query(
            `UPDATE "MyFatoorahRefundWebhookEvent"
             SET "tenantId" = $1, "orderId" = $2, "paymentId" = $3, "refundId" = $4,
                 "providerAccountId" = $5, "providerEnvironment" = 'PRODUCTION'
             WHERE "id" = $6`,
            [tenantBId, oB2.id, pB2.id, refB2.id, accActiveBProdId, whConc.id],
          );

          // Conn8 concurrently tries to insert a Tenant A ConflictAudit referencing whConc -> blocks on whConc FOR SHARE!
          await c8.query('BEGIN');
          const c8Audit = c8
            .query(
              `INSERT INTO "PaymentRefundConflictAudit" ("id","tenantId","orderId","paymentId","refundId","webhookEventId","provider","providerAccountId","providerEnvironment","source","conflictType","summary","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,'MYFATOORAH',$7,'SANDBOX','WEBHOOK','UNKNOWN_EXTERNAL_REFUND','Concurrent race',NOW())`,
              [randomUUID(), tenantAId, o2.id, p2.id, ref2.id, whConc.id, accActiveAId],
            )
            .then(() => null)
            .catch((e: { code?: string; message: string }) => e);
          expect(await waitUntilBlocked(observer, c8Pid)).toBe(true);

          await c7.query('COMMIT');
          const c8Err = await c8Audit;
          expect(c8Err).not.toBeNull();
          expect(c8Err!.code).toBe('23514');
          expect(c8Err!.message).toMatch(/contradicts referenced MyFatoorahRefundWebhookEvent/);
          await c8.query('ROLLBACK');
        } finally {
          await c7.end().catch(() => {});
          await c8.end().catch(() => {});
        }
      } finally {
        await observer.end().catch(() => {});
      }
    });
  });
});
