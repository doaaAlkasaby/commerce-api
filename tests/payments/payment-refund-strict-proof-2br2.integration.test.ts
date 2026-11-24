import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ipKeyGenerator } from 'express-rate-limit';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      PAYMENT_PROVIDER: 'MOCK',
      MOCK_CHECKOUT_BASE_URL: 'http://localhost:3000',
      MOCK_CHECKOUT_SECRET: 'step-2br2-mock-refund-secret-at-least-32-chars!',
    },
  };
});

import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import {
  globalRateLimiter,
  sensitiveRateLimiter,
} from '../../src/config/rate-limit.js';
import { testPrisma } from '../../src/config/test-database.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentRefundStatus,
  PaymentStatus,
  ProductStatus,
} from '../../src/generated/prisma/client.js';
import { PaymentRefundService } from '../../src/modules/payments/payment-refund.service.js';
import { PaymentVerificationService } from '../../src/modules/payments/payment-verification.service.js';
import { PaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { MockMyFatoorahProvider } from '../../src/modules/payments/providers/mock-myfatoorah.provider.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import type { PaymentProviderAdapter } from '../../src/modules/payments/providers/payment-provider.js';
import type { TrustedPaymentTransition } from '../../src/modules/payments/payment.types.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

describe('Phase 2D.12 Step 2B-R2 — Strict Refund Ledger Proof & Legacy Bypass Closure', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = randomUUID().slice(0, 8);
  const countryCode = `P${tenantA.id.slice(-7)}`.toUpperCase();

  let ownerAId: string;
  let ownerAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let ownerBId: string;
  let customerBId: string;
  let customerBToken: string;

  let addressAId: string;
  let addressBId: string;
  let variantAId: string;
  let variantBId: string;
  let inventoryAId: string;
  let inventoryBId: string;
  let shippingMethodCodeA: string;
  let shippingMethodCodeB: string;

  const createdUserIds: string[] = [];

  const paymentService = new PaymentService();
  const mockRegistry = new PaymentProviderRegistry({
    PAYMENT_PROVIDER: 'MOCK',
    MOCK_CHECKOUT_SECRET: 'step-2br2-mock-refund-secret-at-least-32-chars!',
    MOCK_CHECKOUT_BASE_URL: 'http://localhost:3000',
  });
  const refundService = new PaymentRefundService(
    undefined,
    paymentService,
    mockRegistry,
  );

  const asOwnerA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${ownerAToken}`);
  const asCustomerA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerAToken}`);
  const asCustomerB = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${customerBToken}`);

  async function createUser(
    label: string,
    tenantId: string,
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER',
  ) {
    const user = await testPrisma.user.create({
      data: {
        email: `s2br2-${label}-${runId}@example.test`,
        passwordHash: 'unused-hash',
        firstName: label,
        lastName: 'Proof',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    await testPrisma.tenantMember.create({
      data: { tenantId, userId: user.id, role, status: 'ACTIVE' },
    });
    const token = await createAccessToken(user.id);
    return { id: user.id, token };
  }

  async function setupTenantCatalog(
    tenant: ReturnType<typeof catalogTenantFixture>,
    tag: string,
    customerId: string,
  ) {
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { defaultCurrency: 'KWD' },
    });
    const wh = await fixtureWarehouse(tenant.id);
    await testPrisma.warehouseCoverage.upsert({
      where: {
        warehouseId_countryCode: { warehouseId: wh.id, countryCode },
      },
      create: { tenantId: tenant.id, warehouseId: wh.id, countryCode },
      update: {},
    });
    const taxCategory = await testPrisma.taxCategory.create({
      data: {
        tenantId: tenant.id,
        code: 'EXEMPT',
        name: 'Exempt',
        treatment: 'EXEMPT',
      },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId: tenant.id,
        countryCode,
        currency: 'KWD',
        defaultTaxCategoryId: taxCategory.id,
        isTaxRegistered: false,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: 0 },
    });
    const shippingProfile = await createShippingProfileFixture({
      data: { tenantId: tenant.id, countryCode, currency: 'KWD' },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: shippingProfile.id,
        code: `s2br2-zone-${tag}-${runId}`,
        name: 'Free Zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'free', name: 'Free' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 0, rateType: 'FREE' },
    });
    const address = await testPrisma.address.create({
      data: {
        userId: customerId,
        firstName: tag,
        lastName: 'Buyer',
        addressLine1: 'Street 1',
        city: 'Kuwait City',
        countryCode,
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
    const category = await testPrisma.category.create({
      data: {
        tenantId: tenant.id,
        name: `Cat ${tag} ${runId}`,
        slug: `s2br2-cat-${tag}-${runId}`,
      },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        name: `Item ${tag}`,
        slug: `s2br2-item-${tag}-${runId}`,
        basePrice: '10.000',
        status: ProductStatus.ACTIVE,
      },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `S2BR2-${tag}-${runId}`,
        combinationKey: '',
        isDefault: true,
      },
    });
    const inv = await testPrisma.inventory.create({
      data: {
        tenantId: tenant.id,
        warehouseId: wh.id,
        variantId: variant.id,
        quantity: 200,
        reservedQuantity: 0,
      },
    });
    return {
      addressId: address.id,
      variantId: variant.id,
      inventoryId: inv.id,
      shippingMethodCode: method.code,
    };
  }

  async function createCapturedOrderForTenant(which: 'A' | 'B' = 'A') {
    const isA = which === 'A';
    const tenantId = isA ? tenantA.id : tenantB.id;
    const reqFn = isA ? asCustomerA : asCustomerB;
    const variantId = isA ? variantAId : variantBId;
    const addressId = isA ? addressAId : addressBId;
    const shippingMethodCode = isA ? shippingMethodCodeA : shippingMethodCodeB;

    await reqFn(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 1 }),
    ).expect(200);

    const checkoutRes = await reqFn(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `s2br2-chk-${randomUUID()}`)
        .send({
          shippingAddressId: addressId,
          shippingMethodCode,
          paymentMethod: PaymentMethod.CARD,
        }),
    ).expect(201);

    const orderId = checkoutRes.body.data.order.id as string;
    const paymentId = checkoutRes.body.data.payment.id as string;
    const invoiceId = `mock-inv-${paymentId}`;
    const originalTxnId = `orig-txn-${paymentId.slice(0, 8)}`;

    await paymentService.applyTrustedPaymentStatus(
      tenantId,
      paymentId,
      {
        status: PaymentStatus.PAID,
        providerPaymentId: invoiceId,
        providerTransactionId: originalTxnId,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: PaymentProvider.MYFATOORAH,
        providerPaymentId: invoiceId,
      },
    );
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { initiationState: 'INITIATED' },
    });

    return { orderId, paymentId, invoiceId, originalTxnId, tenantId };
  }

  beforeAll(async () => {
    process.env.MOCK_CHECKOUT_SECRET =
      'step-2br2-mock-refund-secret-at-least-32-chars!';
    await tenantA.create();
    await tenantB.create();

    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: `Step2BR2 Country ${runId}`,
        currencyCode: 'KWD',
        isActive: true,
      },
    });

    const ownerA = await createUser('ownerA', tenantA.id, 'OWNER');
    const customerA = await createUser('customerA', tenantA.id, 'CUSTOMER');
    const ownerB = await createUser('ownerB', tenantB.id, 'OWNER');
    const customerB = await createUser('customerB', tenantB.id, 'CUSTOMER');

    ownerAId = ownerA.id;
    ownerAToken = ownerA.token;
    customerAId = customerA.id;
    customerAToken = customerA.token;
    ownerBId = ownerB.id;
    customerBId = customerB.id;
    customerBToken = customerB.token;

    const catA = await setupTenantCatalog(tenantA, 'A', customerAId);
    addressAId = catA.addressId;
    variantAId = catA.variantId;
    inventoryAId = catA.inventoryId;
    shippingMethodCodeA = catA.shippingMethodCode;

    const catB = await setupTenantCatalog(tenantB, 'B', customerBId);
    addressBId = catB.addressId;
    variantBId = catB.variantId;
    inventoryBId = catB.inventoryId;
    shippingMethodCodeB = catB.shippingMethodCode;
  });

  beforeEach(() => {
    MockMyFatoorahProvider.resetRefundState();
    globalRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    globalRateLimiter.resetKey('127.0.0.1');
    for (const uid of [ownerAId, customerAId, ownerBId, customerBId]) {
      sensitiveRateLimiter.resetKey(`${tenantA.id}:${uid}`);
      sensitiveRateLimiter.resetKey(`${tenantB.id}:${uid}`);
    }
  });

  afterAll(async () => {
    const tenantIds = [tenantA.id, tenantB.id];
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.myFatoorahWebhookEvent.deleteMany({
      where: { payment: { order: { tenantId: { in: tenantIds } } } },
    });
    await testPrisma.myFatoorahInvoice.deleteMany({
      where: { payment: { order: { tenantId: { in: tenantIds } } } },
    });
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.notificationPushJob.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.notification.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.orderStatusHistory.deleteMany({
      where: { order: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.orderItem.deleteMany({
      where: { order: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.cartItem.deleteMany({
      where: { cart: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.cart.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId: { in: [inventoryAId, inventoryBId] } },
    });
    await testPrisma.inventory.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.address.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await testPrisma.shippingRule.deleteMany({
      where: { method: { zone: { profile: { tenantId: { in: tenantIds } } } } },
    });
    await testPrisma.shippingMethod.deleteMany({
      where: { zone: { profile: { tenantId: { in: tenantIds } } } },
    });
    await testPrisma.shippingZone.deleteMany({
      where: { profile: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.shippingProfile.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.taxProfile.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.taxCategory.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await tenantA.cleanup();
    await tenantB.cleanup();
    await testPrisma.country.deleteMany({ where: { code: countryCode } });
    await testPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it('rejects bare PAYMENT_REFUND, forged ledgerVerified, missing refundId, wrong-payment/wrong-order/cross-tenant refundId, contradictory ledger status, and ledgerless REFUND_PENDING->PAID rollback without mutating DB', async () => {
    const target = await createCapturedOrderForTenant('A');
    const otherOrderSameTenant = await createCapturedOrderForTenant('A');
    const otherTenantOrder = await createCapturedOrderForTenant('B');

    // Create legitimate refund rows on otherOrderSameTenant and otherTenantOrder
    const otherOrderRefund = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantA.id,
        paymentId: otherOrderSameTenant.paymentId,
        orderId: otherOrderSameTenant.orderId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '3.000',
        currency: 'KWD',
        status: PaymentRefundStatus.SUCCEEDED,
        idempotencyKey: `other-ord-${randomUUID()}`,
        requestFingerprint: `fp-${randomUUID()}`,
        providerRefundId: `ref-other-ord-${randomUUID()}`,
        reason: 'Other order refund',
        requestedByUserId: ownerAId,
        submittedAt: new Date(),
        completedAt: new Date(),
      },
    });
    const crossTenantRefund = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantB.id,
        paymentId: otherTenantOrder.paymentId,
        orderId: otherTenantOrder.orderId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '3.000',
        currency: 'KWD',
        status: PaymentRefundStatus.SUCCEEDED,
        idempotencyKey: `xt-ord-${randomUUID()}`,
        requestFingerprint: `fp-${randomUUID()}`,
        providerRefundId: `ref-xt-${randomUUID()}`,
        reason: 'Cross-tenant refund',
        requestedByUserId: ownerBId,
        submittedAt: new Date(),
        completedAt: new Date(),
      },
    });

    const notifsBefore = await testPrisma.notification.count({
      where: {
        tenantId: tenantA.id,
        data: { path: ['orderId'], equals: target.orderId },
      },
    });

    // 1. Bare PAYMENT_REFUND without ledger rows -> 409
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        target.paymentId,
        { status: PaymentStatus.PARTIALLY_REFUNDED, refundAmount: '3.000' },
        { kind: 'PAYMENT_REFUND' },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
    });

    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        target.paymentId,
        { status: PaymentStatus.REFUNDED },
        { kind: 'PAYMENT_REFUND' },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
    });

    // 2. Forged ledgerVerified boolean -> 409
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        target.paymentId,
        { status: PaymentStatus.REFUNDED },
        {
          kind: 'PAYMENT_REFUND',
          ledgerVerified: true,
        } as unknown as TrustedPaymentTransition,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
    });

    // 4 & 5. RefundId belonging to another payment / another order (same tenant) -> 409
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        target.paymentId,
        {
          status: PaymentStatus.PARTIALLY_REFUNDED,
          refundId: otherOrderRefund.id,
          refundAmount: '3.000',
        },
        { kind: 'PAYMENT_REFUND', refundId: otherOrderRefund.id },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
    });

    // 6. Cross-tenant refundId proof -> 409
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        target.paymentId,
        {
          status: PaymentStatus.PARTIALLY_REFUNDED,
          refundId: crossTenantRefund.id,
          refundAmount: '3.000',
        },
        { kind: 'PAYMENT_REFUND', refundId: crossTenantRefund.id },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
    });

    // Verify DB state & notifications completely untouched after all rejections
    const dbPayAfterRejects = await testPrisma.payment.findUniqueOrThrow({
      where: { id: target.paymentId },
    });
    const dbOrderAfterRejects = await testPrisma.order.findUniqueOrThrow({
      where: { id: target.orderId },
    });
    expect(dbPayAfterRejects.status).toBe(PaymentStatus.PAID);
    expect(dbOrderAfterRejects.paymentStatus).toBe(PaymentStatus.PAID);
    expect(dbPayAfterRejects.providerPaymentId).toBe(target.invoiceId);
    expect(dbPayAfterRejects.providerTransactionId).toBe(target.originalTxnId);
    expect(
      await testPrisma.notification.count({
        where: {
          tenantId: tenantA.id,
          data: { path: ['orderId'], equals: target.orderId },
        },
      }),
    ).toBe(notifsBefore);

    // 3 & 7. Even when a real refund row exists on target, missing refundId is rejected AND contradictory aggregate status is rejected
    const targetPartial = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantA.id,
        paymentId: target.paymentId,
        orderId: target.orderId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '3.000',
        currency: 'KWD',
        status: PaymentRefundStatus.SUCCEEDED,
        idempotencyKey: `target-part-${randomUUID()}`,
        requestFingerprint: `fp-${randomUUID()}`,
        providerRefundId: `ref-target-part-${randomUUID()}`,
        reason: 'Valid target partial refund row',
        requestedByUserId: ownerAId,
        submittedAt: new Date(),
        completedAt: new Date(),
      },
    });

    // Missing refundId -> 409
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        target.paymentId,
        { status: PaymentStatus.PARTIALLY_REFUNDED, refundAmount: '3.000' },
        { kind: 'PAYMENT_REFUND' },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
    });

    // Contradictory aggregate status (ledger = PARTIALLY_REFUNDED, caller asks for REFUNDED) -> 409
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        target.paymentId,
        { status: PaymentStatus.REFUNDED, refundId: targetPartial.id },
        { kind: 'PAYMENT_REFUND', refundId: targetPartial.id },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_LEDGER_MISMATCH',
    });
    expect(
      (await testPrisma.payment.findUniqueOrThrow({ where: { id: target.paymentId } })).status,
    ).toBe(PaymentStatus.PAID);

    // 9. Valid ledger-backed transition succeeds
    const validPartial = await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      target.paymentId,
      {
        status: PaymentStatus.PARTIALLY_REFUNDED,
        refundId: targetPartial.id,
        refundAmount: '3.000',
      },
      { kind: 'PAYMENT_REFUND', refundId: targetPartial.id },
      { preserveProviderTransactionId: true, skipInventorySideEffects: true },
    );
    expect(validPartial.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(validPartial.providerPaymentId).toBe(target.invoiceId);
    expect(validPartial.providerTransactionId).toBe(target.originalTxnId);

    // 8. Ledgerless REFUND_PENDING -> PAID rollback is rejected (both 0 rows and active REQUESTED row)
    const rollbackTarget = await createCapturedOrderForTenant('A');
    await testPrisma.payment.update({
      where: { id: rollbackTarget.paymentId },
      data: { status: PaymentStatus.REFUND_PENDING },
    });
    await testPrisma.order.update({
      where: { id: rollbackTarget.orderId },
      data: { paymentStatus: PaymentStatus.REFUND_PENDING },
    });
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        rollbackTarget.paymentId,
        { status: PaymentStatus.PAID },
        {
          kind: 'PAYMENT_REFUND',
          allowRollbackToPaid: true,
        },
        { allowRefundPendingRollback: true },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
    });
    expect(
      (
        await testPrisma.payment.findUniqueOrThrow({
          where: { id: rollbackTarget.paymentId },
        })
      ).status,
    ).toBe(PaymentStatus.REFUND_PENDING);

    // Active REQUESTED refund row cannot roll back REFUND_PENDING -> PAID
    const inFlightRow = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantA.id,
        paymentId: rollbackTarget.paymentId,
        orderId: rollbackTarget.orderId,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '4.000',
        currency: 'KWD',
        status: PaymentRefundStatus.REQUESTED,
        idempotencyKey: `inflight-rb-${randomUUID()}`,
        requestFingerprint: `fp-${randomUUID()}`,
        reason: 'Still in-flight',
        requestedByUserId: ownerAId,
      },
    });
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        rollbackTarget.paymentId,
        { status: PaymentStatus.PAID, refundId: inFlightRow.id },
        {
          kind: 'PAYMENT_REFUND',
          refundId: inFlightRow.id,
          allowRollbackToPaid: true,
        },
        { allowRefundPendingRollback: true },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_REFUND_LEDGER_MISMATCH',
    });
    expect(
      (
        await testPrisma.payment.findUniqueOrThrow({
          where: { id: rollbackTarget.paymentId },
        })
      ).status,
    ).toBe(PaymentStatus.REFUND_PENDING);
  });

  it('rejects direct new SUCCEEDED settlement without complete evidence and direct new FAILED settlement without explicit definitiveFailure=true while retaining capacity and preserving terminal replays', async () => {
    const orderCase = await createCapturedOrderForTenant('A');
    const reserved = await refundService.reserveRefund(
      tenantA.id,
      orderCase.paymentId,
      {
        amount: '4.000',
        idempotencyKey: `direct-ev-${orderCase.paymentId}`,
        reason: 'Direct settlement entry point validation',
        requestedByUserId: ownerAId,
      },
    );
    const refundId = reserved.refund.id;

    // 11. Direct new SUCCEEDED settlement missing each mandatory field MUST fail closed
    const incompleteSuccessPayloads = [
      // Missing amount
      {
        outcome: 'SUCCEEDED' as const,
        currency: 'KWD',
        providerRefundId: `ref-1-${refundId}`,
        originalProviderPaymentId: orderCase.invoiceId,
        refundId,
      },
      // Missing currency
      {
        outcome: 'SUCCEEDED' as const,
        amount: '4.000',
        providerRefundId: `ref-2-${refundId}`,
        originalProviderPaymentId: orderCase.invoiceId,
        refundId,
      },
      // Missing providerRefundId
      {
        outcome: 'SUCCEEDED' as const,
        amount: '4.000',
        currency: 'KWD',
        originalProviderPaymentId: orderCase.invoiceId,
        refundId,
      },
      // Missing originalProviderPaymentId
      {
        outcome: 'SUCCEEDED' as const,
        amount: '4.000',
        currency: 'KWD',
        providerRefundId: `ref-4-${refundId}`,
        refundId,
      },
      // Missing refundId
      {
        outcome: 'SUCCEEDED' as const,
        amount: '4.000',
        currency: 'KWD',
        providerRefundId: `ref-5-${refundId}`,
        originalProviderPaymentId: orderCase.invoiceId,
      },
    ];

    for (const payload of incompleteSuccessPayloads) {
      await expect(
        refundService.applyRefundOutcome(tenantA.id, refundId, payload),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'REFUND_FINANCIAL_EVIDENCE_INCOMPLETE',
      });
    }

    // 12. Direct new FAILED settlement without explicit definitiveFailure === true (undefined, null, false) MUST NOT release capacity
    for (const badDefinitive of [undefined, null, false] as const) {
      await expect(
        refundService.applyRefundOutcome(tenantA.id, refundId, {
          outcome: 'FAILED',
          ...(badDefinitive === undefined
            ? {}
            : { definitiveFailure: badDefinitive }),
          failureCode: 'UNCONFIRMED_ERROR',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'REFUND_FAILURE_NOT_DEFINITIVE',
      });
    }

    // Assert DB state & reserved capacity completely intact after all rejected direct attempts
    const stillReserved = await testPrisma.paymentRefund.findUniqueOrThrow({
      where: { id: refundId },
    });
    expect(stillReserved.status).toBe(PaymentRefundStatus.REQUESTED);
    const summaryBeforeSettle = await refundService.getRefundSummary(
      tenantA.id,
      orderCase.paymentId,
    );
    expect(summaryBeforeSettle.summary).toMatchObject({
      settledRefundedAmount: '0.000',
      reservedInFlightAmount: '4.000',
      remainingRefundableAmount: '6.000',
    });
    expect(
      await testPrisma.notification.count({
        where: {
          tenantId: tenantA.id,
          eventKey: { contains: `_refund_` },
          data: { path: ['paymentId'], equals: orderCase.paymentId },
        },
      }),
    ).toBe(0);

    // Valid direct SUCCEEDED settlement with ALL 5 mandatory evidence fields succeeds
    const settled = await refundService.applyRefundOutcome(
      tenantA.id,
      refundId,
      {
        outcome: 'SUCCEEDED',
        amount: '4.000',
        currency: 'KWD',
        providerRefundId: `direct-ok-${refundId}`,
        providerRefundReference: `direct-ref-${refundId}`,
        providerRefundInvoiceId: orderCase.invoiceId,
        originalProviderPaymentId: orderCase.invoiceId,
        refundId,
      },
    );
    expect(settled.refund.status).toBe(PaymentRefundStatus.SUCCEEDED);
    expect(settled.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);

    // 13 & 14. Compatible terminal replay is idempotent; contradictory terminal replay rejected without mutating history
    const replay = await refundService.applyRefundOutcome(
      tenantA.id,
      refundId,
      {
        outcome: 'SUCCEEDED',
        providerRefundId: `direct-ok-${refundId}`,
      },
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.refund.providerRefundReference).toBe(`direct-ref-${refundId}`);

    await expect(
      refundService.applyRefundOutcome(tenantA.id, refundId, {
        outcome: 'FAILED',
        definitiveFailure: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'REFUND_STATE_CONFLICT' });
    await expect(
      refundService.applyRefundOutcome(tenantA.id, refundId, {
        outcome: 'SUCCEEDED',
        providerRefundId: 'conflicting-id',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REFUND_PROVIDER_REFERENCE_CONFLICT',
    });

    // 10. Valid ledger-backed REFUND_PENDING -> PAID rollback after explicit definitiveFailure: true
    const rollbackOrder = await createCapturedOrderForTenant('A');
    const reservedFail = await refundService.reserveRefund(
      tenantA.id,
      rollbackOrder.paymentId,
      {
        amount: '5.000',
        idempotencyKey: `direct-rb-${rollbackOrder.paymentId}`,
        reason: 'Definitive failure rollback test',
        requestedByUserId: ownerAId,
      },
    );
    expect(reservedFail.payment.status).toBe(PaymentStatus.REFUND_PENDING);

    const rolledBack = await refundService.applyRefundOutcome(
      tenantA.id,
      reservedFail.refund.id,
      {
        outcome: 'FAILED',
        definitiveFailure: true,
        failureCode: 'PROVIDER_CONFIRMED_DECLINE',
      },
    );
    expect(rolledBack.refund.status).toBe(PaymentRefundStatus.FAILED);
    expect(rolledBack.payment.status).toBe(PaymentStatus.PAID);
    expect(rolledBack.summary.remainingRefundableAmount).toBe('10.000');

    // 15, 19. Original payment identity preserved; 1 SALE and 1 PAYMENT_PAID only
    const dbRollbackPay = await testPrisma.payment.findUniqueOrThrow({
      where: { id: rollbackOrder.paymentId },
    });
    expect(dbRollbackPay.providerPaymentId).toBe(rollbackOrder.invoiceId);
    expect(dbRollbackPay.providerTransactionId).toBe(
      rollbackOrder.originalTxnId,
    );
    expect(
      await testPrisma.inventoryTransaction.count({
        where: {
          inventoryId: inventoryAId,
          referenceId: rollbackOrder.orderId,
          type: 'SALE',
        },
      }),
    ).toBe(1);
    expect(
      await testPrisma.notification.count({
        where: {
          tenantId: tenantA.id,
          eventKey: `payment_paid_${rollbackOrder.paymentId}`,
        },
      }),
    ).toBe(1);
  });

  it('preserves valid initial capture, late PAID verification after refunds, and existing COD behavior', async () => {
    // 16 & 17. Initial capture + partial refund + valid late PAID verification
    const card = await createCapturedOrderForTenant('A');
    await asOwnerA(
      request(app)
        .post(`/api/v1/payments/${card.paymentId}/refund`)
        .send({
          amount: '2.000',
          idempotencyKey: `s2br2-late-${card.paymentId}`,
          reason: 'Partial refund before late verify',
        }),
    ).expect(200);

    const stubAdapter: PaymentProviderAdapter = {
      provider: PaymentProvider.MYFATOORAH,
      supportsIdempotentInitiation: true,
      supportsRefunds: true,
      getPaymentStatus: async () => ({
        invoiceId: card.invoiceId,
        customerReference: card.paymentId,
        orderReference: card.orderId,
        amount: '10.000',
        currency: 'KWD',
        status: PaymentStatus.PAID,
        transactionId: card.originalTxnId,
        transactionPaymentId: '991122',
        transactionPaymentIds: ['991122'],
      }),
      createPayment: async () => ({ status: PaymentStatus.REQUIRES_ACTION }),
      cancelPayment: async () => ({ status: PaymentStatus.CANCELLED }),
      refundPayment: async () => ({ status: PaymentStatus.REFUNDED }),
    };
    const verifier = new PaymentVerificationService(
      new PaymentRepository(),
      paymentService,
      {
        getProvider: () => stubAdapter,
        resolveProviderForMethod: () => PaymentProvider.MYFATOORAH,
      } as unknown as PaymentProviderRegistry,
    );

    const observed = await verifier.verifyForUser(
      tenantA.id,
      customerAId,
      card.paymentId,
    );
    expect(observed.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(observed.reconciliationRequired).toBe(false);

    // 18. Existing COD fulfillment & confirmation unchanged, COD refund blocked
    await asCustomerA(
      request(app)
        .post('/api/v1/cart/items')
        .send({ variantId: variantAId, quantity: 1 }),
    ).expect(200);
    const codCheckout = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `s2br2-cod-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode: shippingMethodCodeA,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        }),
    ).expect(201);
    const codOrderId = codCheckout.body.data.order.id as string;
    const codPaymentId = codCheckout.body.data.payment.id as string;
    for (const st of [
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ]) {
      await asOwnerA(
        request(app)
          .patch(`/api/v1/orders/${codOrderId}/status`)
          .send({ status: st }),
      ).expect(200);
    }
    await asOwnerA(
      request(app)
        .post(`/api/v1/orders/${codOrderId}/cod/confirm-payment`)
        .send({
          referenceId: `s2br2-cod-ref-${codOrderId}`,
          collectedAmount: '10.000',
          currency: 'KWD',
        }),
    ).expect(200);
    const codRefund = await asOwnerA(
      request(app)
        .post(`/api/v1/payments/${codPaymentId}/refund`)
        .send({
          amount: '10.000',
          idempotencyKey: `s2br2-cod-block-${codPaymentId}`,
          reason: 'COD refunds remain blocked',
        }),
    );
    expect(codRefund.status).toBe(409);
    expect(codRefund.body.code).toBe('COD_REFUND_WORKFLOW_REQUIRED');
  });
});
