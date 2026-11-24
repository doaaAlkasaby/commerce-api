import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
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
  PaymentRefundConflictResolutionState,
  PaymentRefundConflictSource,
  PaymentRefundConflictType,
  PaymentRefundRecoveryJobState,
  PaymentRefundRecoveryOperation,
  PaymentStatus,
  RefundWebhookEventState,
  WebhookSignatureStatus,
} from '../../src/generated/prisma/client.js';
import { testPrisma } from '../../src/config/test-database.js';

/**
 * Phase 2D.12 Step 2C-2A.2 — Migration 29 Database Integrity Hardening Suite
 *
 * Verifies S-1 through S-5 invariants using both Prisma and direct PostgreSQL SQL,
 * including multi-connection PostgreSQL concurrency tests (both transaction orderings)
 * and persisted post-rejection state verification.
 */
describe('Phase 2D.12 Step 2C-2A.2 — Migration 29 Integrity Hardening & Concurrency', () => {
  const runId = randomUUID().slice(0, 8);
  let tenantAId = '';
  let tenantBId = '';
  let userAId = '';
  let accDedAId = '';
  let accDedA2Id = '';
  let accSharedId = '';
  let accStripeProdId = '';

  async function openPgClient(): Promise<pg.Client> {
    const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required for concurrency tests');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return client;
  }

  async function waitUntilBlocked(
    observer: pg.Client,
    blockedPid: number,
    timeoutMs = 3000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await observer.query<{ wait_event_type: string | null }>(
        `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
        [blockedPid],
      );
      if (res.rows[0]?.wait_event_type === 'Lock') {
        return true;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }

  async function seedOrderAndPayment(params: {
    tenantId: string;
    userId: string;
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
    const suffix = randomUUID().slice(0, 8);
    const order = await testPrisma.order.create({
      data: {
        tenantId: params.tenantId,
        orderNumber: `M29-${runId}-${suffix}`,
        userId: params.userId,
        status:
          params.status === PaymentStatus.PENDING
            ? OrderStatus.PENDING
            : OrderStatus.CONFIRMED,
        paymentStatus: params.status ?? PaymentStatus.PAID,
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
        status: params.status ?? PaymentStatus.PAID,
        initiationState:
          params.initiationState ?? PaymentInitiationState.INITIATED,
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
        name: `M29 Tenant A ${runId}`,
        slug: `m29-a-${runId}`,
        code: `M29A${runId}`.toUpperCase(),
        defaultCurrency: 'KWD',
      },
    });
    const tB = await testPrisma.tenant.create({
      data: {
        name: `M29 Tenant B ${runId}`,
        slug: `m29-b-${runId}`,
        code: `M29B${runId}`.toUpperCase(),
        defaultCurrency: 'KWD',
      },
    });
    tenantAId = tA.id;
    tenantBId = tB.id;

    const uA = await testPrisma.user.create({
      data: {
        email: `m29-a-${runId}@test.local`,
        passwordHash: 'hash',
        firstName: 'M29',
        lastName: 'UserA',
        emailVerifiedAt: new Date(),
      },
    });
    userAId = uA.id;

    const a1 = await testPrisma.paymentProviderAccount.create({
      data: {
        provider: PaymentProvider.MYFATOORAH,
        environment: PaymentProviderEnvironment.SANDBOX,
        accountKey: `m29-ded-a1-${runId}`,
        providerMerchantCode: `MF-MERCH-A1-${runId}`,
        ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
        ownerTenantId: tenantAId,
        countryCode: 'KWT',
        currency: 'KWD',
        status: PaymentProviderAccountStatus.ACTIVE,
        credentialRef: 'env:MYFATOORAH_SANDBOX_A1',
      },
    });
    const a2 = await testPrisma.paymentProviderAccount.create({
      data: {
        provider: PaymentProvider.MYFATOORAH,
        environment: PaymentProviderEnvironment.SANDBOX,
        accountKey: `m29-ded-a2-${runId}`,
        ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
        ownerTenantId: tenantAId,
        countryCode: 'KWT',
        currency: 'KWD',
        status: PaymentProviderAccountStatus.ACTIVE,
        credentialRef: 'env:MYFATOORAH_SANDBOX_A2',
      },
    });
    const shared = await testPrisma.paymentProviderAccount.create({
      data: {
        provider: PaymentProvider.MYFATOORAH,
        environment: PaymentProviderEnvironment.SANDBOX,
        accountKey: `m29-shared-${runId}`,
        ownershipMode: PaymentProviderAccountOwnership.PLATFORM_SHARED,
        ownerTenantId: null,
        countryCode: 'KWT',
        currency: 'KWD',
        status: PaymentProviderAccountStatus.ACTIVE,
        credentialRef: 'env:MYFATOORAH_SANDBOX_SHARED',
      },
    });
    const stripeProd = await testPrisma.paymentProviderAccount.create({
      data: {
        provider: PaymentProvider.STRIPE,
        environment: PaymentProviderEnvironment.PRODUCTION,
        accountKey: `m29-stripe-prod-${runId}`,
        ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
        ownerTenantId: tenantAId,
        countryCode: 'USA',
        currency: 'USD',
        status: PaymentProviderAccountStatus.INACTIVE,
      },
    });

    accDedAId = a1.id;
    accDedA2Id = a2.id;
    accSharedId = shared.id;
    accStripeProdId = stripeProd.id;

    await testPrisma.paymentProviderAccountTenant.createMany({
      data: [
        {
          tenantId: tenantAId,
          providerAccountId: accDedAId,
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          isActive: true,
        },
        {
          tenantId: tenantAId,
          providerAccountId: accDedA2Id,
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          isActive: true,
        },
        {
          tenantId: tenantAId,
          providerAccountId: accSharedId,
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          isActive: true,
        },
        {
          tenantId: tenantBId,
          providerAccountId: accSharedId,
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          isActive: true,
        },
      ],
    });
  });

  // =========================================================================
  // S-1: IMMUTABLE PROVIDER ACCOUNT IDENTITY & providerMerchantCode
  // =========================================================================
  describe('S-1: Immutable Provider Account Identity & providerMerchantCode', () => {
    it('blocks ownership/identity mutations and provider cascade rewrites while permitting operational credential rotation and one-time merchantCode enrichment', async () => {
      const { payment } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        providerAccountId: accDedAId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });

      // 1. Block PLATFORM_SHARED -> TENANT_DEDICATED ownership flip (anti-hijack)
      await expect(
        testPrisma.$executeRaw`
          UPDATE "PaymentProviderAccount"
          SET "ownershipMode" = 'TENANT_DEDICATED', "ownerTenantId" = ${tenantAId}
          WHERE "id" = ${accSharedId}
        `,
      ).rejects.toThrow(/identity attributes are immutable/);

      // 2. Block provider cascade rewrite via direct SQL
      await expect(
        testPrisma.$executeRaw`
          UPDATE "PaymentProviderAccount"
          SET "provider" = 'STRIPE'
          WHERE "id" = ${accDedAId}
        `,
      ).rejects.toThrow(/identity attributes are immutable/);

      // 3. Block environment, accountKey, countryCode, currency, ownerTenantId mutations
      for (const stmt of [
        testPrisma.$executeRaw`UPDATE "PaymentProviderAccount" SET "environment" = 'PRODUCTION' WHERE "id" = ${accDedAId}`,
        testPrisma.$executeRaw`UPDATE "PaymentProviderAccount" SET "accountKey" = 'tampered' WHERE "id" = ${accDedAId}`,
        testPrisma.$executeRaw`UPDATE "PaymentProviderAccount" SET "countryCode" = 'SAU' WHERE "id" = ${accDedAId}`,
        testPrisma.$executeRaw`UPDATE "PaymentProviderAccount" SET "currency" = 'SAR' WHERE "id" = ${accDedAId}`,
        testPrisma.$executeRaw`UPDATE "PaymentProviderAccount" SET "ownerTenantId" = ${tenantBId} WHERE "id" = ${accDedAId}`,
      ]) {
        await expect(stmt).rejects.toThrow(/identity attributes are immutable/);
      }

      // 4. Block PaymentProviderAccountTenant key mutations while allowing operational revocation
      await expect(
        testPrisma.$executeRaw`
          UPDATE "PaymentProviderAccountTenant"
          SET "tenantId" = ${tenantBId}
          WHERE "tenantId" = ${tenantAId} AND "providerAccountId" = ${accDedAId}
        `,
      ).rejects.toThrow(/identity keys are immutable/);

      // Verify persisted Payment & Account stayed intact after all rejected mutations
      const persistedPayment = await testPrisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(persistedPayment.provider).toBe(PaymentProvider.MYFATOORAH);
      expect(persistedPayment.providerAccountId).toBe(accDedAId);

      // 5. Legitimate operational credential rotation & status update succeed
      const rotated = await testPrisma.paymentProviderAccount.update({
        where: { id: accDedAId },
        data: {
          status: PaymentProviderAccountStatus.ROTATING,
          credentialRef: 'env:MYFATOORAH_SANDBOX_A1_V2',
          credentialVersion: 2,
          credentialRotatedAt: new Date(),
        },
      });
      expect(rotated.credentialVersion).toBe(2);
      expect(rotated.status).toBe(PaymentProviderAccountStatus.ROTATING);
      // Restore ACTIVE status after verifying operational rotation so subsequent binding tests use an ACTIVE account
      await testPrisma.paymentProviderAccount.update({
        where: { id: accDedAId },
        data: { status: PaymentProviderAccountStatus.ACTIVE },
      });

      // 6. providerMerchantCode validation, uniqueness, one-time NULL->known enrichment, and immutability
      await expect(
        testPrisma.paymentProviderAccount.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
            accountKey: `m29-blank-mc-${runId}`,
            providerMerchantCode: '   ',
            ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
            ownerTenantId: tenantAId,
            countryCode: 'KWT',
            currency: 'KWD',
          },
        }),
      ).rejects.toThrow(/PaymentProviderAccount_merchantCode_check/);

      await expect(
        testPrisma.paymentProviderAccount.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
            accountKey: `m29-secret-mc-${runId}`,
            providerMerchantCode: 'Bearer_token_value',
            ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
            ownerTenantId: tenantAId,
            countryCode: 'KWT',
            currency: 'KWD',
          },
        }),
      ).rejects.toThrow(/PaymentProviderAccount_merchantCode_check/);

      // Duplicate populated providerMerchantCode in same provider+environment rejected
      await expect(
        testPrisma.paymentProviderAccount.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
            accountKey: `m29-dup-mc-${runId}`,
            providerMerchantCode: `MF-MERCH-A1-${runId}`,
            ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
            ownerTenantId: tenantAId,
            countryCode: 'KWT',
            currency: 'KWD',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // One-time NULL -> known enrichment succeeds on accDedA2Id, then cannot be replaced or cleared
      const enriched = await testPrisma.paymentProviderAccount.update({
        where: { id: accDedA2Id },
        data: { providerMerchantCode: `MF-MERCH-A2-${runId}` },
      });
      expect(enriched.providerMerchantCode).toBe(`MF-MERCH-A2-${runId}`);

      await expect(
        testPrisma.paymentProviderAccount.update({
          where: { id: accDedA2Id },
          data: { providerMerchantCode: `MF-MERCH-OTHER-${runId}` },
        }),
      ).rejects.toThrow(/providerMerchantCode is immutable/);

      await expect(
        testPrisma.paymentProviderAccount.update({
          where: { id: accDedA2Id },
          data: { providerMerchantCode: null },
        }),
      ).rejects.toThrow(/providerMerchantCode is immutable/);
    });
  });

  // =========================================================================
  // S-2: EXACT MyFatoorahInvoice BINDING & CORRELATION IMMUTABILITY
  // =========================================================================
  describe('S-2: Exact MyFatoorahInvoice Binding', () => {
    it('blocks cross-account, cross-environment, non-MYFATOORAH, NULL-on-bound, bound-on-legacy, clearing, and reparenting while preserving valid legacy and bound invoices', async () => {
      const { payment: boundPay } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        providerAccountId: accDedAId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const { payment: boundPay2 } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        providerAccountId: accDedAId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const { payment: legacyPay } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        providerAccountId: null,
        providerEnvironment: null,
      });
      const { payment: codPay } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.NONE,
        method: PaymentMethod.CASH_ON_DELIVERY,
        status: PaymentStatus.PENDING,
        initiationState: PaymentInitiationState.INITIATED,
      });

      // Non-MYFATOORAH Payment rejected
      await expect(
        testPrisma.myFatoorahInvoice.create({
          data: {
            paymentId: codPay.id,
            invoiceId: `m29-inv-cod-${runId}`,
          },
        }),
      ).rejects.toThrow(/can only reference a MYFATOORAH Payment/);

      // STRIPE PRODUCTION account on MYFATOORAH SANDBOX payment rejected
      await expect(
        testPrisma.myFatoorahInvoice.create({
          data: {
            paymentId: boundPay.id,
            invoiceId: `m29-inv-stripe-${runId}`,
            providerAccountId: accStripeProdId,
            providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
          },
        }),
      ).rejects.toThrow(/must exactly match original Payment/);

      // Cross-account MYFATOORAH SANDBOX account rejected
      await expect(
        testPrisma.myFatoorahInvoice.create({
          data: {
            paymentId: boundPay.id,
            invoiceId: `m29-inv-xacc-${runId}`,
            providerAccountId: accDedA2Id,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/must exactly match original Payment/);

      // NULL account on bound payment rejected
      await expect(
        testPrisma.myFatoorahInvoice.create({
          data: {
            paymentId: boundPay.id,
            invoiceId: `m29-inv-null-${runId}`,
            providerAccountId: null,
            providerEnvironment: null,
          },
        }),
      ).rejects.toThrow(/must exactly match original Payment/);

      // Bound account on legacy NULL payment rejected
      await expect(
        testPrisma.myFatoorahInvoice.create({
          data: {
            paymentId: legacyPay.id,
            invoiceId: `m29-inv-boundleg-${runId}`,
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/must exactly match original Payment/);

      // Valid bound invoice succeeds
      const boundInv = await testPrisma.myFatoorahInvoice.create({
        data: {
          paymentId: boundPay.id,
          invoiceId: `m29-inv-ok-${runId}`,
          providerAccountId: accDedAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        },
      });
      expect(boundInv.providerAccountId).toBe(accDedAId);

      // Valid legacy NULL invoice succeeds
      const legacyInv = await testPrisma.myFatoorahInvoice.create({
        data: {
          paymentId: legacyPay.id,
          invoiceId: `m29-inv-leg-${runId}`,
          providerAccountId: null,
          providerEnvironment: null,
        },
      });
      expect(legacyInv.providerAccountId).toBeNull();

      // Clearing, rebinding, reparenting paymentId, or changing invoiceId all rejected
      await expect(
        testPrisma.myFatoorahInvoice.update({
          where: { paymentId: boundPay.id },
          data: { providerAccountId: null, providerEnvironment: null },
        }),
      ).rejects.toThrow(/binding is immutable/);

      await expect(
        testPrisma.myFatoorahInvoice.update({
          where: { paymentId: boundPay.id },
          data: { providerAccountId: accDedA2Id },
        }),
      ).rejects.toThrow(/binding is immutable/);

      await expect(
        testPrisma.$executeRaw`
          UPDATE "MyFatoorahInvoice" SET "invoiceId" = ${`m29-inv-rewritten-${runId}`} WHERE "paymentId" = ${boundPay.id}
        `,
      ).rejects.toThrow(/paymentId and invoiceId are immutable/);

      await expect(
        testPrisma.$executeRaw`
          UPDATE "MyFatoorahInvoice" SET "paymentId" = ${boundPay2.id} WHERE "paymentId" = ${boundPay.id}
        `,
      ).rejects.toThrow(/paymentId and invoiceId are immutable/);

      // Verify persisted invoice unchanged
      const persistedInv = await testPrisma.myFatoorahInvoice.findUniqueOrThrow({
        where: { paymentId: boundPay.id },
      });
      expect(persistedInv.invoiceId).toBe(`m29-inv-ok-${runId}`);
      expect(persistedInv.providerAccountId).toBe(accDedAId);
    });
  });

  // =========================================================================
  // S-3: PARENT-SIDE IDENTITY CONSISTENCY & PRE-INITIATION BINDING GUARD
  // =========================================================================
  describe('S-3: Parent-Side Identity Consistency', () => {
    it('blocks unsafe NULL->bound Payment updates (including combined evidence-clearing updates), provider changes, and PaymentRefund parent/child contradictions', async () => {
      // 1. Legitimate pre-initiation binding (NOT_STARTED + PENDING + no provider IDs + no children) SUCCEEDS
      const { payment: freshPending } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        status: PaymentStatus.PENDING,
        initiationState: PaymentInitiationState.NOT_STARTED,
      });
      const boundFresh = await testPrisma.payment.update({
        where: { id: freshPending.id },
        data: {
          providerAccountId: accDedAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        },
      });
      expect(boundFresh.providerAccountId).toBe(accDedAId);

      // 2. Legacy payment with providerPaymentId CANNOT be bound even in combined update clearing providerPaymentId + resetting initiationState
      const { payment: initiatedLegacy } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        status: PaymentStatus.PENDING,
        initiationState: PaymentInitiationState.INITIATED,
        providerPaymentId: `leg-pp-${runId}`,
      });
      await expect(
        testPrisma.payment.update({
          where: { id: initiatedLegacy.id },
          data: {
            initiationState: PaymentInitiationState.NOT_STARTED,
            providerPaymentId: null,
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/Established Payment providerPaymentId cannot be erased or replaced/);

      // Verify evidence was NOT cleared
      const stillInitiated = await testPrisma.payment.findUniqueOrThrow({
        where: { id: initiatedLegacy.id },
      });
      expect(stillInitiated.providerPaymentId).toBe(`leg-pp-${runId}`);
      expect(stillInitiated.providerAccountId).toBeNull();

      // 3. Payment with existing MyFatoorahInvoice CANNOT be bound even if NOT_STARTED/PENDING
      const { payment: withInv } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        status: PaymentStatus.PENDING,
        initiationState: PaymentInitiationState.NOT_STARTED,
      });
      await testPrisma.myFatoorahInvoice.create({
        data: { paymentId: withInv.id, invoiceId: `m29-s3-inv-${runId}` },
      });
      await expect(
        testPrisma.payment.update({
          where: { id: withInv.id },
          data: {
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/when financial child records already exist/);

      // 4. Payment with existing PaymentRefund CANNOT be bound
      const { order: ordWithRef, payment: payWithRef } =
        await seedOrderAndPayment({
          tenantId: tenantAId,
          userId: userAId,
          status: PaymentStatus.PENDING,
          initiationState: PaymentInitiationState.NOT_STARTED,
        });
      await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payWithRef.id,
          orderId: ordWithRef.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '2.000',
          currency: 'KWD',
          idempotencyKey: `s3-ref-${runId}`,
          requestFingerprint: 'fp-s3-ref',
          reason: 'Legacy refund before bind attempt',
          requestedByUserId: userAId,
        },
      });
      await expect(
        testPrisma.payment.update({
          where: { id: payWithRef.id },
          data: {
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/when financial child records already exist/);

      // 5. Original Payment provider is immutable once account-bound
      await expect(
        testPrisma.payment.update({
          where: { id: freshPending.id },
          data: { provider: PaymentProvider.STRIPE },
        }),
      ).rejects.toThrow(/provider is immutable/);

      // 6. Existing COD / NONE compatibility preserved
      const { payment: cod } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.NONE,
        method: PaymentMethod.CASH_ON_DELIVERY,
        status: PaymentStatus.PENDING,
        initiationState: PaymentInitiationState.INITIATED,
      });
      expect(cod.providerAccountId).toBeNull();
    });
  });

  // =========================================================================
  // S-4: DURABLE REFUND ATTEMPT STATE MATRIX, EVIDENCE IMMUTABILITY & APPEND-ONLY
  // =========================================================================
  describe('S-4: Durable Refund Attempt State & Evidence Safety', () => {
    it('enforces transition matrix, protects dispatch evidence from erasure, blocks deletion/reparenting, and preserves legitimate lookup/reconcile attempts', async () => {
      const { order, payment } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        providerAccountId: accDedAId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const refund = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accDedAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '4.000',
          currency: 'KWD',
          idempotencyKey: `s4-ref-${runId}`,
          requestFingerprint: 'fp-s4-ref',
          reason: 'S-4 state machine test',
          requestedByUserId: userAId,
        },
      });

      // Unsafe insertion combinations rejected by CHECK
      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 90,
            operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
            state: PaymentRefundAttemptState.ABANDONED,
            correlationId: `bad-ab-${runId}`,
            requestFingerprint: 'fp-s4-ref',
            dispatchedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/New SUBMIT_REFUND PaymentRefundAttempt must start in PREPARED state \(got ABANDONED\)/);

      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 91,
            operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
            state: PaymentRefundAttemptState.SUCCEEDED,
            correlationId: `bad-suc-${runId}`,
            requestFingerprint: 'fp-s4-ref',
            dispatchedAt: null,
          },
        }),
      ).rejects.toThrow(/New SUBMIT_REFUND PaymentRefundAttempt must start in PREPARED state \(got SUCCEEDED\)/);

      // Never-dispatched PREPARED attempt CAN transition to ABANDONED (releasing ownership safely)
      const prepAttempt = await testPrisma.paymentRefundAttempt.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: refund.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accDedAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          attemptNumber: 1,
          operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
          state: PaymentRefundAttemptState.PREPARED,
          correlationId: `prep-${runId}`,
          requestFingerprint: 'fp-s4-ref',
        },
      });
      await testPrisma.paymentRefundAttempt.update({
        where: { id: prepAttempt.id },
        data: { state: PaymentRefundAttemptState.ABANDONED, completedAt: new Date() },
      });

      // Terminal ABANDONED cannot mutate state
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: prepAttempt.id },
          data: { state: PaymentRefundAttemptState.PREPARED },
        }),
      ).rejects.toThrow(/out of terminal state ABANDONED/);

      // Second attempt starts in PREPARED then transitions to DISPATCHING with durable boundary fields
      const dispTime = new Date();
      const prepAttempt2 = await testPrisma.paymentRefundAttempt.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: refund.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accDedAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          attemptNumber: 2,
          operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
          state: PaymentRefundAttemptState.PREPARED,
          correlationId: `disp-${runId}`,
          requestFingerprint: 'fp-s4-ref',
        },
      });
      const dispAttempt = await testPrisma.paymentRefundAttempt.update({
        where: { id: prepAttempt2.id },
        data: {
          state: PaymentRefundAttemptState.DISPATCHING,
          dispatchOwner: 'm29-worker-1',
          fencingToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 30_000),
          dispatchedAt: dispTime,
          providerHttpStatus: 504,
        },
      });

      // DISPATCHING -> ABANDONED rejected
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: dispAttempt.id },
          data: { state: PaymentRefundAttemptState.ABANDONED },
        }),
      ).rejects.toThrow(/Illegal PaymentRefundAttempt transition from DISPATCHING to ABANDONED/);

      // DISPATCHING -> PREPARED rejected
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: dispAttempt.id },
          data: { state: PaymentRefundAttemptState.PREPARED },
        }),
      ).rejects.toThrow(/Illegal PaymentRefundAttempt transition from DISPATCHING to PREPARED/);

      // Clearing dispatch evidence (dispatchedAt / providerHttpStatus) in attempt to bypass ABANDONED guard rejected
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: dispAttempt.id },
          data: { dispatchedAt: null, providerHttpStatus: null },
        }),
      ).rejects.toThrow(/dispatch and provider evidence cannot be erased/);

      // Move DISPATCHING -> AMBIGUOUS (allowed)
      await testPrisma.paymentRefundAttempt.update({
        where: { id: dispAttempt.id },
        data: { state: PaymentRefundAttemptState.AMBIGUOUS },
      });

      // AMBIGUOUS cannot transition to ABANDONED, PREPARED, DISPATCHING, or DEFINITIVELY_FAILED
      for (const badState of [
        PaymentRefundAttemptState.ABANDONED,
        PaymentRefundAttemptState.PREPARED,
        PaymentRefundAttemptState.DISPATCHING,
        PaymentRefundAttemptState.DEFINITIVELY_FAILED,
      ]) {
        await expect(
          testPrisma.paymentRefundAttempt.update({
            where: { id: dispAttempt.id },
            data: { state: badState },
          }),
        ).rejects.toThrow(/ambiguous attempts cannot release submission ownership/);
      }

      // Deleting or reparenting attempt history to bypass single-submission index rejected
      await expect(
        testPrisma.$executeRaw`DELETE FROM "PaymentRefundAttempt" WHERE "id" = ${dispAttempt.id}`,
      ).rejects.toThrow(/Deleting PaymentRefundAttempt history is prohibited/);

      await expect(
        testPrisma.$executeRaw`UPDATE "PaymentRefundAttempt" SET "attemptNumber" = 99 WHERE "id" = ${dispAttempt.id}`,
      ).rejects.toThrow(/identity, correlation, and lineage fields are immutable/);

      // Second SUBMIT_REFUND remains blocked while attempt 2 is AMBIGUOUS
      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 3,
            operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
            state: PaymentRefundAttemptState.PREPARED,
            correlationId: `dup-sub-${runId}`,
            requestFingerprint: 'fp-s4-ref',
          },
        }),
      ).rejects.toThrow(/already has a dispatched SUBMIT_REFUND attempt; additional outbound submission is prohibited/);

      // Legitimate LOOKUP_STATUS and RECONCILE attempts remain allowed alongside AMBIGUOUS
      const reconcileAtt = await testPrisma.paymentRefundAttempt.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: refund.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accDedAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          attemptNumber: 3,
          operation: PaymentRefundAttemptOperation.RECONCILE,
          state: PaymentRefundAttemptState.SUCCEEDED,
          correlationId: `rec-${runId}`,
          requestFingerprint: 'fp-s4-ref',
          completedAt: new Date(),
        },
      });
      expect(reconcileAtt.operation).toBe(PaymentRefundAttemptOperation.RECONCILE);

      // AMBIGUOUS -> SUCCEEDED (once confirmed) succeeds and becomes terminal
      await testPrisma.paymentRefundAttempt.update({
        where: { id: dispAttempt.id },
        data: {
          state: PaymentRefundAttemptState.SUCCEEDED,
          providerRefundId: `MF-S4-OK-${runId}`,
          completedAt: new Date(),
        },
      });
      await expect(
        testPrisma.paymentRefundAttempt.update({
          where: { id: dispAttempt.id },
          data: { providerRefundId: `MF-S4-TAMPER-${runId}` },
        }),
      ).rejects.toThrow(/Terminal PaymentRefundAttempt .* is completely frozen; outcome, evidence, lease, and metadata cannot be modified/);
      expect(
        await testPrisma.paymentRefundAttempt.findUniqueOrThrow({
          where: { id: dispAttempt.id },
          select: { providerRefundId: true },
        }),
      ).toEqual({ providerRefundId: `MF-S4-OK-${runId}` });
    });
  });

  // =========================================================================
  // S-5: DURABLE LEGACY CONFLICT AUDIT & LINKAGE RULES
  // =========================================================================
  describe('S-5: Durable Legacy Conflict Audit Linkage', () => {
    it('supports LEGACY_UNRESOLVED_ACCOUNT on Payment without creating PaymentRefund, blocks invalid linkage shapes/cross-tenant refs/deletions, and preserves unresolved external event audits', async () => {
      const { order: legOrder, payment: legPay } = await seedOrderAndPayment({
        tenantId: tenantAId,
        userId: userAId,
        providerAccountId: null,
        providerEnvironment: null,
        providerPaymentId: `leg-s5-${runId}`,
      });

      // 1. Valid LEGACY_UNRESOLVED_ACCOUNT audit linked to (tenantId, orderId, paymentId) with refundId = NULL
      const legacyAudit = await testPrisma.paymentRefundConflictAudit.create({
        data: {
          tenantId: tenantAId,
          orderId: legOrder.id,
          paymentId: legPay.id,
          refundId: null,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: null,
          providerEnvironment: null,
          source: PaymentRefundConflictSource.INTERNAL_RECONCILIATION,
          conflictType: PaymentRefundConflictType.LEGACY_UNRESOLVED_ACCOUNT,
          summary: `Blocked real refund on unresolved legacy payment (${runId})`,
        },
      });
      expect(legacyAudit.conflictType).toBe(
        PaymentRefundConflictType.LEGACY_UNRESOLVED_ACCOUNT,
      );
      expect(legacyAudit.refundId).toBeNull();
      const orphanRefundCount = await testPrisma.paymentRefund.count({
        where: { paymentId: legPay.id },
      });
      expect(orphanRefundCount).toBe(0);

      // 2. Valid unresolved external event audit (all linkage columns NULL)
      const extAudit = await testPrisma.paymentRefundConflictAudit.create({
        data: {
          tenantId: null,
          orderId: null,
          paymentId: null,
          refundId: null,
          provider: PaymentProvider.MYFATOORAH,
          source: PaymentRefundConflictSource.WEBHOOK,
          conflictType: PaymentRefundConflictType.UNKNOWN_EXTERNAL_REFUND,
          summary: `Unknown external refund webhook (${runId})`,
        },
      });
      expect(extAudit.tenantId).toBeNull();

      // 3. Invalid linkage shapes rejected by CHECK (paymentId without tenantId/orderId; orderId without paymentId)
      await expect(
        testPrisma.paymentRefundConflictAudit.create({
          data: {
            tenantId: null,
            orderId: legOrder.id,
            paymentId: legPay.id,
            provider: PaymentProvider.MYFATOORAH,
            source: PaymentRefundConflictSource.INTERNAL_RECONCILIATION,
            conflictType: PaymentRefundConflictType.LEGACY_UNRESOLVED_ACCOUNT,
            summary: 'Missing tenantId',
          },
        }),
      ).rejects.toThrow(/PaymentRefundConflictAudit_linkage_shape_check/);

      await expect(
        testPrisma.paymentRefundConflictAudit.create({
          data: {
            tenantId: tenantAId,
            orderId: legOrder.id,
            paymentId: null,
            provider: PaymentProvider.MYFATOORAH,
            source: PaymentRefundConflictSource.INTERNAL_RECONCILIATION,
            conflictType: PaymentRefundConflictType.LEGACY_UNRESOLVED_ACCOUNT,
            summary: 'orderId without paymentId',
          },
        }),
      ).rejects.toThrow(/PaymentRefundConflictAudit_linkage_shape_check/);

      // 4. Cross-tenant (tenantB + tenantA's order/payment) rejected by composite FK
      await expect(
        testPrisma.paymentRefundConflictAudit.create({
          data: {
            tenantId: tenantBId,
            orderId: legOrder.id,
            paymentId: legPay.id,
            provider: PaymentProvider.MYFATOORAH,
            source: PaymentRefundConflictSource.INTERNAL_RECONCILIATION,
            conflictType: PaymentRefundConflictType.LEGACY_UNRESOLVED_ACCOUNT,
            summary: 'Cross-tenant payment audit',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });

      // 5. Account mismatch on payment-level audit rejected by trigger
      await expect(
        testPrisma.paymentRefundConflictAudit.create({
          data: {
            tenantId: tenantAId,
            orderId: legOrder.id,
            paymentId: legPay.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            source: PaymentRefundConflictSource.INTERNAL_RECONCILIATION,
            conflictType: PaymentRefundConflictType.ACCOUNT_ENVIRONMENT_MISMATCH,
            summary: 'Fabricated account on legacy payment audit',
          },
        }),
      ).rejects.toThrow(/must match original Payment/);

      // 6. Audit reparenting and deletion rejected; operational resolution update allowed
      await expect(
        testPrisma.$executeRaw`DELETE FROM "PaymentRefundConflictAudit" WHERE "id" = ${legacyAudit.id}`,
      ).rejects.toThrow(/Deleting PaymentRefundConflictAudit history is prohibited/);

      await expect(
        testPrisma.$executeRaw`UPDATE "PaymentRefundConflictAudit" SET "paymentId" = NULL, "orderId" = NULL WHERE "id" = ${legacyAudit.id}`,
      ).rejects.toThrow(/financial lineage and classification are immutable/);

      const resolved = await testPrisma.paymentRefundConflictAudit.update({
        where: { id: legacyAudit.id },
        data: {
          resolutionState: PaymentRefundConflictResolutionState.RESOLVED,
          resolvedAt: new Date(),
          resolvedByUserId: userAId,
        },
      });
      expect(resolved.resolutionState).toBe(
        PaymentRefundConflictResolutionState.RESOLVED,
      );
    });
  });

  // =========================================================================
  // SECTION 8: REAL MULTI-CONNECTION POSTGRESQL CONCURRENCY TESTS (ALL 5 SCENARIOS)
  // =========================================================================
  describe('Section 8: Multi-Connection PostgreSQL Concurrency Safety', () => {
    it('Scenario 1 & 2 (BOTH orderings): serializes parent Payment NULL->bound against concurrent MyFatoorahInvoice insertion with zero contradictory state or deadlocks', async () => {
      const observer = await openPgClient();
      try {
        // --- Ordering A: Parent binding starts BEFORE child invoice insertion ---
        const { payment: p1 } = await seedOrderAndPayment({
          tenantId: tenantAId,
          userId: userAId,
          status: PaymentStatus.PENDING,
          initiationState: PaymentInitiationState.NOT_STARTED,
        });
        const c1 = await openPgClient();
        const c2 = await openPgClient();
        try {
          const c2Pid = (await c2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          await c1.query('BEGIN');
          await c1.query(
            `UPDATE "Payment" SET "providerAccountId" = $1, "providerEnvironment" = 'SANDBOX' WHERE "id" = $2`,
            [accDedAId, p1.id],
          );

          await c2.query('BEGIN');
          const c2Insert = c2.query(
            `INSERT INTO "MyFatoorahInvoice" ("paymentId","invoiceId","providerAccountId","providerEnvironment")
             VALUES ($1,$2,NULL,NULL)`,
            [p1.id, `conc-ordA-${runId}`],
          );
          const blocked = await waitUntilBlocked(observer, c2Pid);
          expect(blocked).toBe(true);

          await c1.query('COMMIT');
          await expect(c2Insert).rejects.toThrow(/must exactly match original Payment/);
          await c2.query('ROLLBACK');

          const finalPay = await testPrisma.payment.findUniqueOrThrow({ where: { id: p1.id } });
          const finalInv = await testPrisma.myFatoorahInvoice.findUnique({ where: { paymentId: p1.id } });
          expect(finalPay.providerAccountId).toBe(accDedAId);
          expect(finalInv).toBeNull();
        } finally {
          await c1.end().catch(() => {});
          await c2.end().catch(() => {});
        }

        // --- Ordering B: Child invoice insertion starts BEFORE parent binding ---
        const { payment: p2 } = await seedOrderAndPayment({
          tenantId: tenantAId,
          userId: userAId,
          status: PaymentStatus.PENDING,
          initiationState: PaymentInitiationState.NOT_STARTED,
        });
        const c3 = await openPgClient();
        const c4 = await openPgClient();
        try {
          const c4Pid = (await c4.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          await c3.query('BEGIN');
          await c3.query(
            `INSERT INTO "MyFatoorahInvoice" ("paymentId","invoiceId","providerAccountId","providerEnvironment")
             VALUES ($1,$2,NULL,NULL)`,
            [p2.id, `conc-ordB-${runId}`],
          );

          await c4.query('BEGIN');
          const c4Update = c4.query(
            `UPDATE "Payment" SET "providerAccountId" = $1, "providerEnvironment" = 'SANDBOX' WHERE "id" = $2`,
            [accDedAId, p2.id],
          );
          const blocked = await waitUntilBlocked(observer, c4Pid);
          expect(blocked).toBe(true);

          await c3.query('COMMIT');
          await expect(c4Update).rejects.toThrow(/when financial child records already exist/);
          await c4.query('ROLLBACK');

          const finalPay = await testPrisma.payment.findUniqueOrThrow({ where: { id: p2.id } });
          const finalInv = await testPrisma.myFatoorahInvoice.findUniqueOrThrow({ where: { paymentId: p2.id } });
          expect(finalPay.providerAccountId).toBeNull();
          expect(finalInv.providerAccountId).toBeNull();
        } finally {
          await c3.end().catch(() => {});
          await c4.end().catch(() => {});
        }
      } finally {
        await observer.end().catch(() => {});
      }
    });

    it('Scenario 3, 4 & 5: serializes concurrent conflicting account bindings, authorization key mutation vs binding, and refund identity update vs child creation', async () => {
      const observer = await openPgClient();
      try {
        // --- Scenario 3: Concurrent conflicting account bindings (accDedAId vs accDedA2Id) ---
        const { payment: p3 } = await seedOrderAndPayment({
          tenantId: tenantAId,
          userId: userAId,
          status: PaymentStatus.PENDING,
          initiationState: PaymentInitiationState.NOT_STARTED,
        });
        const c1 = await openPgClient();
        const c2 = await openPgClient();
        try {
          const c2Pid = (await c2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          await c1.query('BEGIN');
          await c1.query(
            `UPDATE "Payment" SET "providerAccountId" = $1, "providerEnvironment" = 'SANDBOX' WHERE "id" = $2`,
            [accDedAId, p3.id],
          );

          await c2.query('BEGIN');
          const c2Bind = c2.query(
            `UPDATE "Payment" SET "providerAccountId" = $1, "providerEnvironment" = 'SANDBOX' WHERE "id" = $2`,
            [accDedA2Id, p3.id],
          );
          expect(await waitUntilBlocked(observer, c2Pid)).toBe(true);

          await c1.query('COMMIT');
          await expect(c2Bind).rejects.toThrow(/Historical Payment provider account binding is immutable/);
          await c2.query('ROLLBACK');

          const finalPay = await testPrisma.payment.findUniqueOrThrow({ where: { id: p3.id } });
          expect(finalPay.providerAccountId).toBe(accDedAId);
        } finally {
          await c1.end().catch(() => {});
          await c2.end().catch(() => {});
        }

        // --- Scenario 4: Concurrent authorization identity mutation vs financial binding ---
        const { payment: p4 } = await seedOrderAndPayment({
          tenantId: tenantAId,
          userId: userAId,
          status: PaymentStatus.PENDING,
          initiationState: PaymentInitiationState.NOT_STARTED,
        });
        const c3 = await openPgClient();
        const c4 = await openPgClient();
        try {
          await c3.query('BEGIN');
          await c3.query(
            `UPDATE "Payment" SET "providerAccountId" = $1, "providerEnvironment" = 'SANDBOX' WHERE "id" = $2`,
            [accDedAId, p4.id],
          );
          // Concurrent attempt to mutate authorization identity keys is immediately rejected
          await c4.query('BEGIN');
          const c4Pid = (await c4.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          const c4Mutate = c4.query(
            `UPDATE "PaymentProviderAccountTenant" SET "tenantId" = $1 WHERE "tenantId" = $2 AND "providerAccountId" = $3`,
            [tenantBId, tenantAId, accDedAId],
          );
          expect(await waitUntilBlocked(observer, c4Pid)).toBe(true);
          await c3.query('COMMIT');
          await expect(c4Mutate).rejects.toThrow(/identity keys are immutable/);
          await c4.query('ROLLBACK');

          const finalPay = await testPrisma.payment.findUniqueOrThrow({ where: { id: p4.id } });
          expect(finalPay.providerAccountId).toBe(accDedAId);
        } finally {
          await c3.end().catch(() => {});
          await c4.end().catch(() => {});
        }

        // --- Scenario 5: Concurrent PaymentRefund identity update vs linked child creation (BOTH orderings) ---
        const { order: o5, payment: p5 } = await seedOrderAndPayment({
          tenantId: tenantAId,
          userId: userAId,
          providerAccountId: accDedAId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        });
        const ref5 = await testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: p5.id,
            orderId: o5.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accDedAId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            amount: '3.000',
            currency: 'KWD',
            idempotencyKey: `conc-s5-${runId}`,
            requestFingerprint: 'fp-conc-s5',
            reason: 'Concurrency S5',
            requestedByUserId: userAId,
          },
        });
        const c5 = await openPgClient();
        const c6 = await openPgClient();
        try {
          const c6Pid = (await c6.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          await c5.query('BEGIN');
          // Child recovery job acquires FOR SHARE on PaymentRefund
          await c5.query(
            `INSERT INTO "PaymentRefundRecoveryJob" ("id","tenantId","refundId","provider","providerAccountId","providerEnvironment","operation","state","updatedAt")
             VALUES ($1,$2,$3,'MYFATOORAH',$4,'SANDBOX',$5,$6,NOW())`,
            [
              randomUUID(),
              tenantAId,
              ref5.id,
              accDedAId,
              PaymentRefundRecoveryOperation.POLL_REFUND_STATUS,
              PaymentRefundRecoveryJobState.READY,
            ],
          );

          await c6.query('BEGIN');
          const c6Update = c6.query(
            `UPDATE "PaymentRefund" SET "providerAccountId" = $1 WHERE "id" = $2`,
            [accDedA2Id, ref5.id],
          );
          expect(await waitUntilBlocked(observer, c6Pid)).toBe(true);

          await c5.query('COMMIT');
          await expect(c6Update).rejects.toThrow(/Historical PaymentRefund provider account binding is immutable/);
          await c6.query('ROLLBACK');

          // Also verify linked webhook event with mismatched account is rejected even concurrently
          await expect(
            testPrisma.myFatoorahRefundWebhookEvent.create({
              data: {
                provider: PaymentProvider.MYFATOORAH,
                providerAccountId: accDedA2Id,
                providerEnvironment: PaymentProviderEnvironment.SANDBOX,
                tenantId: tenantAId,
                paymentId: p5.id,
                orderId: o5.id,
                refundId: ref5.id,
                eventCode: 2,
                eventName: 'REFUND_STATUS_CHANGED',
                eventReference: `CONC-WH-${runId}`,
                payloadFingerprint: 'fp-conc-wh',
                signatureStatus: WebhookSignatureStatus.VALID,
                state: RefundWebhookEventState.RECEIVED,
              },
            }),
          ).rejects.toThrow(/must match parent PaymentRefund/);
        } finally {
          await c5.end().catch(() => {});
          await c6.end().catch(() => {});
        }
      } finally {
        await observer.end().catch(() => {});
      }
    });
  });
});
