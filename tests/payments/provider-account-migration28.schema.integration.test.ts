import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';
import {
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
  PaymentRefundStatus,
  PaymentStatus,
  RefundWebhookEventState,
  WebhookSignatureStatus,
} from '../../src/generated/prisma/client.js';

describe('Phase 2D.12 Step 2C-2A — Provider Account Identity & Migration 28 Schema Constraints', () => {
  const runId = randomUUID().slice(0, 8);

  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;

  let accASandboxId: string;
  let accAProdId: string;
  let accASecondSandboxId: string;
  let accSharedSandboxId: string;

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  const addr = {
    firstName: 'Mig28',
    lastName: 'Tester',
    addressLine1: 'Block 4 Street 2',
    city: 'Kuwait City',
    country: 'KW',
  };

  async function seedOrderWithPayment(params: {
    tenantId: string;
    userId: string;
    provider: PaymentProvider;
    method: PaymentMethod;
    amount?: string;
    currency?: string;
    providerAccountId?: string | null;
    providerEnvironment?: PaymentProviderEnvironment | null;
    providerPaymentId?: string | null;
    providerTransactionId?: string | null;
  }) {
    const amount = params.amount ?? '10.000';
    const currency = params.currency ?? 'KWD';
    const order = await testPrisma.order.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        orderNumber: `M28-${randomUUID().slice(0, 12)}`,
        status: 'CONFIRMED',
        paymentStatus: PaymentStatus.PAID,
        currency,
        subtotal: amount,
        discountAmount: '0',
        shippingAmount: '0',
        taxAmount: '0',
        totalAmount: amount,
        shippingAddress: addr,
        billingAddress: addr,
      },
    });

    const payment = await testPrisma.payment.create({
      data: {
        orderId: order.id,
        provider: params.provider,
        method: params.method,
        status: PaymentStatus.PAID,
        amount,
        currency,
        initiationState: 'INITIATED',
        providerPaymentId: params.providerPaymentId ?? null,
        providerTransactionId: params.providerTransactionId ?? null,
        providerAccountId: params.providerAccountId ?? null,
        providerEnvironment: params.providerEnvironment ?? null,
      },
    });

    return { order, payment };
  }

  beforeAll(async () => {
    const tA = await testPrisma.tenant.create({
      data: {
        name: `Mig28 Tenant A ${runId}`,
        slug: `mig28-a-${runId}`,
        code: `M28A_${runId.toUpperCase()}`,
        defaultCurrency: 'KWD',
      },
    });
    const tB = await testPrisma.tenant.create({
      data: {
        name: `Mig28 Tenant B ${runId}`,
        slug: `mig28-b-${runId}`,
        code: `M28B_${runId.toUpperCase()}`,
        defaultCurrency: 'KWD',
      },
    });
    tenantAId = tA.id;
    tenantBId = tB.id;
    createdTenantIds.push(tenantAId, tenantBId);

    const uA = await testPrisma.user.create({
      data: {
        email: `mig28-a-${runId}@example.test`,
        passwordHash: 'unused-hash',
        firstName: 'Owner',
        lastName: 'A',
        emailVerifiedAt: new Date(),
      },
    });
    const uB = await testPrisma.user.create({
      data: {
        email: `mig28-b-${runId}@example.test`,
        passwordHash: 'unused-hash',
        firstName: 'Owner',
        lastName: 'B',
        emailVerifiedAt: new Date(),
      },
    });
    userAId = uA.id;
    userBId = uB.id;
    createdUserIds.push(userAId, userBId);
  });

  afterAll(async () => {
    // Migration 29 enforces append-only delete protection on PaymentRefundAttempt
    // and PaymentRefundConflictAudit, and ON DELETE RESTRICT across financial history.
    // All test records are isolated by unique runId on a disposable PostgreSQL DB
    // that scripts/test-postgres.ts drops immediately after the test run.
  });

  // =========================================================================
  // A. PROVIDER ACCOUNT IDENTITY (Items 1-8)
  // =========================================================================
  describe('A. Provider Account Identity', () => {
    it('supports dedicated & shared accounts, distinct sandbox/production & multi-account identities, credential rotation, COD compatibility, and blocks duplicates & cross-tenant hijack', async () => {
      // 1. Valid provider account creation (defaults to INACTIVE, never auto-activates PRODUCTION)
      const accASandbox = await testPrisma.paymentProviderAccount.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          accountKey: `mf-tenant-a-primary-${runId}`,
          ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
          ownerTenantId: tenantAId,
          countryCode: 'KWT',
          currency: 'KWD',
          status: PaymentProviderAccountStatus.ACTIVE,
          credentialRef: 'env:MYFATOORAH_API_TOKEN_A',
        },
      });
      accASandboxId = accASandbox.id;
      expect(accASandbox.credentialVersion).toBe(1);

      // 2. Distinct SANDBOX vs PRODUCTION account with same accountKey succeeds, defaults INACTIVE
      const accAProd = await testPrisma.paymentProviderAccount.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.PRODUCTION,
          accountKey: `mf-tenant-a-primary-${runId}`,
          ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
          ownerTenantId: tenantAId,
          countryCode: 'KWT',
          currency: 'KWD',
          credentialRef: 'secret:prod/mf/tenant-a',
        },
      });
      accAProdId = accAProd.id;
      expect(accAProd.status).toBe(PaymentProviderAccountStatus.INACTIVE);

      // 3. Second distinct merchant account for same provider & tenant in SANDBOX
      const accASecond = await testPrisma.paymentProviderAccount.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          accountKey: `mf-tenant-a-secondary-${runId}`,
          ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
          ownerTenantId: tenantAId,
          countryCode: 'KWT',
          currency: 'KWD',
          status: PaymentProviderAccountStatus.ACTIVE,
        },
      });
      accASecondSandboxId = accASecond.id;

      // Explicit PLATFORM_SHARED account authorized for both Tenant A and Tenant B
      const accShared = await testPrisma.paymentProviderAccount.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          environment: PaymentProviderEnvironment.SANDBOX,
          accountKey: `mf-platform-shared-${runId}`,
          ownershipMode: PaymentProviderAccountOwnership.PLATFORM_SHARED,
          ownerTenantId: null,
          countryCode: 'KWT',
          currency: 'KWD',
          status: PaymentProviderAccountStatus.ACTIVE,
          credentialRef: 'env:MYFATOORAH_API_TOKEN',
        },
      });
      accSharedSandboxId = accShared.id;

      // 4. Duplicate (provider, environment, accountKey) rejected with P2002
      await expect(
        testPrisma.paymentProviderAccount.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
            accountKey: `mf-tenant-a-primary-${runId}`,
            ownershipMode: PaymentProviderAccountOwnership.TENANT_DEDICATED,
            ownerTenantId: tenantAId,
            countryCode: 'KWT',
            currency: 'KWD',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // Raw Bearer token in credentialRef rejected by CHECK constraint
      await expect(
        testPrisma.paymentProviderAccount.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
            accountKey: `mf-bad-cred-${runId}`,
            ownershipMode: PaymentProviderAccountOwnership.PLATFORM_SHARED,
            ownerTenantId: null,
            countryCode: 'KWT',
            currency: 'KWD',
            credentialRef: 'Bearer secret-token-must-never-be-stored',
          },
        }),
      ).rejects.toThrow(/PaymentProviderAccount_fields_check/);

      // Provider NONE cannot create a provider account
      await expect(
        testPrisma.paymentProviderAccount.create({
          data: {
            provider: PaymentProvider.NONE,
            environment: PaymentProviderEnvironment.MOCK,
            accountKey: `none-bad-${runId}`,
            ownershipMode: PaymentProviderAccountOwnership.PLATFORM_SHARED,
            ownerTenantId: null,
            countryCode: 'KWT',
            currency: 'KWD',
          },
        }),
      ).rejects.toThrow(/PaymentProviderAccount_provider_check/);

      // Authorize Tenant A on its dedicated accounts & both tenants on shared account
      await testPrisma.paymentProviderAccountTenant.createMany({
        data: [
          {
            tenantId: tenantAId,
            providerAccountId: accASandboxId,
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
          },
          {
            tenantId: tenantAId,
            providerAccountId: accAProdId,
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.PRODUCTION,
          },
          {
            tenantId: tenantAId,
            providerAccountId: accASecondSandboxId,
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
          },
          {
            tenantId: tenantAId,
            providerAccountId: accSharedSandboxId,
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
          },
          {
            tenantId: tenantBId,
            providerAccountId: accSharedSandboxId,
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
          },
        ],
      });

      // 5. Unauthorized cross-tenant association on TENANT_DEDICATED account rejected by DB trigger
      await expect(
        testPrisma.paymentProviderAccountTenant.create({
          data: {
            tenantId: tenantBId,
            providerAccountId: accASandboxId,
            provider: PaymentProvider.MYFATOORAH,
            environment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toThrow(/Cross-tenant association prohibited/);

      // 7. Credential rotation increments version while preserving stable internal id & accountKey
      const rotated = await testPrisma.paymentProviderAccount.update({
        where: { id: accASandboxId },
        data: {
          credentialVersion: { increment: 1 },
          credentialRotatedAt: new Date(),
          status: PaymentProviderAccountStatus.ACTIVE,
        },
      });
      expect(rotated.id).toBe(accASandboxId);
      expect(rotated.accountKey).toBe(`mf-tenant-a-primary-${runId}`);
      expect(rotated.credentialVersion).toBe(2);

      // 8. COD / NONE payment needs no provider account and rejects binding to one
      const cod = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.NONE,
        method: PaymentMethod.CASH_ON_DELIVERY,
      });
      expect(cod.payment.providerAccountId).toBeNull();
      expect(cod.payment.providerEnvironment).toBeNull();
      await expect(
        seedOrderWithPayment({
          tenantId: tenantAId,
          userId: userAId,
          provider: PaymentProvider.NONE,
          method: PaymentMethod.CASH_ON_DELIVERY,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        }),
      ).rejects.toThrow(/Payment_none_provider_account_check/);
    });
  });

  // =========================================================================
  // B. PAYMENT & REFUND ACCOUNT BINDING (Items 9-16)
  // =========================================================================
  describe('B. Original Payment & Refund Account Binding', () => {
    it('enforces exact account/environment/tenant/order binding, immutability, and legacy NULL preservation', async () => {
      // 9. Valid original payment + invoice account binding
      const invId = `m28-inv-a1-${runId}`;
      const txnId = `m28-txn-a1-${runId}`;
      const { order: orderA1, payment: payA1 } = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accASandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        providerPaymentId: invId,
        providerTransactionId: txnId,
      });
      const mfInv = await testPrisma.myFatoorahInvoice.create({
        data: {
          paymentId: payA1.id,
          invoiceId: invId,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        },
      });
      expect(mfInv.providerAccountId).toBe(accASandboxId);

      // 6 & 15. Historical payment account binding is immutable (cannot rebind to replacement account)
      await expect(
        testPrisma.payment.update({
          where: { id: payA1.id },
          data: { providerAccountId: accASecondSandboxId },
        }),
      ).rejects.toThrow(/Historical Payment provider account binding is immutable/);

      // 13. Cross-tenant payment binding to Tenant A's dedicated account rejected by trigger
      await expect(
        seedOrderWithPayment({
          tenantId: tenantBId,
          userId: userBId,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
        }),
      ).rejects.toThrow(/not authorized for order tenant/);

      // 10. Valid refund bound to exact same account & environment succeeds
      const validRefund = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payA1.id,
          orderId: orderA1.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '3.000',
          currency: 'KWD',
          idempotencyKey: `b-valid-${runId}`,
          requestFingerprint: 'fp-b-valid',
          reason: 'Valid same-account refund',
          requestedByUserId: userAId,
        },
      });
      expect(validRefund.providerAccountId).toBe(accASandboxId);

      // 11. Refund bound to a DIFFERENT account rejected at DB layer
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: payA1.id,
            orderId: orderA1.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accASecondSandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            amount: '1.000',
            currency: 'KWD',
            idempotencyKey: `b-diff-acc-${runId}`,
            requestFingerprint: 'fp-b-diff-acc',
            reason: 'Wrong account attempt',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toThrow(/must exactly match original Payment/);

      // 12. Refund bound to a DIFFERENT environment (PRODUCTION vs SANDBOX) rejected
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: payA1.id,
            orderId: orderA1.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accAProdId,
            providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
            amount: '1.000',
            currency: 'KWD',
            idempotencyKey: `b-diff-env-${runId}`,
            requestFingerprint: 'fp-b-diff-env',
            reason: 'Wrong environment attempt',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toThrow(/must exactly match original Payment/);

      // Refund trying NULL account on an account-bound payment rejected (closes MATCH SIMPLE loophole)
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: payA1.id,
            orderId: orderA1.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: null,
            providerEnvironment: null,
            amount: '1.000',
            currency: 'KWD',
            idempotencyKey: `b-null-bypass-${runId}`,
            requestFingerprint: 'fp-b-null-bypass',
            reason: 'NULL bypass attempt',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toThrow(/must exactly match original Payment/);

      // 14. Cross-order refund rejected by composite FK
      const { order: orderA2 } = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accASandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: payA1.id,
            orderId: orderA2.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accASandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            amount: '1.000',
            currency: 'KWD',
            idempotencyKey: `b-xorder-${runId}`,
            requestFingerprint: 'fp-b-xorder',
            reason: 'Cross-order attempt',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });

      // 15. Original providerPaymentId and providerTransactionId untouched
      const reloadedPay = await testPrisma.payment.findUniqueOrThrow({
        where: { id: payA1.id },
      });
      expect(reloadedPay.providerPaymentId).toBe(invId);
      expect(reloadedPay.providerTransactionId).toBe(txnId);

      // 16. Legacy unresolved (NULL) payment & refund remain NULL without fabricated account
      const legacy = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: null,
        providerEnvironment: null,
      });
      const legacyRefund = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: legacy.payment.id,
          orderId: legacy.order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: null,
          providerEnvironment: null,
          amount: '2.000',
          currency: 'KWD',
          idempotencyKey: `b-legacy-${runId}`,
          requestFingerprint: 'fp-b-legacy',
          reason: 'Legacy unresolved refund',
          requestedByUserId: userAId,
        },
      });
      expect(legacyRefund.providerAccountId).toBeNull();
      expect(legacyRefund.providerEnvironment).toBeNull();
    });
  });

  // =========================================================================
  // C. PROVIDER IDENTIFIER UNIQUENESS (Items 17-21)
  // =========================================================================
  describe('C. Provider Identifier Uniqueness', () => {
    it('enforces account-scoped uniqueness across shared tenants, isolates distinct accounts & environments, and closes legacy NULL loopholes', async () => {
      const sharedRefId = `EXT-REF-ID-${runId}`;
      const sharedRefNo = `EXT-REF-NO-${runId}`;

      // Shared account payment for Tenant A and Tenant B
      const sharedA = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accSharedSandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const sharedB = await seedOrderWithPayment({
        tenantId: tenantBId,
        userId: userBId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accSharedSandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });

      await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: sharedA.payment.id,
          orderId: sharedA.order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accSharedSandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '2.000',
          currency: 'KWD',
          status: PaymentRefundStatus.SUCCEEDED,
          idempotencyKey: `c-sh-a-${runId}`,
          requestFingerprint: 'fp-c-sh-a',
          providerRefundId: sharedRefId,
          providerRefundReference: sharedRefNo,
          reason: 'Tenant A on shared account',
          requestedByUserId: userAId,
        },
      });

      // 17. Duplicate providerRefundId within SAME shared account (even different tenant!) -> P2002
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantBId,
            paymentId: sharedB.payment.id,
            orderId: sharedB.order.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accSharedSandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            amount: '2.000',
            currency: 'KWD',
            status: PaymentRefundStatus.SUCCEEDED,
            idempotencyKey: `c-sh-b-dup-${runId}`,
            requestFingerprint: 'fp-c-sh-b-dup',
            providerRefundId: sharedRefId,
            reason: 'Cross-tenant duplicate on shared account MUST fail',
            requestedByUserId: userBId,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // 18. Same providerRefundId in a DISTINCT merchant account (even same tenant!) succeeds
      const distinctAccPay = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accASecondSandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const distinctAccRefund = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: distinctAccPay.payment.id,
          orderId: distinctAccPay.order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accASecondSandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '2.000',
          currency: 'KWD',
          status: PaymentRefundStatus.SUCCEEDED,
          idempotencyKey: `c-dist-acc-${runId}`,
          requestFingerprint: 'fp-c-dist-acc',
          providerRefundId: sharedRefId,
          providerRefundReference: sharedRefNo,
          reason: 'Distinct merchant account same numeric ID',
          requestedByUserId: userAId,
        },
      });
      expect(distinctAccRefund.providerRefundId).toBe(sharedRefId);

      // 19. Same providerRefundId in PRODUCTION vs SANDBOX isolated and succeeds
      const prodPay = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accAProdId,
        providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
      });
      const prodRefund = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: prodPay.payment.id,
          orderId: prodPay.order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accAProdId,
          providerEnvironment: PaymentProviderEnvironment.PRODUCTION,
          amount: '2.000',
          currency: 'KWD',
          status: PaymentRefundStatus.SUCCEEDED,
          idempotencyKey: `c-prod-${runId}`,
          requestFingerprint: 'fp-c-prod',
          providerRefundId: sharedRefId,
          providerRefundReference: sharedRefNo,
          reason: 'Production environment isolated from sandbox',
          requestedByUserId: userAId,
        },
      });
      expect(prodRefund.providerEnvironment).toBe(
        PaymentProviderEnvironment.PRODUCTION,
      );

      // 20. Nullable legacy rows still enforce tenant+provider deduplication (no NULL loophole)
      const legacyPay = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
      });
      const legacyRefId = `LEG-REF-${runId}`;
      await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: legacyPay.payment.id,
          orderId: legacyPay.order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `c-leg-1-${runId}`,
          requestFingerprint: 'fp-c-leg-1',
          providerRefundId: legacyRefId,
          reason: 'Legacy refund 1',
          requestedByUserId: userAId,
        },
      });
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: legacyPay.payment.id,
            orderId: legacyPay.order.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            amount: '1.000',
            currency: 'KWD',
            idempotencyKey: `c-leg-2-${runId}`,
            requestFingerprint: 'fp-c-leg-2',
            providerRefundId: legacyRefId,
            reason: 'Legacy duplicate providerRefundId MUST fail',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // 21. Migration 27 (tenantId, paymentId, idempotencyKey) uniqueness still active
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: sharedA.payment.id,
            orderId: sharedA.order.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            providerAccountId: accSharedSandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            amount: '2.000',
            currency: 'KWD',
            idempotencyKey: `c-sh-a-${runId}`,
            requestFingerprint: 'fp-c-sh-a',
            reason: 'Duplicate idempotency key MUST fail',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // =========================================================================
  // D. DURABLE ATTEMPTS (Items 22-28)
  // =========================================================================
  describe('D. Durable Refund Attempts', () => {
    it('enforces attempt numbering, concurrent submission ownership, ambiguous state, status lookup distinction, and account/tenant matching', async () => {
      const { order, payment } = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accASandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const refund = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '5.000',
          currency: 'KWD',
          idempotencyKey: `d-ref-${runId}`,
          requestFingerprint: 'fp-d-ref',
          reason: 'Attempt durability test',
          requestedByUserId: userAId,
        },
      });

      // 22. Valid SUBMIT_REFUND attempt creation (starts in PREPARED, then transitions to DISPATCHING)
      const prepared1 = await testPrisma.paymentRefundAttempt.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: refund.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          attemptNumber: 1,
          operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
          state: PaymentRefundAttemptState.PREPARED,
          correlationId: refund.id,
          requestFingerprint: 'fp-d-ref',
        },
      });
      const attempt1 = await testPrisma.paymentRefundAttempt.update({
        where: { id: prepared1.id },
        data: {
          state: PaymentRefundAttemptState.DISPATCHING,
          dispatchOwner: 'api-pod-1',
          fencingToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 30_000),
          dispatchedAt: new Date(),
        },
      });
      expect(attempt1.attemptNumber).toBe(1);

      // 23. Duplicate attemptNumber rejected (P2002)
      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 1,
            operation: PaymentRefundAttemptOperation.LOOKUP_STATUS,
            state: PaymentRefundAttemptState.PREPARED,
            correlationId: `lookup-${refund.id}`,
            requestFingerprint: 'fp-d-ref',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // 25. Concurrent SUBMIT_REFUND ownership constraint blocks second SUBMIT_REFUND (P2002)
      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 2,
            operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
            state: PaymentRefundAttemptState.PREPARED,
            correlationId: refund.id,
            requestFingerprint: 'fp-d-ref',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // 27. Transition attempt 1 to AMBIGUOUS -> STILL blocks any blind resend of SUBMIT_REFUND
      await testPrisma.paymentRefundAttempt.update({
        where: { id: attempt1.id },
        data: {
          state: PaymentRefundAttemptState.AMBIGUOUS,
          failureClassification: 'TIMEOUT',
          reconciliationReason: 'HTTP_RESPONSE_LOST',
          completedAt: new Date(),
        },
      });
      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 2,
            operation: PaymentRefundAttemptOperation.SUBMIT_REFUND,
            state: PaymentRefundAttemptState.PREPARED,
            correlationId: refund.id,
            requestFingerprint: 'fp-d-ref',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // 26 & 28. Safe LOOKUP_STATUS attempts allowed alongside AMBIGUOUS submission; historical attempts preserved
      const lookupAttempt = await testPrisma.paymentRefundAttempt.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: refund.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          attemptNumber: 2,
          operation: PaymentRefundAttemptOperation.LOOKUP_STATUS,
          state: PaymentRefundAttemptState.SUCCEEDED,
          correlationId: `status-check-${refund.id}`,
          requestFingerprint: 'fp-d-ref',
          completedAt: new Date(),
        },
      });
      expect(lookupAttempt.operation).toBe(
        PaymentRefundAttemptOperation.LOOKUP_STATUS,
      );
      const history = await testPrisma.paymentRefundAttempt.findMany({
        where: { refundId: refund.id },
        orderBy: { attemptNumber: 'asc' },
      });
      expect(history).toHaveLength(2);
      expect(history[0]!.state).toBe(PaymentRefundAttemptState.AMBIGUOUS);

      // 24. Invalid account association rejected by trigger
      await expect(
        testPrisma.paymentRefundAttempt.create({
          data: {
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: refund.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASecondSandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            attemptNumber: 3,
            operation: PaymentRefundAttemptOperation.LOOKUP_STATUS,
            state: PaymentRefundAttemptState.PREPARED,
            correlationId: `bad-acc-${refund.id}`,
            requestFingerprint: 'fp-d-ref',
          },
        }),
      ).rejects.toThrow(/must match parent PaymentRefund/);
    });
  });

  // =========================================================================
  // E. REFUND RECOVERY JOBS (Items 29-34)
  // =========================================================================
  describe('E. Refund Recovery Jobs', () => {
    it('supports independent jobs per refund on one payment, enforces single active job, preserves history, rejects invalid bindings, and exposes scheduling indexes', async () => {
      const { order, payment } = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accASandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const r1 = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '3.000',
          currency: 'KWD',
          idempotencyKey: `e-r1-${runId}`,
          requestFingerprint: 'fp-e-r1',
          reason: 'Refund 1 recovery',
          requestedByUserId: userAId,
        },
      });
      const r2 = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '4.000',
          currency: 'KWD',
          idempotencyKey: `e-r2-${runId}`,
          requestFingerprint: 'fp-e-r2',
          reason: 'Refund 2 recovery',
          requestedByUserId: userAId,
        },
      });

      // 29 & 30. Independent active recovery jobs for two refunds on the SAME payment
      const job1 = await testPrisma.paymentRefundRecoveryJob.create({
        data: {
          tenantId: tenantAId,
          refundId: r1.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          operation: PaymentRefundRecoveryOperation.POLL_REFUND_STATUS,
          state: PaymentRefundRecoveryJobState.READY,
        },
      });
      const job2 = await testPrisma.paymentRefundRecoveryJob.create({
        data: {
          tenantId: tenantAId,
          refundId: r2.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          operation: PaymentRefundRecoveryOperation.RECONCILE_SUBMISSION,
          state: PaymentRefundRecoveryJobState.RUNNING,
          leaseOwner: 'worker-1',
          leaseUntil: new Date(Date.now() + 30_000),
          fencingVersion: 1,
        },
      });
      expect(job1.refundId).toBe(r1.id);
      expect(job2.refundId).toBe(r2.id);

      // 31. Duplicate active recovery job on r1 rejected (P2002)
      await expect(
        testPrisma.paymentRefundRecoveryJob.create({
          data: {
            tenantId: tenantAId,
            refundId: r1.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            state: PaymentRefundRecoveryJobState.READY,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // 33. Completing job1 preserves history and permits a subsequent job if needed
      await testPrisma.paymentRefundRecoveryJob.update({
        where: { id: job1.id },
        data: {
          state: PaymentRefundRecoveryJobState.COMPLETED,
          completedAt: new Date(),
        },
      });
      const followupJob = await testPrisma.paymentRefundRecoveryJob.create({
        data: {
          tenantId: tenantAId,
          refundId: r1.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          operation: PaymentRefundRecoveryOperation.MANUAL_REVIEW,
          state: PaymentRefundRecoveryJobState.MANUAL,
        },
      });
      expect(followupJob.id).not.toBe(job1.id);
      expect(
        await testPrisma.paymentRefundRecoveryJob.count({
          where: { refundId: r1.id },
        }),
      ).toBe(2);

      // 32. Invalid tenant / account relationship rejected
      await expect(
        testPrisma.paymentRefundRecoveryJob.create({
          data: {
            tenantId: tenantBId,
            refundId: r1.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });

      await expect(
        testPrisma.paymentRefundRecoveryJob.create({
          data: {
            tenantId: tenantAId,
            refundId: r1.id,
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASecondSandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            state: PaymentRefundRecoveryJobState.MANUAL,
          },
        }),
      ).rejects.toThrow(/must match parent PaymentRefund/);

      // 34. Required scheduling and claiming indexes exist in PostgreSQL
      const indexes = await testPrisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'PaymentRefundRecoveryJob'
      `;
      const names = new Set(indexes.map((i) => i.indexname));
      expect(names.has('PaymentRefundRecoveryJob_state_nextRunAt_idx')).toBe(true);
      expect(names.has('PaymentRefundRecoveryJob_state_leaseUntil_idx')).toBe(true);
      expect(names.has('PaymentRefundRecoveryJob_active_refund_uniq')).toBe(true);
    });
  });

  // =========================================================================
  // F. WEBHOOK & CONFLICT AUDIT (Items 35-42)
  // =========================================================================
  describe('F. Refund Webhook Events & Financial Conflict Audit', () => {
    it('deduplicates exact webhooks, quarantines conflicting & unresolved events, blocks cross-account linking, records terminal conflicts without mutating history, and enforces RESTRICT deletion', async () => {
      const { order, payment } = await seedOrderWithPayment({
        tenantId: tenantAId,
        userId: userAId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        providerAccountId: accASandboxId,
        providerEnvironment: PaymentProviderEnvironment.SANDBOX,
      });
      const terminalRefund = await testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          amount: '5.000',
          currency: 'KWD',
          status: PaymentRefundStatus.SUCCEEDED,
          idempotencyKey: `f-term-${runId}`,
          requestFingerprint: 'fp-f-term',
          providerRefundId: `MF-TERM-${runId}`,
          providerRefundReference: `MF-TERM-REF-${runId}`,
          reason: 'Immutable settled refund',
          requestedByUserId: userAId,
          submittedAt: new Date(),
          completedAt: new Date(),
        },
      });

      // 35. Valid refund webhook event storage
      const evRef = `WH-REF-${runId}`;
      const wh1 = await testPrisma.myFatoorahRefundWebhookEvent.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: terminalRefund.id,
          eventCode: 2,
          eventName: 'REFUND_STATUS_CHANGED',
          eventReference: evRef,
          payloadFingerprint: 'sha256:fp-original',
          providerRefundId: terminalRefund.providerRefundId,
          providerStatus: 'REFUNDED',
          signatureStatus: WebhookSignatureStatus.VALID,
          state: RefundWebhookEventState.PROCESSED,
          processedAt: new Date(),
        },
      });
      expect(wh1.state).toBe(RefundWebhookEventState.PROCESSED);

      // 36. Exact duplicate (same eventReference + same payloadFingerprint) rejected (P2002)
      await expect(
        testPrisma.myFatoorahRefundWebhookEvent.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            eventCode: 2,
            eventName: 'REFUND_STATUS_CHANGED',
            eventReference: evRef,
            payloadFingerprint: 'sha256:fp-original',
            signatureStatus: WebhookSignatureStatus.VALID,
            state: RefundWebhookEventState.DUPLICATE,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // 37. Conflicting payload reusing same eventReference with DIFFERENT payloadFingerprint is retained for quarantine
      const conflictingWh = await testPrisma.myFatoorahRefundWebhookEvent.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: terminalRefund.id,
          eventCode: 2,
          eventName: 'REFUND_STATUS_CHANGED',
          eventReference: evRef,
          payloadFingerprint: 'sha256:fp-tampered-or-conflicting',
          providerRefundId: terminalRefund.providerRefundId,
          providerStatus: 'CANCELED',
          signatureStatus: WebhookSignatureStatus.VALID,
          state: RefundWebhookEventState.QUARANTINED_CONFLICT,
          conflictReason: 'TERMINAL_STATE_CONTRADICTION',
        },
      });
      expect(conflictingWh.state).toBe(
        RefundWebhookEventState.QUARANTINED_CONFLICT,
      );

      // 38. Unresolved account/tenant/refund event safely stored with NULL tenant & account
      const unresolvedWh = await testPrisma.myFatoorahRefundWebhookEvent.create({
        data: {
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: null,
          providerEnvironment: null,
          tenantId: null,
          paymentId: null,
          orderId: null,
          refundId: null,
          eventCode: 2,
          eventName: 'REFUND_STATUS_CHANGED',
          eventReference: `WH-UNKNOWN-${runId}`,
          payloadFingerprint: 'sha256:fp-unknown',
          providerRefundId: '99999999',
          signatureStatus: WebhookSignatureStatus.UNVERIFIED_ACCOUNT,
          state: RefundWebhookEventState.QUARANTINED_UNKNOWN_REFUND,
        },
      });
      expect(unresolvedWh.tenantId).toBeNull();
      expect(unresolvedWh.providerAccountId).toBeNull();

      // 39. Cross-account event association rejected by trigger
      await expect(
        testPrisma.myFatoorahRefundWebhookEvent.create({
          data: {
            provider: PaymentProvider.MYFATOORAH,
            providerAccountId: accASecondSandboxId,
            providerEnvironment: PaymentProviderEnvironment.SANDBOX,
            tenantId: tenantAId,
            paymentId: payment.id,
            orderId: order.id,
            refundId: terminalRefund.id,
            eventCode: 2,
            eventName: 'REFUND_STATUS_CHANGED',
            eventReference: `WH-XACC-${runId}`,
            payloadFingerprint: 'sha256:fp-xacc',
            signatureStatus: WebhookSignatureStatus.VALID,
            state: RefundWebhookEventState.RECEIVED,
          },
        }),
      ).rejects.toThrow(/must match parent PaymentRefund/);

      // 40 & 41. Durable terminal conflict audit created without modifying immutable terminal PaymentRefund
      const conflictAudit = await testPrisma.paymentRefundConflictAudit.create({
        data: {
          tenantId: tenantAId,
          paymentId: payment.id,
          orderId: order.id,
          refundId: terminalRefund.id,
          webhookEventId: conflictingWh.id,
          provider: PaymentProvider.MYFATOORAH,
          providerAccountId: accASandboxId,
          providerEnvironment: PaymentProviderEnvironment.SANDBOX,
          source: PaymentRefundConflictSource.WEBHOOK,
          conflictType: PaymentRefundConflictType.TERMINAL_STATE_CONTRADICTION,
          resolutionState: PaymentRefundConflictResolutionState.OPEN,
          expectedRefundStatus: PaymentRefundStatus.SUCCEEDED,
          observedExternalStatus: 'CANCELED',
          expectedAmount: '5.000',
          observedAmount: '5.000',
          currency: 'KWD',
          providerRefundId: terminalRefund.providerRefundId,
          summary: `Contradictory CANCELED webhook after SUCCEEDED settlement (${runId})`,
        },
      });
      expect(conflictAudit.resolutionState).toBe(
        PaymentRefundConflictResolutionState.OPEN,
      );

      const untouchedTerminal = await testPrisma.paymentRefund.findUniqueOrThrow({
        where: { id: terminalRefund.id },
      });
      expect(untouchedTerminal.status).toBe(PaymentRefundStatus.SUCCEEDED);
      expect(untouchedTerminal.providerRefundId).toBe(`MF-TERM-${runId}`);

      // 42. Restrictive deletion preserves financial history (ON DELETE RESTRICT)
      await expect(
        testPrisma.paymentRefund.delete({ where: { id: terminalRefund.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        testPrisma.paymentProviderAccount.delete({
          where: { id: accASandboxId },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
