import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';
import {
  PaymentMethod,
  PaymentProvider,
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
} from '../../src/generated/prisma/client.js';

describe('Phase 2D.12 Step 2A — PaymentRefund Ledger Schema & DB Constraints', () => {
  const runId = randomUUID().slice(0, 8);

  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;
  let orderA1Id: string;
  let paymentA1Id: string;
  let orderA2Id: string;
  let paymentA2Id: string;
  let orderB1Id: string;
  let paymentB1Id: string;

  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  const baseShippingAddress = {
    firstName: 'Refund',
    lastName: 'Tester',
    addressLine1: 'Block 1 Street 1',
    city: 'Kuwait City',
    country: 'KW',
  };

  async function seedOrderAndPayment(params: {
    tenantId: string;
    userId: string;
    orderNumber: string;
    provider: PaymentProvider;
    method: PaymentMethod;
    status: PaymentStatus;
    amount: string;
    currency: string;
  }) {
    const order = await testPrisma.order.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        orderNumber: params.orderNumber,
        status: 'CONFIRMED',
        paymentStatus: params.status,
        currency: params.currency,
        subtotal: params.amount,
        discountAmount: '0',
        shippingAmount: '0',
        taxAmount: '0',
        totalAmount: params.amount,
        shippingAddress: baseShippingAddress,
        billingAddress: baseShippingAddress,
      },
    });

    const payment = await testPrisma.payment.create({
      data: {
        orderId: order.id,
        provider: params.provider,
        method: params.method,
        status: params.status,
        amount: params.amount,
        currency: params.currency,
        initiationState: 'INITIATED',
        providerPaymentId:
          params.provider === PaymentProvider.MYFATOORAH
            ? `inv-${order.id.slice(0, 8)}`
            : null,
      },
    });

    return { orderId: order.id, paymentId: payment.id };
  }

  beforeAll(async () => {
    const tenantA = await testPrisma.tenant.create({
      data: {
        name: `Refund Schema Tenant A ${runId}`,
        slug: `refund-schema-a-${runId}`,
        code: `RSA_${runId.toUpperCase()}`,
        defaultCurrency: 'KWD',
      },
    });
    const tenantB = await testPrisma.tenant.create({
      data: {
        name: `Refund Schema Tenant B ${runId}`,
        slug: `refund-schema-b-${runId}`,
        code: `RSB_${runId.toUpperCase()}`,
        defaultCurrency: 'KWD',
      },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    createdTenantIds.push(tenantAId, tenantBId);

    const userA = await testPrisma.user.create({
      data: {
        email: `refund-schema-a-${runId}@example.test`,
        passwordHash: 'unused-hash',
        firstName: 'Owner',
        lastName: 'Alpha',
        emailVerifiedAt: new Date(),
      },
    });
    const userB = await testPrisma.user.create({
      data: {
        email: `refund-schema-b-${runId}@example.test`,
        passwordHash: 'unused-hash',
        firstName: 'Owner',
        lastName: 'Beta',
        emailVerifiedAt: new Date(),
      },
    });
    userAId = userA.id;
    userBId = userB.id;
    createdUserIds.push(userAId, userBId);

    const a1 = await seedOrderAndPayment({
      tenantId: tenantAId,
      userId: userAId,
      orderNumber: `ORD-A1-${runId}`,
      provider: PaymentProvider.MYFATOORAH,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PAID,
      amount: '10.000',
      currency: 'KWD',
    });
    orderA1Id = a1.orderId;
    paymentA1Id = a1.paymentId;

    const a2 = await seedOrderAndPayment({
      tenantId: tenantAId,
      userId: userAId,
      orderNumber: `ORD-A2-${runId}`,
      provider: PaymentProvider.MYFATOORAH,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PAID,
      amount: '25.500',
      currency: 'KWD',
    });
    orderA2Id = a2.orderId;
    paymentA2Id = a2.paymentId;

    const b1 = await seedOrderAndPayment({
      tenantId: tenantBId,
      userId: userBId,
      orderNumber: `ORD-B1-${runId}`,
      provider: PaymentProvider.MYFATOORAH,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PAID,
      amount: '15.000',
      currency: 'KWD',
    });
    orderB1Id = b1.orderId;
    paymentB1Id = b1.paymentId;
  });

  afterAll(async () => {
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: createdTenantIds } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: createdTenantIds } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: createdTenantIds } },
    });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: createdTenantIds } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  });

  it('creates a valid PaymentRefund row preserving exact Decimal(14,4) precision and audit defaults', async () => {
    const created = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantAId,
        paymentId: paymentA1Id,
        orderId: orderA1Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: new Prisma.Decimal('3.0015'),
        currency: 'KWD',
        idempotencyKey: `ref-valid-${runId}`,
        requestFingerprint: 'sha256:valid-fingerprint-1',
        reason: 'Partial item return credit',
        requestedByUserId: userAId,
        providerMetadata: { apiVersion: 'v2', serviceChargeOnCustomer: false },
      },
    });

    expect(created.id).toBeTruthy();
    expect(created.status).toBe(PaymentRefundStatus.REQUESTED);
    expect(created.amount.toFixed(4)).toBe('3.0015');
    expect(created.currency).toBe('KWD');
    expect(created.requestedAt).toBeInstanceOf(Date);
    expect(created.submittedAt).toBeNull();
    expect(created.completedAt).toBeNull();
    expect(created.providerRefundId).toBeNull();
    expect(created.providerRefundReference).toBeNull();
    expect(created.providerRefundInvoiceId).toBeNull();

    // Verify all 6 PaymentRefundStatus enum states can be stored
    for (const status of [
      PaymentRefundStatus.SUBMITTED,
      PaymentRefundStatus.PENDING,
      PaymentRefundStatus.RECONCILIATION_REQUIRED,
      PaymentRefundStatus.FAILED,
      PaymentRefundStatus.SUCCEEDED,
    ]) {
      const updated = await testPrisma.paymentRefund.update({
        where: { id: created.id },
        data: { status },
      });
      expect(updated.status).toBe(status);
    }
  });

  it('enforces idempotency uniqueness per (tenantId, paymentId) while allowing multiple distinct partial refunds', async () => {
    const sharedKey = `ref-idem-${runId}`;

    const first = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantAId,
        paymentId: paymentA1Id,
        orderId: orderA1Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '2.000',
        currency: 'KWD',
        idempotencyKey: sharedKey,
        requestFingerprint: 'sha256:idem-1',
        reason: 'Partial refund #1',
        requestedByUserId: userAId,
      },
    });

    // Duplicate key on same (tenantId, paymentId) MUST fail with P2002
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: paymentA1Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '2.000',
          currency: 'KWD',
          idempotencyKey: sharedKey,
          requestFingerprint: 'sha256:idem-1',
          reason: 'Duplicate attempt',
          requestedByUserId: userAId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Distinct key on same payment succeeds (supports multiple partial refunds)
    const second = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantAId,
        paymentId: paymentA1Id,
        orderId: orderA1Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '1.500',
        currency: 'KWD',
        idempotencyKey: `ref-idem-second-${runId}`,
        requestFingerprint: 'sha256:idem-2',
        reason: 'Partial refund #2',
        requestedByUserId: userAId,
      },
    });
    expect(second.id).not.toBe(first.id);

    // Same key on a DIFFERENT payment in the same tenant succeeds
    const otherPaymentRefund = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantAId,
        paymentId: paymentA2Id,
        orderId: orderA2Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '5.000',
        currency: 'KWD',
        idempotencyKey: sharedKey,
        requestFingerprint: 'sha256:idem-other-payment',
        reason: 'Refund on separate payment',
        requestedByUserId: userAId,
      },
    });
    expect(otherPaymentRefund.paymentId).toBe(paymentA2Id);
  });

  it('rejects cross-tenant, cross-order, and invalid foreign-key references at the PostgreSQL layer', async () => {
    // 1. Cross-tenant: Tenant B referencing Tenant A's order & payment
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantBId,
          paymentId: paymentA1Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `ref-xtenant-${runId}`,
          requestFingerprint: 'sha256:xtenant',
          reason: 'Cross-tenant hijack attempt',
          requestedByUserId: userBId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    // 2. Cross-order within same tenant: Order A1 paired with Payment A2
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: paymentA2Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `ref-xorder-${runId}`,
          requestFingerprint: 'sha256:xorder',
          reason: 'Cross-order mismatch attempt',
          requestedByUserId: userAId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    // 3. Non-existent requestedByUserId
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: paymentA1Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `ref-baduser-${runId}`,
          requestFingerprint: 'sha256:baduser',
          reason: 'Invalid actor FK',
          requestedByUserId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects non-positive amounts, invalid ISO currencies, and blank audit fields via PostgreSQL CHECK constraints', async () => {
    for (const badAmount of ['0', '0.0000', '-1.000', '-0.0001']) {
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: paymentA1Id,
            orderId: orderA1Id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            amount: badAmount,
            currency: 'KWD',
            idempotencyKey: `ref-amt-${badAmount}-${runId}`,
            requestFingerprint: 'sha256:bad-amt',
            reason: 'Invalid amount test',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toThrow(/PaymentRefund_amount_positive_check/);
    }

    for (const badCurrency of ['kwd', 'KW', 'KWDD', '']) {
      await expect(
        testPrisma.paymentRefund.create({
          data: {
            tenantId: tenantAId,
            paymentId: paymentA1Id,
            orderId: orderA1Id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            amount: '1.000',
            currency: badCurrency,
            idempotencyKey: `ref-cur-${badCurrency || 'empty'}-${runId}`,
            requestFingerprint: 'sha256:bad-cur',
            reason: 'Invalid currency test',
            requestedByUserId: userAId,
          },
        }),
      ).rejects.toThrow(/PaymentRefund_currency_iso_check/);
    }

    // Blank reason
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: paymentA1Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `ref-blank-reason-${runId}`,
          requestFingerprint: 'sha256:blank-reason',
          reason: '   ',
          requestedByUserId: userAId,
        },
      }),
    ).rejects.toThrow(/PaymentRefund_required_audit_text_check/);

    // Blank non-null providerRefundId
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: paymentA1Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `ref-blank-prov-${runId}`,
          requestFingerprint: 'sha256:blank-prov',
          providerRefundId: '   ',
          reason: 'Blank provider refund ID test',
          requestedByUserId: userAId,
        },
      }),
    ).rejects.toThrow(/PaymentRefund_required_audit_text_check/);
  });

  it('allows multiple NULL provider IDs and enforces tenant+provider scoped uniqueness for non-null provider IDs', async () => {
    // Two rows with NULL providerRefundId & NULL providerRefundReference in same (tenantId, provider)
    const null1 = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantAId,
        paymentId: paymentA2Id,
        orderId: orderA2Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '1.000',
        currency: 'KWD',
        idempotencyKey: `ref-null-1-${runId}`,
        requestFingerprint: 'sha256:null-1',
        providerRefundId: null,
        providerRefundReference: null,
        reason: 'Null provider ref 1',
        requestedByUserId: userAId,
      },
    });
    const null2 = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantAId,
        paymentId: paymentA2Id,
        orderId: orderA2Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '1.000',
        currency: 'KWD',
        idempotencyKey: `ref-null-2-${runId}`,
        requestFingerprint: 'sha256:null-2',
        providerRefundId: null,
        providerRefundReference: null,
        reason: 'Null provider ref 2',
        requestedByUserId: userAId,
      },
    });
    expect(null1.id).not.toBe(null2.id);

    const sharedProviderRefundId = `MF-REF-ID-${runId}`;
    const sharedProviderRefundRef = `MF-REF-REF-${runId}`;

    await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantAId,
        paymentId: paymentA2Id,
        orderId: orderA2Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '2.000',
        currency: 'KWD',
        status: PaymentRefundStatus.SUBMITTED,
        idempotencyKey: `ref-prov-a1-${runId}`,
        requestFingerprint: 'sha256:prov-a1',
        providerRefundId: sharedProviderRefundId,
        providerRefundReference: sharedProviderRefundRef,
        providerRefundInvoiceId: `MF-RINV-${runId}`,
        reason: 'Provider ref tenant A',
        requestedByUserId: userAId,
        submittedAt: new Date(),
      },
    });

    // Duplicate providerRefundId within SAME tenant & provider MUST fail with P2002
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: paymentA1Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `ref-prov-a-dup-id-${runId}`,
          requestFingerprint: 'sha256:prov-a-dup-id',
          providerRefundId: sharedProviderRefundId,
          reason: 'Duplicate providerRefundId same tenant',
          requestedByUserId: userAId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Duplicate providerRefundReference within SAME tenant & provider MUST fail with P2002
    await expect(
      testPrisma.paymentRefund.create({
        data: {
          tenantId: tenantAId,
          paymentId: paymentA1Id,
          orderId: orderA1Id,
          provider: PaymentProvider.MYFATOORAH,
          method: PaymentMethod.CARD,
          amount: '1.000',
          currency: 'KWD',
          idempotencyKey: `ref-prov-a-dup-ref-${runId}`,
          requestFingerprint: 'sha256:prov-a-dup-ref',
          providerRefundReference: sharedProviderRefundRef,
          reason: 'Duplicate providerRefundReference same tenant',
          requestedByUserId: userAId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Same providerRefundId & providerRefundReference in INDEPENDENT Tenant B MUST succeed
    const tenantBRefund = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantBId,
        paymentId: paymentB1Id,
        orderId: orderB1Id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '3.000',
        currency: 'KWD',
        status: PaymentRefundStatus.SUBMITTED,
        idempotencyKey: `ref-prov-b1-${runId}`,
        requestFingerprint: 'sha256:prov-b1',
        providerRefundId: sharedProviderRefundId,
        providerRefundReference: sharedProviderRefundRef,
        reason: 'Independent merchant account refund ID',
        requestedByUserId: userBId,
      },
    });
    expect(tenantBRefund.tenantId).toBe(tenantBId);
    expect(tenantBRefund.providerRefundId).toBe(sharedProviderRefundId);
  });

  it('keeps existing Payment and Order records compatible with and without refund rows', async () => {
    const cod = await seedOrderAndPayment({
      tenantId: tenantBId,
      userId: userBId,
      orderNumber: `ORD-COD-COMPAT-${runId}`,
      provider: PaymentProvider.NONE,
      method: PaymentMethod.CASH_ON_DELIVERY,
      status: PaymentStatus.PENDING,
      amount: '7.250',
      currency: 'KWD',
    });

    const codPayment = await testPrisma.payment.findUniqueOrThrow({
      where: { id: cod.paymentId },
      include: { refunds: true },
    });
    expect(codPayment.refunds).toHaveLength(0);
    expect(codPayment.amount.toFixed(3)).toBe('7.250');

    const refundedPayment = await testPrisma.payment.findUniqueOrThrow({
      where: { id: paymentA1Id },
      include: { refunds: true },
    });
    expect(refundedPayment.refunds.length).toBeGreaterThanOrEqual(3);
  });
});
