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
      MOCK_CHECKOUT_SECRET: 'step-2b-mock-refund-secret-at-least-32-chars!!',
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
import { OrderService } from '../../src/modules/orders/order.service.js';
import { PaymentRefundService } from '../../src/modules/payments/payment-refund.service.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { MockMyFatoorahProvider } from '../../src/modules/payments/providers/mock-myfatoorah.provider.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

describe('Phase 2D.12 Step 2B — Refund Domain, Cumulative Accounting & Financial Safety', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = randomUUID().slice(0, 8);
  const countryCode = `R${tenantA.id.slice(-7)}`.toUpperCase();

  let ownerAId: string;
  let ownerAToken: string;
  let adminAId: string;
  let adminAToken: string;
  let managerAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let ownerBId: string;
  let ownerBToken: string;

  let addressAId: string;
  let variantId: string;
  let inventoryId: string;
  let shippingMethodCode: string;

  const createdUserIds: string[] = [];

  const orderService = new OrderService();
  const paymentService = new PaymentService();
  const mockRegistry = new PaymentProviderRegistry({
    PAYMENT_PROVIDER: 'MOCK',
    MOCK_CHECKOUT_SECRET: 'step-2b-mock-refund-secret-at-least-32-chars!!',
    MOCK_CHECKOUT_BASE_URL: 'http://localhost:3000',
  });
  const refundService = new PaymentRefundService(
    undefined,
    paymentService,
    mockRegistry,
  );
  const myFatoorahRegistry = new PaymentProviderRegistry({
    PAYMENT_PROVIDER: 'MYFATOORAH',
    MYFATOORAH_ENV: 'sandbox',
    MYFATOORAH_API_VERSION: 'v2',
    MYFATOORAH_ACCOUNT_COUNTRY: 'KWT',
    MYFATOORAH_ACCOUNT_CURRENCY: 'KWD',
    MYFATOORAH_API_TOKEN: 'non-live-disabled-refund-token',
    MYFATOORAH_WEBHOOK_SECRET: 'non-live-webhook-secret',
    MYFATOORAH_CALLBACK_URL: 'https://demo.myfatoorah.com',
    MYFATOORAH_ERROR_URL: 'https://demo.myfatoorah.com',
    MYFATOORAH_TIMEOUT_MS: 1000,
  });
  const myFatoorahRefundService = new PaymentRefundService(
    undefined,
    paymentService,
    myFatoorahRegistry,
  );

  const asOwnerA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${ownerAToken}`);
  const asAdminA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${adminAToken}`);
  const asManagerA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${managerAToken}`);
  const asCustomerA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerAToken}`);
  const asOwnerB = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${ownerBToken}`);

  async function createUser(
    label: string,
    tenantId: string,
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER',
  ) {
    const user = await testPrisma.user.create({
      data: {
        email: `step2b-${label}-${runId}@example.test`,
        passwordHash: 'unused-hash',
        firstName: label,
        lastName: 'Refund',
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

  async function createCapturedCardOrder(quantity = 1) {
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity }),
    ).expect(200);

    const checkoutRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `step2b-chk-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod: PaymentMethod.CARD,
        }),
    ).expect(201);

    const order = checkoutRes.body.data.order as {
      id: string;
      totalAmount: string;
      currency: string;
      status: OrderStatus;
      paymentStatus: PaymentStatus;
    };
    const payment = checkoutRes.body.data.payment as {
      id: string;
      amount: string;
      currency: string;
    };

    const invoiceId = `mock-inv-${payment.id}`;
    const originalTxnId = `orig-txn-${payment.id.slice(0, 8)}`;

    await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      payment.id,
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

    return {
      orderId: order.id,
      paymentId: payment.id,
      invoiceId,
      originalTxnId,
      totalAmount: order.totalAmount,
    };
  }

  async function createUncapturedCardOrder(
    targetStatus: 'PENDING' | 'AUTHORIZED' = 'PENDING',
  ) {
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 1 }),
    ).expect(200);

    const checkoutRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `step2b-uncap-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod: PaymentMethod.CARD,
        }),
    ).expect(201);

    const paymentId = checkoutRes.body.data.payment.id as string;
    const orderId = checkoutRes.body.data.order.id as string;
    const invoiceId = `mock-inv-${paymentId}`;

    if (targetStatus === 'AUTHORIZED') {
      await paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        paymentId,
        { status: PaymentStatus.AUTHORIZED, providerPaymentId: invoiceId },
        {
          kind: 'PROVIDER_VERIFICATION',
          provider: PaymentProvider.MYFATOORAH,
          providerPaymentId: invoiceId,
        },
      );
    }

    return { orderId, paymentId, invoiceId };
  }

  async function createPaidCodOrder() {
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 1 }),
    ).expect(200);

    const checkoutRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `step2b-cod-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        }),
    ).expect(201);

    const orderId = checkoutRes.body.data.order.id as string;
    const paymentId = checkoutRes.body.data.payment.id as string;
    const totalAmount = checkoutRes.body.data.order.totalAmount as string;

    for (const step of ['PROCESSING', 'SHIPPED', 'DELIVERED'] as const) {
      await asOwnerA(
        request(app)
          .patch(`/api/v1/orders/${orderId}/status`)
          .send({ status: step }),
      ).expect(200);
    }
    await asOwnerA(
      request(app)
        .post(`/api/v1/orders/${orderId}/cod/confirm-payment`)
        .send({
          referenceId: `cod-pay-${orderId}`,
          collectedAmount: totalAmount,
          currency: 'KWD',
        }),
    ).expect(200);

    return { orderId, paymentId, totalAmount };
  }

  beforeAll(async () => {
    process.env.MOCK_CHECKOUT_SECRET =
      'step-2b-mock-refund-secret-at-least-32-chars!!';
    await tenantA.create();
    await tenantB.create();

    await testPrisma.tenant.update({
      where: { id: tenantA.id },
      data: { defaultCurrency: 'KWD' },
    });

    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: `Step2B Country ${runId}`,
        currencyCode: 'KWD',
        isActive: true,
      },
    });

    const whA = await fixtureWarehouse(tenantA.id);
    await testPrisma.warehouseCoverage.upsert({
      where: {
        warehouseId_countryCode: { warehouseId: whA.id, countryCode },
      },
      create: { tenantId: tenantA.id, warehouseId: whA.id, countryCode },
      update: {},
    });

    const taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId: tenantA.id, code: 'EXEMPT', name: 'Exempt', treatment: 'EXEMPT' },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId: tenantA.id,
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
      data: { tenantId: tenantA.id, countryCode, currency: 'KWD' },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: shippingProfile.id,
        code: `s2b-zone-${runId}`,
        name: 'KWD Free Zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'free', name: 'Free Delivery' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 0, rateType: 'FREE' },
    });
    shippingMethodCode = method.code;

    const ownerA = await createUser('ownerA', tenantA.id, 'OWNER');
    const adminA = await createUser('adminA', tenantA.id, 'ADMIN');
    const managerA = await createUser('managerA', tenantA.id, 'MANAGER');
    const customerA = await createUser('customerA', tenantA.id, 'CUSTOMER');
    const ownerB = await createUser('ownerB', tenantB.id, 'OWNER');

    ownerAId = ownerA.id;
    ownerAToken = ownerA.token;
    adminAId = adminA.id;
    adminAToken = adminA.token;
    managerAToken = managerA.token;
    customerAId = customerA.id;
    customerAToken = customerA.token;
    ownerBId = ownerB.id;
    ownerBToken = ownerB.token;

    const address = await testPrisma.address.create({
      data: {
        userId: customerAId,
        firstName: 'KWD',
        lastName: 'Buyer',
        addressLine1: 'Block 2 Street 4',
        city: 'Kuwait City',
        countryCode,
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
    addressAId = address.id;

    const category = await testPrisma.category.create({
      data: {
        tenantId: tenantA.id,
        name: `Step2B Cat ${runId}`,
        slug: `s2b-cat-${runId}`,
      },
    });

    // Exact 10.000 KWD unit price with 0 tax and 0 shipping for clean accounting tests
    const product = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        categoryId: category.id,
        name: 'Exact 10 KWD Item',
        slug: `s2b-item-${runId}`,
        basePrice: '10.000',
        status: ProductStatus.ACTIVE,
      },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `S2B-SKU-${runId}`,
        combinationKey: '',
        isDefault: true,
      },
    });
    variantId = variant.id;

    const inv = await testPrisma.inventory.create({
      data: {
        tenantId: tenantA.id,
        warehouseId: whA.id,
        variantId,
        quantity: 200,
        reservedQuantity: 0,
      },
    });
    inventoryId = inv.id;
  });

  beforeEach(() => {
    MockMyFatoorahProvider.resetRefundState();
    globalRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    globalRateLimiter.resetKey('127.0.0.1');
    for (const uid of [ownerAId, adminAId, customerAId, ownerBId]) {
      sensitiveRateLimiter.resetKey(`${tenantA.id}:${uid}`);
      sensitiveRateLimiter.resetKey(`${tenantB.id}:${uid}`);
    }
  });

  afterAll(async () => {
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.notificationPushJob.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.notification.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.orderStatusHistory.deleteMany({
      where: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.orderItem.deleteMany({
      where: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.cartItem.deleteMany({
      where: { cart: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.cart.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.inventory.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.address.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await testPrisma.shippingRule.deleteMany({
      where: { method: { zone: { profile: { tenantId: tenantA.id } } } },
    });
    await testPrisma.shippingMethod.deleteMany({
      where: { zone: { profile: { tenantId: tenantA.id } } },
    });
    await testPrisma.shippingZone.deleteMany({
      where: { profile: { tenantId: tenantA.id } },
    });
    await testPrisma.shippingProfile.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await testPrisma.taxProfile.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: tenantA.id } },
    });
    await testPrisma.taxCategory.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await tenantA.cleanup();
    await tenantB.cleanup();
    await testPrisma.country.deleteMany({ where: { code: countryCode } });
    await testPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  // =========================================================================
  // 1. FINANCIAL ACCOUNTING
  // =========================================================================
  describe('Financial Accounting', () => {
    it('processes a full 10.000 KWD refund with exact decimal accounting and preserves original payment identity', async () => {
      const { orderId, paymentId, invoiceId, originalTxnId } =
        await createCapturedCardOrder();

      const res = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .set('Idempotency-Key', `full-${paymentId}`)
          .send({ amount: '10.000', reason: 'Customer full cancellation' }),
      ).expect(200);

      expect(res.body.data.idempotentReplay).toBe(false);
      expect(res.body.data.refund).toMatchObject({
        status: PaymentRefundStatus.SUCCEEDED,
        amount: '10.000',
        currency: 'KWD',
        requestedByUserId: ownerAId,
      });
      expect(res.body.data.summary).toEqual({
        capturedAmount: '10.000',
        settledRefundedAmount: '10.000',
        reservedInFlightAmount: '0.000',
        remainingRefundableAmount: '0.000',
        currency: 'KWD',
      });
      expect(res.body.data.payment.status).toBe(PaymentStatus.REFUNDED);

      const dbPayment = await testPrisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      const dbOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(dbPayment.status).toBe(PaymentStatus.REFUNDED);
      expect(dbOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);
      // Original captured payment identifiers MUST NEVER be overwritten
      expect(dbPayment.providerPaymentId).toBe(invoiceId);
      expect(dbPayment.providerTransactionId).toBe(originalTxnId);
      expect(dbPayment.amount.toFixed(3)).toBe('10.000');
    });

    it('processes sequential partial refunds 3.000 + 2.000 + 5.000 KWD with exact remaining capacity after each step', async () => {
      const { paymentId, orderId, invoiceId } = await createCapturedCardOrder();

      const r1 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `seq-1-${paymentId}`,
            reason: 'Partial refund #1',
          }),
      ).expect(200);
      expect(r1.body.data.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(r1.body.data.summary).toMatchObject({
        settledRefundedAmount: '3.000',
        reservedInFlightAmount: '0.000',
        remainingRefundableAmount: '7.000',
      });

      const r2 = await asAdminA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: `seq-2-${paymentId}`,
            reason: 'Partial refund #2',
          }),
      ).expect(200);
      expect(r2.body.data.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(r2.body.data.summary).toMatchObject({
        settledRefundedAmount: '5.000',
        reservedInFlightAmount: '0.000',
        remainingRefundableAmount: '5.000',
      });

      const r3 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '5.000',
            idempotencyKey: `seq-3-${paymentId}`,
            reason: 'Final remaining refund #3',
          }),
      ).expect(200);
      expect(r3.body.data.payment.status).toBe(PaymentStatus.REFUNDED);
      expect(r3.body.data.summary).toMatchObject({
        settledRefundedAmount: '10.000',
        reservedInFlightAmount: '0.000',
        remainingRefundableAmount: '0.000',
      });

      const dbOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(dbOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(3);

      // 3 distinct refund notifications (2 PARTIALLY_REFUNDED + 1 REFUNDED)
      const refundNotifs = await testPrisma.notification.findMany({
        where: {
          tenantId: tenantA.id,
          eventKey: { contains: `_refund_` },
          data: { path: ['paymentId'], equals: paymentId },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(refundNotifs).toHaveLength(3);
      expect(
        refundNotifs.map((n) => (n.data as Record<string, unknown>).amount),
      ).toEqual(['3.000', '2.000', '5.000']);
    });

    it('rejects overflow (8.000 settled + 3.000 requested) and pending-capacity overflow without provider dispatch', async () => {
      const { paymentId, invoiceId } = await createCapturedCardOrder();

      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '8.000',
            idempotencyKey: `ovf-1-${paymentId}`,
            reason: 'Initial 8 KWD refund',
          }),
      ).expect(200);

      const callsAfterFirst = MockMyFatoorahProvider.getRefundCallCount(invoiceId);
      expect(callsAfterFirst).toBe(1);

      // Overflow against settled balance
      const overflow = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `ovf-2-${paymentId}`,
            reason: 'Overflowing 3 KWD refund',
          }),
      );
      expect(overflow.status).toBe(409);
      expect(overflow.body.code).toBe('REFUND_AMOUNT_EXCEEDS_REMAINING');
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(1);

      // Pending refund reserves 1.500 KWD -> remaining = 0.500 KWD
      MockMyFatoorahProvider.enqueueRefundBehavior(invoiceId, {
        outcome: 'PENDING',
        amount: '1.500',
        currency: 'KWD',
        providerRefundId: `pend-ref-${paymentId}`,
      });
      const pendingRes = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.500',
            idempotencyKey: `ovf-3-${paymentId}`,
            reason: 'Pending 1.5 KWD refund',
          }),
      ).expect(200);
      expect(pendingRes.body.data.payment.status).toBe(
        PaymentStatus.PARTIALLY_REFUNDED,
      );
      expect(pendingRes.body.data.summary).toMatchObject({
        settledRefundedAmount: '8.000',
        reservedInFlightAmount: '1.500',
        remainingRefundableAmount: '0.500',
      });

      // Requesting 1.000 KWD when only 0.500 remains after pending reservation MUST fail
      const pendingOverflow = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: `ovf-4-${paymentId}`,
            reason: 'Exceeds remaining after pending reservation',
          }),
      );
      expect(pendingOverflow.status).toBe(409);
      expect(pendingOverflow.body.code).toBe('REFUND_AMOUNT_EXCEEDS_REMAINING');
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(2);
    });

    it('rejects zero, negative, invalid KWD precision, and uncaptured (PENDING / AUTHORIZED) payments', async () => {
      const { paymentId, invoiceId } = await createCapturedCardOrder();

      for (const badAmount of ['0', '0.000', '-1.000', '0.0001', '1.2345']) {
        const res = await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${paymentId}/refund`)
            .send({
              amount: badAmount,
              idempotencyKey: `bad-amt-${badAmount}-${paymentId}`,
              reason: 'Invalid amount validation test',
            }),
        );
        expect(res.status, `amount=${badAmount}`).toBe(400);
      }

      // Valid KWD 0.001 fils succeeds
      const tiny = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '0.001',
            idempotencyKey: `fils-${paymentId}`,
            reason: 'Valid one-fils KWD refund',
          }),
      ).expect(200);
      expect(tiny.body.data.summary.settledRefundedAmount).toBe('0.001');
      expect(tiny.body.data.summary.remainingRefundableAmount).toBe('9.999');
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(1);

      // Uncaptured PENDING & AUTHORIZED payments cannot be refunded
      const pendingCard = await createUncapturedCardOrder('PENDING');
      const authCard = await createUncapturedCardOrder('AUTHORIZED');
      for (const target of [pendingCard, authCard]) {
        const res = await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${target.paymentId}/refund`)
            .send({
              amount: '1.000',
              idempotencyKey: `uncap-${target.paymentId}`,
              reason: 'Uncaptured payment refund attempt',
            }),
        );
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PAYMENT_NOT_REFUNDABLE');
      }
    });
  });

  // =========================================================================
  // 2. REAL POSTGRESQL CONCURRENCY & IDEMPOTENCY
  // =========================================================================
  describe('Concurrency and Idempotency', () => {
    it('serializes concurrent refund requests exceeding capacity so at most one succeeds and total never exceeds captured', async () => {
      const { paymentId, invoiceId } = await createCapturedCardOrder();

      const results = await Promise.all([
        asOwnerA(
          request(app)
            .post(`/api/v1/payments/${paymentId}/refund`)
            .send({
              amount: '6.000',
              idempotencyKey: `conc-cap-1-${paymentId}`,
              reason: 'Concurrent refund A',
            }),
        ),
        asOwnerA(
          request(app)
            .post(`/api/v1/payments/${paymentId}/refund`)
            .send({
              amount: '6.000',
              idempotencyKey: `conc-cap-2-${paymentId}`,
              reason: 'Concurrent refund B',
            }),
        ),
        asAdminA(
          request(app)
            .post(`/api/v1/payments/${paymentId}/refund`)
            .send({
              amount: '6.000',
              idempotencyKey: `conc-cap-3-${paymentId}`,
              reason: 'Concurrent refund C',
            }),
        ),
      ]);

      const succeeded = results.filter((r) => r.status === 200);
      const rejected = results.filter((r) => r.status === 409);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      for (const rej of rejected) {
        expect(rej.body.code).toBe('REFUND_AMOUNT_EXCEEDS_REMAINING');
      }

      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(1);
      const rows = await testPrisma.paymentRefund.findMany({
        where: { tenantId: tenantA.id, paymentId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount.toFixed(3)).toBe('6.000');
    });

    it('handles concurrent identical idempotency keys with exactly one row and exactly one provider dispatch', async () => {
      const { paymentId, invoiceId } = await createCapturedCardOrder();
      const sharedKey = `conc-idem-${paymentId}`;

      const [resA, resB, resC] = await Promise.all([
        asOwnerA(
          request(app)
            .post(`/api/v1/payments/${paymentId}/refund`)
            .set('Idempotency-Key', sharedKey)
            .send({ amount: '4.000', reason: 'Concurrent identical refund' }),
        ),
        asOwnerA(
          request(app)
            .post(`/api/v1/payments/${paymentId}/refund`)
            .set('Idempotency-Key', sharedKey)
            .send({ amount: '4.000', reason: 'Concurrent identical refund' }),
        ),
        asAdminA(
          request(app)
            .post(`/api/v1/payments/${paymentId}/refund`)
            .set('Idempotency-Key', sharedKey)
            .send({ amount: '4.000', reason: 'Concurrent identical refund' }),
        ),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resC.status).toBe(200);

      const refundIds = new Set([
        resA.body.data.refund.id,
        resB.body.data.refund.id,
        resC.body.data.refund.id,
      ]);
      expect(refundIds.size).toBe(1);
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(1);

      const rows = await testPrisma.paymentRefund.findMany({
        where: { tenantId: tenantA.id, paymentId },
      });
      expect(rows).toHaveLength(1);
    });

    it('replays identically after SUCCEEDED, FAILED, and RECONCILIATION_REQUIRED without re-dispatching and rejects key reuse with mismatched params', async () => {
      const { paymentId, invoiceId } = await createCapturedCardOrder();

      // 1) SUCCEEDED replay
      const okKey = `replay-ok-${paymentId}`;
      const ok1 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({ amount: '2.000', idempotencyKey: okKey, reason: 'Replay OK' }),
      ).expect(200);
      const ok2 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({ amount: '2.000', idempotencyKey: okKey, reason: 'Replay OK' }),
      ).expect(200);
      expect(ok2.body.data.idempotentReplay).toBe(true);
      expect(ok2.body.data.refund.id).toBe(ok1.body.data.refund.id);
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(1);

      // Key reuse with different amount or reason -> 409 IDEMPOTENCY_KEY_REUSED
      const badAmtReuse = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({ amount: '3.000', idempotencyKey: okKey, reason: 'Replay OK' }),
      );
      expect(badAmtReuse.status).toBe(409);
      expect(badAmtReuse.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

      const badReasonReuse = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: okKey,
            reason: 'Different reason',
          }),
      );
      expect(badReasonReuse.status).toBe(409);
      expect(badReasonReuse.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

      // 2) FAILED replay
      const failKey = `replay-fail-${paymentId}`;
      MockMyFatoorahProvider.enqueueRefundBehavior(invoiceId, {
        outcome: 'FAILED',
        definitiveFailure: true,
        amount: '1.000',
        currency: 'KWD',
        failureCode: 'PROVIDER_DECLINED',
        failureMessage: 'Rejected by gateway',
      });
      const f1 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: failKey,
            reason: 'Replay FAIL',
          }),
      ).expect(200);
      expect(f1.body.data.refund.status).toBe(PaymentRefundStatus.FAILED);
      const f2 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: failKey,
            reason: 'Replay FAIL',
          }),
      ).expect(200);
      expect(f2.body.data.idempotentReplay).toBe(true);
      expect(f2.body.data.refund.status).toBe(PaymentRefundStatus.FAILED);
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(2);

      // 3) UNKNOWN/TIMEOUT -> RECONCILIATION_REQUIRED replay
      const unkKey = `replay-unk-${paymentId}`;
      const timeoutErr = new Error('Gateway timed out');
      timeoutErr.name = 'TimeoutError';
      MockMyFatoorahProvider.enqueueRefundBehavior(invoiceId, {
        throwError: timeoutErr,
      });
      const u1 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: unkKey,
            reason: 'Replay UNKNOWN',
          }),
      );
      expect(u1.status).toBe(503);
      expect(u1.body.code).toBe('REFUND_OUTCOME_UNKNOWN');

      const u2 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: unkKey,
            reason: 'Replay UNKNOWN',
          }),
      ).expect(200);
      expect(u2.body.data.idempotentReplay).toBe(true);
      expect(u2.body.data.refund.status).toBe(
        PaymentRefundStatus.RECONCILIATION_REQUIRED,
      );
      expect(u2.body.data.summary.reservedInFlightAmount).toBe('3.000');
      expect(u2.body.data.summary.remainingRefundableAmount).toBe('5.000');
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(3);
    });
  });

  // =========================================================================
  // 3. FAILURE, CRASH & RECOVERY SAFETY
  // =========================================================================
  describe('Failure and Recovery Safety', () => {
    it('rolls back REFUND_PENDING -> PAID on first definitive failure without duplicate SALE or PAYMENT_PAID notification', async () => {
      const { orderId, paymentId, invoiceId } = await createCapturedCardOrder();

      const paidNotifBefore = await testPrisma.notification.count({
        where: {
          tenantId: tenantA.id,
          eventKey: `payment_paid_${paymentId}`,
        },
      });
      const saleCountBefore = await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: orderId },
      });
      expect(paidNotifBefore).toBe(1);
      expect(saleCountBefore).toBe(1);

      MockMyFatoorahProvider.enqueueRefundBehavior(invoiceId, {
        outcome: 'FAILED',
        definitiveFailure: true,
        amount: '10.000',
        currency: 'KWD',
        failureCode: 'INSUFFICIENT_MERCHANT_BALANCE',
        failureMessage: 'Definitive rejection',
      });

      const res = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '10.000',
            idempotencyKey: `fail-rollback-${paymentId}`,
            reason: 'First refund fails',
          }),
      ).expect(200);

      expect(res.body.data.refund.status).toBe(PaymentRefundStatus.FAILED);
      expect(res.body.data.payment.status).toBe(PaymentStatus.PAID);
      expect(res.body.data.summary).toMatchObject({
        settledRefundedAmount: '0.000',
        reservedInFlightAmount: '0.000',
        remainingRefundableAmount: '10.000',
      });

      // Zero duplicate PAID notifications, zero refund notifications, zero duplicate SALE
      expect(
        await testPrisma.notification.count({
          where: { tenantId: tenantA.id, eventKey: `payment_paid_${paymentId}` },
        }),
      ).toBe(1);
      expect(
        await testPrisma.notification.count({
          where: {
            tenantId: tenantA.id,
            eventKey: { contains: `_refund_` },
            data: { path: ['paymentId'], equals: paymentId },
          },
        }),
      ).toBe(0);
      expect(
        await testPrisma.inventoryTransaction.count({
          where: { inventoryId, type: 'SALE', referenceId: orderId },
        }),
      ).toBe(1);
    });

    it('preserves PARTIALLY_REFUNDED when a second refund fails, retains capacity on malformed response, prevents duplicate dispatch on simulated crash, and guards terminal history', async () => {
      const { paymentId, invoiceId } = await createCapturedCardOrder();

      // 1) First partial refund succeeds (4.000 KWD)
      const ok = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '4.000',
            idempotencyKey: `part-ok-${paymentId}`,
            reason: 'First settled partial refund',
          }),
      ).expect(200);
      const firstRefundId = ok.body.data.refund.id as string;

      // Duplicate success on settled refund is idempotent no-op with 0 extra notifications
      const dupSuccess = await refundService.applyRefundOutcome(
        tenantA.id,
        firstRefundId,
        { outcome: 'SUCCEEDED', providerRefundId: ok.body.data.refund.providerRefundId },
      );
      expect(dupSuccess.idempotentReplay).toBe(true);
      expect(dupSuccess.summary.settledRefundedAmount).toBe('4.000');

      // Contradictory terminal event (SUCCEEDED -> FAILED) MUST be rejected without overwriting
      await expect(
        refundService.applyRefundOutcome(tenantA.id, firstRefundId, {
          outcome: 'FAILED',
          failureCode: 'LATE_CONFLICT',
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'REFUND_STATE_CONFLICT' });

      // 2) Second refund definitively fails -> stays PARTIALLY_REFUNDED, releases capacity
      MockMyFatoorahProvider.enqueueRefundBehavior(invoiceId, {
        outcome: 'FAILED',
        definitiveFailure: true,
        amount: '2.000',
        currency: 'KWD',
        failureCode: 'GATEWAY_REJECTED',
      });
      const failed2 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: `part-fail-${paymentId}`,
            reason: 'Second refund fails',
          }),
      ).expect(200);
      expect(failed2.body.data.payment.status).toBe(
        PaymentStatus.PARTIALLY_REFUNDED,
      );
      expect(failed2.body.data.summary.remainingRefundableAmount).toBe('6.000');

      // 3) Malformed provider response retains reserved capacity (RECONCILIATION_REQUIRED)
      MockMyFatoorahProvider.enqueueRefundBehavior(invoiceId, {
        outcome: 'SUCCEEDED',
        amount: '9.999', // Mismatched amount!
        currency: 'KWD',
      });
      const malformedRes = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `malformed-${paymentId}`,
            reason: 'Malformed provider response test',
          }),
      );
      expect(malformedRes.status).toBe(502);
      expect(malformedRes.body.code).toBe('REFUND_RECONCILIATION_REQUIRED');

      const summaryAfterMalformed = await refundService.getRefundSummary(
        tenantA.id,
        paymentId,
      );
      expect(summaryAfterMalformed.summary).toMatchObject({
        settledRefundedAmount: '4.000',
        reservedInFlightAmount: '3.000',
        remainingRefundableAmount: '3.000',
      });

      // 4) Simulated crash after reservation: REQUESTED row stays reserved; another caller cannot dispatch it
      const reserved = await refundService.reserveRefund(
        tenantA.id,
        paymentId,
        {
          amount: '2.000',
          idempotencyKey: `crash-sim-${paymentId}`,
          reason: 'Crash right after reservation',
          requestedByUserId: ownerAId,
        },
      );
      expect(reserved.claimedForDispatch).toBe(true);
      expect(reserved.refund.status).toBe(PaymentRefundStatus.REQUESTED);

      // Replay by another caller with same key gets claimedForDispatch=false and does NOT dispatch
      const callsBeforeReplay =
        MockMyFatoorahProvider.getRefundCallCount(invoiceId);
      const crashReplay = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: `crash-sim-${paymentId}`,
            reason: 'Crash right after reservation',
          }),
      ).expect(200);
      expect(crashReplay.body.data.idempotentReplay).toBe(true);
      expect(crashReplay.body.data.refund.status).toBe(
        PaymentRefundStatus.REQUESTED,
      );
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(
        callsBeforeReplay,
      );

      // Attempting to dispatch without valid claim fails closed
      await expect(
        refundService.dispatchReservedRefund(tenantA.id, {
          ...reserved,
          dispatchClaim: { refundId: reserved.refund.id, token: 'forged-token' },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'REFUND_DISPATCH_NOT_OWNED',
      });
    });
  });

  // =========================================================================
  // 4. AUTHORIZATION & BYPASS PREVENTION
  // =========================================================================
  describe('Authorization and H-04A/B Protection', () => {
    it('blocks cross-tenant, MANAGER, CUSTOMER, actor spoofing, unauthorized replay, and generic PATCH REFUND_PENDING->PAID bypass', async () => {
      const { paymentId, invoiceId } = await createCapturedCardOrder();

      // Cross-tenant OWNER B -> 404 before any dispatch
      const crossTenant = await asOwnerB(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: `auth-xt-${paymentId}`,
            reason: 'Cross-tenant attempt',
          }),
      );
      expect(crossTenant.status).toBe(404);

      // Same-tenant MANAGER -> 403
      const mgr = await asManagerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: `auth-mgr-${paymentId}`,
            reason: 'Manager attempt',
          }),
      );
      expect(mgr.status).toBe(403);

      // Same-tenant CUSTOMER -> 403
      const cust = await asCustomerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: `auth-cust-${paymentId}`,
            reason: 'Customer attempt',
          }),
      );
      expect(cust.status).toBe(403);

      // Actor identity spoofing via request body -> rejected by strict schema (400)
      const spoof = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: `auth-spoof-${paymentId}`,
            reason: 'Spoof actor attempt',
            requestedByUserId: ownerBId,
          }),
      );
      expect(spoof.status).toBe(400);
      expect(MockMyFatoorahProvider.getRefundCallCount(invoiceId)).toBe(0);

      // Valid pending refund moves payment to REFUND_PENDING
      const validKey = `auth-valid-${paymentId}`;
      MockMyFatoorahProvider.enqueueRefundBehavior(invoiceId, {
        outcome: 'PENDING',
        amount: '2.000',
        currency: 'KWD',
        providerRefundId: `auth-pend-${paymentId}`,
      });
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: validKey,
            reason: 'Authorized pending refund',
          }),
      ).expect(200);

      // Unauthorized replay with same valid key MUST be denied BEFORE returning refund
      const unauthReplayMgr = await asManagerA(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: validKey,
            reason: 'Authorized pending refund',
          }),
      );
      expect(unauthReplayMgr.status).toBe(403);

      const unauthReplayXT = await asOwnerB(
        request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: validKey,
            reason: 'Authorized pending refund',
          }),
      );
      expect(unauthReplayXT.status).toBe(404);

      // Generic PATCH cannot restore PAID from REFUND_PENDING or forge REFUNDED
      for (const forbiddenStatus of ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const) {
        const patchRes = await asOwnerA(
          request(app)
            .patch(`/api/v1/payments/${paymentId}/status`)
            .send({ status: forbiddenStatus }),
        );
        expect(patchRes.status, `PATCH -> ${forbiddenStatus}`).toBe(409);
      }
    });
  });

  // =========================================================================
  // 5. ORDER FULFILLMENT, INVENTORY & UNSUPPORTED PROVIDERS
  // =========================================================================
  describe('Order Fulfillment, Inventory Safety & Unsupported Providers', () => {
    it('keeps inventory untouched on refunds, permits fulfillment on settled partial refund, and blocks fulfillment on pending/settled full refund', async () => {
      // A) Settled partial refund permits fulfillment progression without inventory restock
      const partialOrder = await createCapturedCardOrder();
      const invBefore = await testPrisma.inventory.findUniqueOrThrow({
        where: { id: inventoryId },
      });

      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${partialOrder.paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `fulf-part-${partialOrder.paymentId}`,
            reason: 'Goodwill partial credit before shipping',
          }),
      ).expect(200);

      // Inventory unchanged (zero STOCK_IN, zero RELEASE, still 1 SALE)
      const invAfter = await testPrisma.inventory.findUniqueOrThrow({
        where: { id: inventoryId },
      });
      expect(invAfter.quantity).toBe(invBefore.quantity);
      expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity);
      expect(
        await testPrisma.inventoryTransaction.count({
          where: { inventoryId, referenceId: partialOrder.orderId, type: 'SALE' },
        }),
      ).toBe(1);
      expect(
        await testPrisma.inventoryTransaction.count({
          where: {
            inventoryId,
            referenceId: partialOrder.orderId,
            type: { in: ['RELEASE', 'STOCK_IN'] },
          },
        }),
      ).toBe(0);

      // Conservative B-3 policy: pre-shipment partial refund blocks PROCESSING by default,
      // while a settled partial refund issued AFTER shipment allows DELIVERED -> COMPLETED.
      await orderService.updateStatus(
        tenantA.id,
        partialOrder.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      await expect(
        orderService.updateStatus(
          tenantA.id,
          partialOrder.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_READY' });

      const shippedOrder = await createCapturedCardOrder();
      for (const preShip of [
        OrderStatus.CONFIRMED,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
      ]) {
        await orderService.updateStatus(
          tenantA.id,
          shippedOrder.orderId,
          { status: preShip },
          ownerAId,
        );
      }
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${shippedOrder.paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `fulf-post-ship-${shippedOrder.paymentId}`,
            reason: 'Post-shipment goodwill partial refund',
          }),
      ).expect(200);

      for (const postShip of [OrderStatus.DELIVERED, OrderStatus.COMPLETED]) {
        const moved = await orderService.updateStatus(
          tenantA.id,
          shippedOrder.orderId,
          { status: postShip },
          ownerAId,
        );
        expect(moved.status).toBe(postShip);
      }

      // B) Pending FULL refund blocks new shipment/processing
      const pendingFullOrder = await createCapturedCardOrder();
      await orderService.updateStatus(
        tenantA.id,
        pendingFullOrder.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      MockMyFatoorahProvider.enqueueRefundBehavior(pendingFullOrder.invoiceId, {
        outcome: 'PENDING',
        amount: '10.000',
        currency: 'KWD',
        providerRefundId: `pend-full-${pendingFullOrder.paymentId}`,
      });
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${pendingFullOrder.paymentId}/refund`)
          .send({
            amount: '10.000',
            idempotencyKey: `fulf-pend-full-${pendingFullOrder.paymentId}`,
            reason: 'Pending full refund before fulfillment',
          }),
      ).expect(200);

      await expect(
        orderService.updateStatus(
          tenantA.id,
          pendingFullOrder.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_READY' });

      // C) Settled FULL refund blocks new fulfillment
      const settledFullOrder = await createCapturedCardOrder();
      await orderService.updateStatus(
        tenantA.id,
        settledFullOrder.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${settledFullOrder.paymentId}/refund`)
          .send({
            amount: '10.000',
            idempotencyKey: `fulf-settled-full-${settledFullOrder.paymentId}`,
            reason: 'Full refund before fulfillment',
          }),
      ).expect(200);

      await expect(
        orderService.updateStatus(
          tenantA.id,
          settledFullOrder.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_READY' });
    });

    it('keeps real MyFatoorah refunds disabled and COD refunds blocked with zero orphaned reservations or external HTTP calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      try {
        // Real MyFatoorah adapter rejects BEFORE reserving any DB row
        const card = await createCapturedCardOrder();
        await expect(
          myFatoorahRefundService.refundPayment(tenantA.id, card.paymentId, {
            amount: '5.000',
            idempotencyKey: `mf-disabled-${card.paymentId}`,
            reason: 'Should fail fast for real MyFatoorah',
            requestedByUserId: ownerAId,
          }),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'PAYMENT_PROVIDER_OPERATION_NOT_SUPPORTED',
        });
        expect(
          await testPrisma.paymentRefund.count({
            where: { tenantId: tenantA.id, paymentId: card.paymentId },
          }),
        ).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();

        // COD refunds remain blocked with 409 COD_REFUND_WORKFLOW_REQUIRED and 0 reservations
        const cod = await createPaidCodOrder();
        const codRes = await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${cod.paymentId}/refund`)
            .send({
              amount: cod.totalAmount,
              idempotencyKey: `cod-blocked-${cod.paymentId}`,
              reason: 'COD refund must stay blocked',
            }),
        );
        expect(codRes.status).toBe(409);
        expect(codRes.body.code).toBe('COD_REFUND_WORKFLOW_REQUIRED');
        expect(
          await testPrisma.paymentRefund.count({
            where: { tenantId: tenantA.id, paymentId: cod.paymentId },
          }),
        ).toBe(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
