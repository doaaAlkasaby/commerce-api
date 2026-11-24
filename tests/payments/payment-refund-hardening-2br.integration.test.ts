import { createHmac, randomUUID } from 'node:crypto';
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

const TEST_WEBHOOK_SECRET = 'step-2br-webhook-secret-at-least-32-chars!!';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      PAYMENT_PROVIDER: 'MOCK',
      MOCK_CHECKOUT_BASE_URL: 'http://localhost:3000',
      MOCK_CHECKOUT_SECRET: 'step-2br-mock-refund-secret-at-least-32-chars!!',
      MYFATOORAH_WEBHOOK_SECRET: 'step-2br-webhook-secret-at-least-32-chars!!',
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
  DevicePlatform,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentRefundStatus,
  PaymentStatus,
  ProductStatus,
} from '../../src/generated/prisma/client.js';
import { OrderService } from '../../src/modules/orders/order.service.js';
import { NotificationPushRepository } from '../../src/modules/notifications/notification-push.repository.js';
import { NotificationPushWorker } from '../../src/modules/notifications/notification-push.worker.js';
import { PaymentRefundService } from '../../src/modules/payments/payment-refund.service.js';
import { PaymentVerificationService } from '../../src/modules/payments/payment-verification.service.js';
import { PaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { MockMyFatoorahProvider } from '../../src/modules/payments/providers/mock-myfatoorah.provider.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import type { PaymentProviderAdapter } from '../../src/modules/payments/providers/payment-provider.js';
import type { VerifiedProviderPayment } from '../../src/modules/payments/payment.types.js';
import { env } from '../../src/config/env.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

function signPaymentWebhookV2(
  invoiceId: string,
  invoiceStatus: 'PAID' | 'PENDING',
  transactionStatus: 'SUCCESS' | 'FAILED' | 'AUTHORIZE' | 'CANCELED',
  transactionPaymentId: string,
  externalIdentifier: string | null = '',
) {
  const canonical = `Invoice.Id=${invoiceId},Invoice.Status=${invoiceStatus},Transaction.Status=${transactionStatus},Transaction.PaymentId=${transactionPaymentId},Invoice.ExternalIdentifier=${externalIdentifier ?? ''}`;
  return createHmac('sha256', TEST_WEBHOOK_SECRET)
    .update(canonical, 'utf8')
    .digest('base64');
}

describe('Phase 2D.12 Step 2B-R — Refund Domain Hardening & Financial Safety Regression', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = randomUUID().slice(0, 8);
  const countryCode = `H${tenantA.id.slice(-7)}`.toUpperCase();

  let ownerAId: string;
  let ownerAToken: string;
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
    MOCK_CHECKOUT_SECRET: 'step-2br-mock-refund-secret-at-least-32-chars!!',
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
        email: `step2br-${label}-${runId}@example.test`,
        passwordHash: 'unused-hash',
        firstName: label,
        lastName: 'Hardening',
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

  let numericInvoiceSeq = 700000;

  async function createCapturedCardOrder(options?: { numericInvoice?: boolean }) {
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 1 }),
    ).expect(200);

    const checkoutRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `s2br-chk-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod: PaymentMethod.CARD,
        }),
    ).expect(201);

    const orderId = checkoutRes.body.data.order.id as string;
    const totalAmount = checkoutRes.body.data.order.totalAmount as string;
    const paymentId = checkoutRes.body.data.payment.id as string;

    const invoiceId = options?.numericInvoice
      ? String(++numericInvoiceSeq)
      : `mock-inv-${paymentId}`;
    const originalTxnId = `txn-${invoiceId}`;
    const transactionPaymentId = String(++numericInvoiceSeq);

    await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
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

    await testPrisma.myFatoorahInvoice.upsert({
      where: { paymentId },
      create: { paymentId, invoiceId },
      update: {},
    });

    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { initiationState: 'INITIATED' },
    });

    return {
      orderId,
      paymentId,
      invoiceId,
      originalTxnId,
      transactionPaymentId,
      totalAmount,
    };
  }

  function createVerificationServiceWithStub(
    getPaymentStatus: (invoiceId: string) => Promise<VerifiedProviderPayment>,
  ) {
    const adapter: PaymentProviderAdapter = {
      provider: PaymentProvider.MYFATOORAH,
      supportsIdempotentInitiation: true,
      supportsRefunds: true,
      getPaymentStatus,
      createPayment: async () => ({ status: PaymentStatus.REQUIRES_ACTION }),
      cancelPayment: async () => ({ status: PaymentStatus.CANCELLED }),
      refundPayment: async () => ({ status: PaymentStatus.REFUNDED }),
    };
    const registry = {
      getProvider: () => adapter,
      resolveProviderForMethod: () => PaymentProvider.MYFATOORAH,
    } as unknown as PaymentProviderRegistry;
    return new PaymentVerificationService(
      new PaymentRepository(),
      paymentService,
      registry,
    );
  }

  async function createPaidCodOrder() {
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 1 }),
    ).expect(200);

    const checkoutRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `s2br-cod-${randomUUID()}`)
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
          referenceId: `s2br-cod-pay-${orderId}`,
          collectedAmount: totalAmount,
          currency: 'KWD',
        }),
    ).expect(200);

    return { orderId, paymentId, totalAmount };
  }

  beforeAll(async () => {
    process.env.MOCK_CHECKOUT_SECRET =
      'step-2br-mock-refund-secret-at-least-32-chars!!';
    await tenantA.create();
    await tenantB.create();

    await testPrisma.tenant.update({
      where: { id: tenantA.id },
      data: { defaultCurrency: 'KWD' },
    });

    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: `Step2BR Country ${runId}`,
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
      data: {
        tenantId: tenantA.id,
        code: 'EXEMPT',
        name: 'Exempt',
        treatment: 'EXEMPT',
      },
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
        code: `s2br-zone-${runId}`,
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
    const managerA = await createUser('managerA', tenantA.id, 'MANAGER');
    const customerA = await createUser('customerA', tenantA.id, 'CUSTOMER');
    const ownerB = await createUser('ownerB', tenantB.id, 'OWNER');

    ownerAId = ownerA.id;
    ownerAToken = ownerA.token;
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
        addressLine1: 'Block 3 Street 9',
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
        name: `Step2BR Cat ${runId}`,
        slug: `s2br-cat-${runId}`,
      },
    });

    const product = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        categoryId: category.id,
        name: 'Exact 10 KWD Hardening Item',
        slug: `s2br-item-${runId}`,
        basePrice: '10.000',
        status: ProductStatus.ACTIVE,
      },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `S2BR-SKU-${runId}`,
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
        quantity: 300,
        reservedQuantity: 0,
      },
    });
    inventoryId = inv.id;
  });

  beforeEach(() => {
    MockMyFatoorahProvider.resetRefundState();
    globalRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    globalRateLimiter.resetKey('127.0.0.1');
    for (const uid of [ownerAId, customerAId, ownerBId]) {
      sensitiveRateLimiter.resetKey(`${tenantA.id}:${uid}`);
      sensitiveRateLimiter.resetKey(`${tenantB.id}:${uid}`);
    }
  });

  afterAll(async () => {
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.myFatoorahWebhookEvent.deleteMany({
      where: { payment: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } } },
    });
    await testPrisma.myFatoorahInvoice.deleteMany({
      where: { payment: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } } },
    });
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.userDevice.deleteMany({
      where: { userId: { in: createdUserIds } },
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
  // A. B-1: LATE PAYMENT VERIFICATION & WEBHOOKS AFTER REFUNDS (Items 1-11)
  // =========================================================================
  describe('A. B-1 Late Payment Verification & Webhooks After Refunds', () => {
    it('preserves REFUND_PENDING, PARTIALLY_REFUNDED, and REFUNDED on valid late PAID verifyForUser without poisoning reconciliationRequired or duplicating side effects', async () => {
      // 1) REFUND_PENDING
      const pendingCase = await createCapturedCardOrder();
      MockMyFatoorahProvider.enqueueRefundBehavior(pendingCase.invoiceId, {
        outcome: 'PENDING',
        amount: '3.000',
        currency: 'KWD',
        providerRefundId: `pend-b1-${pendingCase.paymentId}`,
      });
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${pendingCase.paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `b1-pend-${pendingCase.paymentId}`,
            reason: 'Pending partial refund before late verify',
          }),
      ).expect(200);

      const verifier = createVerificationServiceWithStub(async () => ({
        invoiceId: pendingCase.invoiceId,
        customerReference: pendingCase.paymentId,
        orderReference: pendingCase.orderId,
        amount: '10.000',
        currency: 'KWD',
        status: PaymentStatus.PAID,
        transactionId: pendingCase.originalTxnId,
        transactionPaymentId: pendingCase.transactionPaymentId,
        transactionPaymentIds: [pendingCase.transactionPaymentId],
      }));

      const observedPending = await verifier.verifyForUser(
        tenantA.id,
        customerAId,
        pendingCase.paymentId,
      );
      expect(observedPending.status).toBe(PaymentStatus.REFUND_PENDING);
      expect(observedPending.reconciliationRequired).toBe(false);
      expect(observedPending.providerPaymentId).toBe(pendingCase.invoiceId);
      expect(observedPending.providerTransactionId).toBe(
        pendingCase.originalTxnId,
      );

      // 2) PARTIALLY_REFUNDED + subsequent valid partial refund still succeeds
      const partialCase = await createCapturedCardOrder();
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${partialCase.paymentId}/refund`)
          .send({
            amount: '4.000',
            idempotencyKey: `b1-part-1-${partialCase.paymentId}`,
            reason: 'First settled partial refund',
          }),
      ).expect(200);

      const partialVerifier = createVerificationServiceWithStub(async () => ({
        invoiceId: partialCase.invoiceId,
        customerReference: partialCase.paymentId,
        orderReference: partialCase.orderId,
        amount: '10.000',
        currency: 'KWD',
        status: PaymentStatus.PAID,
        transactionId: partialCase.originalTxnId,
        transactionPaymentId: partialCase.transactionPaymentId,
        transactionPaymentIds: [partialCase.transactionPaymentId],
      }));

      const observedPartial = await partialVerifier.verifyForUser(
        tenantA.id,
        customerAId,
        partialCase.paymentId,
      );
      expect(observedPartial.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(observedPartial.reconciliationRequired).toBe(false);

      // Subsequent partial refund MUST still succeed (B-1 core fix)
      const secondRefund = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${partialCase.paymentId}/refund`)
          .send({
            amount: '6.000',
            idempotencyKey: `b1-part-2-${partialCase.paymentId}`,
            reason: 'Remaining partial refund after late verify',
          }),
      ).expect(200);
      expect(secondRefund.body.data.payment.status).toBe(PaymentStatus.REFUNDED);

      // 3) REFUNDED
      const observedFull = await partialVerifier.verifyForUser(
        tenantA.id,
        customerAId,
        partialCase.paymentId,
      );
      expect(observedFull.status).toBe(PaymentStatus.REFUNDED);
      expect(observedFull.reconciliationRequired).toBe(false);

      const dbOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: partialCase.orderId },
      });
      expect(dbOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(
        await testPrisma.paymentRefund.count({
          where: { tenantId: tenantA.id, paymentId: partialCase.paymentId },
        }),
      ).toBe(2);
      // Zero duplicate SALE transactions and zero duplicate PAYMENT_PAID notifications
      expect(
        await testPrisma.inventoryTransaction.count({
          where: {
            inventoryId,
            referenceId: partialCase.orderId,
            type: 'SALE',
          },
        }),
      ).toBe(1);
      expect(
        await testPrisma.notification.count({
          where: {
            tenantId: tenantA.id,
            eventKey: `payment_paid_${partialCase.paymentId}`,
          },
        }),
      ).toBe(1);
    });

    it('handles late PAYMENT_STATUS_CHANGED webhooks across refund statuses, preserves existing legitimate reconciliationRequired, and still rejects mismatched/contradictory provider evidence', async () => {
      const prevProvider = env.PAYMENT_PROVIDER;
      (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'MYFATOORAH';
      try {
        const orderCase = await createCapturedCardOrder({ numericInvoice: true });
        await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
            .send({
              amount: '3.000',
              idempotencyKey: `b1-wh-part-${orderCase.paymentId}`,
              reason: 'Settled partial before late webhook',
            }),
        ).expect(200);

        const whVerifier = createVerificationServiceWithStub(async () => ({
          invoiceId: orderCase.invoiceId,
          customerReference: orderCase.paymentId,
          orderReference: orderCase.orderId,
          amount: '10.000',
          currency: 'KWD',
          status: PaymentStatus.PAID,
          transactionId: orderCase.originalTxnId,
          transactionPaymentId: orderCase.transactionPaymentId,
          transactionPaymentIds: [orderCase.transactionPaymentId],
        }));

        const payload = {
          Event: {
            Code: 1,
            Name: 'PAYMENT_STATUS_CHANGED',
            CountryIsoCode: 'KWT',
            Reference: `wh-b1-${orderCase.paymentId}`,
          },
          Data: {
            Invoice: {
              Id: orderCase.invoiceId,
              Status: 'PAID' as const,
              ExternalIdentifier: '',
            },
            Transaction: {
              Status: 'SUCCESS' as const,
              PaymentId: orderCase.transactionPaymentId,
            },
          },
        };
        const sig = signPaymentWebhookV2(
          orderCase.invoiceId,
          'PAID',
          'SUCCESS',
          orderCase.transactionPaymentId,
          '',
        );

        const whRes1 = await whVerifier.processWebhook(payload, sig);
        expect(whRes1).toEqual({
          received: true,
          reconciliationRequired: false,
        });
        // Duplicate webhook replay deduplicated cleanly
        const whRes2 = await whVerifier.processWebhook(payload, sig);
        expect(whRes2).toEqual({
          received: true,
          reconciliationRequired: false,
        });

        const dbPay = await testPrisma.payment.findUniqueOrThrow({
          where: { id: orderCase.paymentId },
        });
        expect(dbPay.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
        expect(dbPay.reconciliationRequired).toBe(false);

        // Existing legitimate reconciliationRequired MUST NOT be cleared by a valid late PAID observation
        const reconCase = await createCapturedCardOrder();
        await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${reconCase.paymentId}/refund`)
            .send({
              amount: '2.000',
              idempotencyKey: `b1-recon-${reconCase.paymentId}`,
              reason: 'Partial refund before legitimate reconciliation flag',
            }),
        ).expect(200);
        await testPrisma.payment.update({
          where: { id: reconCase.paymentId },
          data: {
            reconciliationRequired: true,
            reconciliationReason: 'EXISTING_LEGITIMATE_FLAG',
          },
        });
        const reconVerifier = createVerificationServiceWithStub(async () => ({
          invoiceId: reconCase.invoiceId,
          customerReference: reconCase.paymentId,
          orderReference: reconCase.orderId,
          amount: '10.000',
          currency: 'KWD',
          status: PaymentStatus.PAID,
          transactionId: reconCase.originalTxnId,
          transactionPaymentId: reconCase.transactionPaymentId,
          transactionPaymentIds: [reconCase.transactionPaymentId],
        }));
        const observedRecon = await reconVerifier.verifyForUser(
          tenantA.id,
          customerAId,
          reconCase.paymentId,
        );
        expect(observedRecon.reconciliationRequired).toBe(true);
        expect(observedRecon.reconciliationReason).toBe(
          'EXISTING_LEGITIMATE_FLAG',
        );

        // Mismatched amount/transactionId/contradictory FAILED status STILL fail safely and set reconciliationRequired
        const badTxnCase = await createCapturedCardOrder();
        await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${badTxnCase.paymentId}/refund`)
            .send({
              amount: '2.000',
              idempotencyKey: `b1-badtxn-${badTxnCase.paymentId}`,
              reason: 'Partial before mismatched verify',
            }),
        ).expect(200);

        const mismatchedTxnVerifier = createVerificationServiceWithStub(
          async () => ({
            invoiceId: badTxnCase.invoiceId,
            customerReference: badTxnCase.paymentId,
            orderReference: badTxnCase.orderId,
            amount: '10.000',
            currency: 'KWD',
            status: PaymentStatus.PAID,
            transactionId: 'TAMPERED-TXN-ID',
            transactionPaymentId: badTxnCase.transactionPaymentId,
            transactionPaymentIds: [badTxnCase.transactionPaymentId],
          }),
        );
        await expect(
          mismatchedTxnVerifier.verifyForUser(
            tenantA.id,
            customerAId,
            badTxnCase.paymentId,
          ),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'MYFATOORAH_IDENTITY_MISMATCH',
        });
        const flaggedBadTxn = await testPrisma.payment.findUniqueOrThrow({
          where: { id: badTxnCase.paymentId },
        });
        expect(flaggedBadTxn.reconciliationRequired).toBe(true);

        const badAmountCase = await createCapturedCardOrder();
        await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${badAmountCase.paymentId}/refund`)
            .send({
              amount: '2.000',
              idempotencyKey: `b1-badamt-${badAmountCase.paymentId}`,
              reason: 'Partial before amount mismatch verify',
            }),
        ).expect(200);
        const mismatchedAmtVerifier = createVerificationServiceWithStub(
          async () => ({
            invoiceId: badAmountCase.invoiceId,
            customerReference: badAmountCase.paymentId,
            orderReference: badAmountCase.orderId,
            amount: '9.000',
            currency: 'KWD',
            status: PaymentStatus.PAID,
            transactionId: badAmountCase.originalTxnId,
            transactionPaymentId: badAmountCase.transactionPaymentId,
            transactionPaymentIds: [badAmountCase.transactionPaymentId],
          }),
        );
        await expect(
          mismatchedAmtVerifier.verifyForUser(
            tenantA.id,
            customerAId,
            badAmountCase.paymentId,
          ),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'MYFATOORAH_AMOUNT_MISMATCH',
        });

        const contradictoryStatusCase = await createCapturedCardOrder();
        await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${contradictoryStatusCase.paymentId}/refund`)
            .send({
              amount: '2.000',
              idempotencyKey: `b1-contra-${contradictoryStatusCase.paymentId}`,
              reason: 'Partial before contradictory FAILED verify',
            }),
        ).expect(200);
        const contradictoryVerifier = createVerificationServiceWithStub(
          async () => ({
            invoiceId: contradictoryStatusCase.invoiceId,
            customerReference: contradictoryStatusCase.paymentId,
            orderReference: contradictoryStatusCase.orderId,
            amount: '10.000',
            currency: 'KWD',
            status: PaymentStatus.FAILED,
            transactionId: contradictoryStatusCase.originalTxnId,
            transactionPaymentId: contradictoryStatusCase.transactionPaymentId,
            transactionPaymentIds: [contradictoryStatusCase.transactionPaymentId],
          }),
        );
        await expect(
          contradictoryVerifier.verifyForUser(
            tenantA.id,
            customerAId,
            contradictoryStatusCase.paymentId,
          ),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'INVALID_PAYMENT_STATUS_TRANSITION',
        });
      } finally {
        (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = prevProvider;
      }
    });

    it('serializes concurrent payment verification and refund reservation cleanly under Order FOR UPDATE', async () => {
      const raceCase = await createCapturedCardOrder();
      const verifier = createVerificationServiceWithStub(async () => ({
        invoiceId: raceCase.invoiceId,
        customerReference: raceCase.paymentId,
        orderReference: raceCase.orderId,
        amount: '10.000',
        currency: 'KWD',
        status: PaymentStatus.PAID,
        transactionId: raceCase.originalTxnId,
        transactionPaymentId: raceCase.transactionPaymentId,
        transactionPaymentIds: [raceCase.transactionPaymentId],
      }));

      const [verifyRes, refundRes] = await Promise.all([
        verifier.verifyForUser(tenantA.id, customerAId, raceCase.paymentId),
        asOwnerA(
          request(app)
            .post(`/api/v1/payments/${raceCase.paymentId}/refund`)
            .send({
              amount: '3.000',
              idempotencyKey: `b1-race-${raceCase.paymentId}`,
              reason: 'Concurrent refund during verify',
            }),
        ),
      ]);

      expect(refundRes.status).toBe(200);
      expect(verifyRes.reconciliationRequired).toBe(false);

      const finalPayment = await testPrisma.payment.findUniqueOrThrow({
        where: { id: raceCase.paymentId },
      });
      expect(finalPayment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(finalPayment.reconciliationRequired).toBe(false);
    });
  });

  // =========================================================================
  // B. B-2: STRICT REFUND FINANCIAL EVIDENCE & IMMUTABILITY (Items 12-31)
  // =========================================================================
  describe('B. B-2 Strict Refund Financial Evidence & Reference Immutability', () => {
    it('rejects incomplete, mismatched, malformed, unknown, and ambiguous-failure provider responses while retaining capacity and preserving original payment identity', async () => {
      const invalidCases: Array<{
        label: string;
        behavior: unknown;
        expectedStatus: number;
        expectedCode: string;
        expectedReason: string;
      }> = [
        {
          label: 'SUCCEEDED without amount',
          behavior: (input: { refundId: string; providerPaymentId: string }) => ({
            outcome: 'SUCCEEDED',
            currency: 'KWD',
            providerRefundId: `ref-no-amt-${input.refundId}`,
            originalProviderPaymentId: input.providerPaymentId,
            refundId: input.refundId,
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_AMOUNT_MISSING',
        },
        {
          label: 'SUCCEEDED without currency',
          behavior: (input: { refundId: string; providerPaymentId: string }) => ({
            outcome: 'SUCCEEDED',
            amount: '1.000',
            providerRefundId: `ref-no-cur-${input.refundId}`,
            originalProviderPaymentId: input.providerPaymentId,
            refundId: input.refundId,
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_CURRENCY_MISSING',
        },
        {
          label: 'SUCCEEDED without providerRefundId',
          behavior: (input: { refundId: string; providerPaymentId: string }) => ({
            outcome: 'SUCCEEDED',
            amount: '1.000',
            currency: 'KWD',
            originalProviderPaymentId: input.providerPaymentId,
            refundId: input.refundId,
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_REFUND_ID_MISSING',
        },
        {
          label: 'SUCCEEDED without originalProviderPaymentId',
          behavior: (input: { refundId: string }) => ({
            outcome: 'SUCCEEDED',
            amount: '1.000',
            currency: 'KWD',
            providerRefundId: `ref-no-orig-${input.refundId}`,
            refundId: input.refundId,
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_ORIGINAL_PAYMENT_BINDING_MISSING',
        },
        {
          label: 'SUCCEEDED with wrong originalProviderPaymentId',
          behavior: (input: { refundId: string }) => ({
            outcome: 'SUCCEEDED',
            amount: '1.000',
            currency: 'KWD',
            providerRefundId: `ref-bad-orig-${input.refundId}`,
            originalProviderPaymentId: 'wrong-invoice-id',
            refundId: input.refundId,
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_ORIGINAL_PAYMENT_BINDING_MISMATCH',
        },
        {
          label: 'SUCCEEDED with wrong refundId',
          behavior: (input: { refundId: string; providerPaymentId: string }) => ({
            outcome: 'SUCCEEDED',
            amount: '1.000',
            currency: 'KWD',
            providerRefundId: `ref-bad-rid-${input.refundId}`,
            originalProviderPaymentId: input.providerPaymentId,
            refundId: randomUUID(),
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_REFUND_IDENTITY_MISMATCH',
        },
        {
          label: 'SUCCEEDED with amount mismatch',
          behavior: (input: { refundId: string; providerPaymentId: string }) => ({
            outcome: 'SUCCEEDED',
            amount: '2.000',
            currency: 'KWD',
            providerRefundId: `ref-bad-amt-${input.refundId}`,
            originalProviderPaymentId: input.providerPaymentId,
            refundId: input.refundId,
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_AMOUNT_MISMATCH',
        },
        {
          label: 'SUCCEEDED with currency mismatch',
          behavior: (input: { refundId: string; providerPaymentId: string }) => ({
            outcome: 'SUCCEEDED',
            amount: '1.000',
            currency: 'USD',
            providerRefundId: `ref-bad-cur-${input.refundId}`,
            originalProviderPaymentId: input.providerPaymentId,
            refundId: input.refundId,
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_CURRENCY_MISMATCH',
        },
        {
          label: 'null provider response',
          behavior: () => null,
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_RESPONSE_NOT_OBJECT',
        },
        {
          label: 'non-object provider response',
          behavior: () => 'invalid-string',
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_RESPONSE_NOT_OBJECT',
        },
        {
          label: 'UNKNOWN outcome',
          behavior: () => ({
            outcome: 'UNKNOWN',
            failureCode: 'GATEWAY_AMBIGUOUS',
          }),
          expectedStatus: 503,
          expectedCode: 'REFUND_OUTCOME_UNKNOWN',
          expectedReason: 'GATEWAY_AMBIGUOUS',
        },
        {
          label: 'ambiguous FAILED without definitiveFailure: true',
          behavior: () => ({
            outcome: 'FAILED',
            failureCode: 'UNCLASSIFIED_ERROR',
          }),
          expectedStatus: 502,
          expectedCode: 'REFUND_RECONCILIATION_REQUIRED',
          expectedReason: 'PROVIDER_FAILURE_AMBIGUOUS',
        },
      ];

      for (const tc of invalidCases) {
        const orderCase = await createCapturedCardOrder();
        MockMyFatoorahProvider.enqueueRefundBehavior(
          orderCase.invoiceId,
          tc.behavior as never,
        );

        const res = await asOwnerA(
          request(app)
            .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
            .send({
              amount: '1.000',
              idempotencyKey: `b2-inv-${randomUUID()}`,
              reason: `Evidence guard: ${tc.label}`,
            }),
        );

        expect(res.status, tc.label).toBe(tc.expectedStatus);
        expect(res.body.code, tc.label).toBe(tc.expectedCode);

        const rows = await testPrisma.paymentRefund.findMany({
          where: { tenantId: tenantA.id, paymentId: orderCase.paymentId },
        });
        expect(rows, tc.label).toHaveLength(1);
        expect(rows[0]!.status, tc.label).toBe(
          PaymentRefundStatus.RECONCILIATION_REQUIRED,
        );
        expect(rows[0]!.reconciliationReason, tc.label).toBe(tc.expectedReason);

        const summary = await refundService.getRefundSummary(
          tenantA.id,
          orderCase.paymentId,
        );
        expect(summary.summary.settledRefundedAmount, tc.label).toBe('0.000');
        expect(summary.summary.reservedInFlightAmount, tc.label).toBe('1.000');
        expect(summary.summary.remainingRefundableAmount, tc.label).toBe(
          '9.000',
        );

        const dbPay = await testPrisma.payment.findUniqueOrThrow({
          where: { id: orderCase.paymentId },
        });
        expect(dbPay.providerPaymentId, tc.label).toBe(orderCase.invoiceId);
        expect(dbPay.providerTransactionId, tc.label).toBe(
          orderCase.originalTxnId,
        );

        expect(
          await testPrisma.notification.count({
            where: {
              tenantId: tenantA.id,
              eventKey: { contains: `_refund_` },
              data: { path: ['paymentId'], equals: orderCase.paymentId },
            },
          }),
          tc.label,
        ).toBe(0);
      }
    });

    it('enforces definitive failure release, all provider identifier conflicts before NOOP, compatible terminal replays, terminal contradictions, and ledger-backed internal transition proof', async () => {
      // 1) Definitive failure releases capacity cleanly
      const failCase = await createCapturedCardOrder();
      MockMyFatoorahProvider.enqueueRefundBehavior(failCase.invoiceId, {
        outcome: 'FAILED',
        definitiveFailure: true,
        amount: '3.000',
        currency: 'KWD',
        failureCode: 'PROVIDER_HARD_DECLINE',
      });
      const failedRes = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${failCase.paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `b2-def-fail-${failCase.paymentId}`,
            reason: 'Definitive rejection releases capacity',
          }),
      ).expect(200);
      const failedRefundId = failedRes.body.data.refund.id as string;
      expect(failedRes.body.data.refund.status).toBe(PaymentRefundStatus.FAILED);
      expect(failedRes.body.data.payment.status).toBe(PaymentStatus.PAID);
      expect(failedRes.body.data.summary.remainingRefundableAmount).toBe(
        '10.000',
      );

      // FAILED -> SUCCEEDED contradiction rejected without mutating terminal history
      await expect(
        refundService.applyRefundOutcome(tenantA.id, failedRefundId, {
          outcome: 'SUCCEEDED',
          providerRefundId: 'late-conflict-id',
          amount: '3.000',
          currency: 'KWD',
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'REFUND_STATE_CONFLICT' });

      // Compatible FAILED replay returns NOOP cleanly
      const failedReplay = await refundService.applyRefundOutcome(
        tenantA.id,
        failedRefundId,
        { outcome: 'FAILED', definitiveFailure: true },
      );
      expect(failedReplay.idempotentReplay).toBe(true);
      expect(failedReplay.refund.status).toBe(PaymentRefundStatus.FAILED);

      // 2) Settled refund identifier immutability & same-terminal conflict guards
      const okCase = await createCapturedCardOrder();
      const okRes = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${okCase.paymentId}/refund`)
          .send({
            amount: '4.000',
            idempotencyKey: `b2-ok-${okCase.paymentId}`,
            reason: 'Settled refund for identifier immutability test',
          }),
      ).expect(200);
      const okRefund = okRes.body.data.refund as {
        id: string;
        providerRefundId: string;
        providerRefundReference: string;
        providerRefundInvoiceId: string;
      };

      // Conflicting providerRefundId on same terminal status SUCCEEDED -> 409 (NOT silent NOOP!)
      await expect(
        refundService.applyRefundOutcome(tenantA.id, okRefund.id, {
          outcome: 'SUCCEEDED',
          providerRefundId: 'different-refund-id',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'REFUND_PROVIDER_REFERENCE_CONFLICT',
      });

      // Conflicting providerRefundReference -> 409
      await expect(
        refundService.applyRefundOutcome(tenantA.id, okRefund.id, {
          outcome: 'SUCCEEDED',
          providerRefundReference: 'different-refund-ref',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'REFUND_PROVIDER_REFERENCE_CONFLICT',
      });

      // Conflicting providerRefundInvoiceId -> 409
      await expect(
        refundService.applyRefundOutcome(tenantA.id, okRefund.id, {
          outcome: 'SUCCEEDED',
          providerRefundInvoiceId: 'different-refund-inv',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'REFUND_PROVIDER_REFERENCE_CONFLICT',
      });

      // SUCCEEDED -> FAILED contradiction -> 409
      await expect(
        refundService.applyRefundOutcome(tenantA.id, okRefund.id, {
          outcome: 'FAILED',
          definitiveFailure: true,
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'REFUND_STATE_CONFLICT' });

      // Compatible terminal replay with matching IDs (and omitted optional IDs) -> idempotentReplay: true, never erases IDs
      const compatReplay = await refundService.applyRefundOutcome(
        tenantA.id,
        okRefund.id,
        {
          outcome: 'SUCCEEDED',
          providerRefundId: okRefund.providerRefundId,
          providerRefundReference: null,
          amount: '4.000',
          currency: 'KWD',
        },
      );
      expect(compatReplay.idempotentReplay).toBe(true);
      expect(compatReplay.refund.providerRefundId).toBe(
        okRefund.providerRefundId,
      );
      expect(compatReplay.refund.providerRefundReference).toBe(
        okRefund.providerRefundReference,
      );
      expect(compatReplay.refund.providerRefundInvoiceId).toBe(
        okRefund.providerRefundInvoiceId,
      );

      // 3) Section 4.4: Internal PAYMENT_REFUND transition proof rejects forged in-process boolean without DB ledger proof
      const proofCase = await createCapturedCardOrder();
      await expect(
        paymentService.applyTrustedPaymentStatus(
          tenantA.id,
          proofCase.paymentId,
          { status: PaymentStatus.REFUNDED },
          { kind: 'PAYMENT_REFUND', ledgerVerified: true } as never,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
      });
      await expect(
        paymentService.applyTrustedPaymentStatus(
          tenantA.id,
          proofCase.paymentId,
          { status: PaymentStatus.REFUNDED },
          {
            kind: 'PAYMENT_REFUND',
            refundId: randomUUID(),
            ledgerVerified: true,
          } as never,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
      });
    });
  });

  // =========================================================================
  // C. B-3: CONSERVATIVE FULFILLMENT POLICY & CONCURRENCY (Items 32-42)
  // =========================================================================
  describe('C. B-3 Conservative Fulfillment Policy & Concurrency', () => {
    it('blocks pre-shipment fulfillment on 9.999/10.000 refunded, pending partial, RECONCILIATION_REQUIRED, legacy ledger-less statuses, settled partial, and fully refunded orders', async () => {
      // 1) 10.000 KWD with 9.999 KWD refunded (0.001 remaining) MUST NOT ship
      const almostFull = await createCapturedCardOrder();
      await orderService.updateStatus(
        tenantA.id,
        almostFull.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${almostFull.paymentId}/refund`)
          .send({
            amount: '9.999',
            idempotencyKey: `b3-9999-${almostFull.paymentId}`,
            reason: 'Almost-full partial refund',
          }),
      ).expect(200);
      await expect(
        orderService.updateStatus(
          tenantA.id,
          almostFull.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_READY' });

      // 2) Pending partial refund blocks pre-shipment
      const pendPartial = await createCapturedCardOrder();
      await orderService.updateStatus(
        tenantA.id,
        pendPartial.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      MockMyFatoorahProvider.enqueueRefundBehavior(pendPartial.invoiceId, {
        outcome: 'PENDING',
        amount: '2.000',
        currency: 'KWD',
        providerRefundId: `b3-pend-${pendPartial.paymentId}`,
      });
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${pendPartial.paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: `b3-pend-part-${pendPartial.paymentId}`,
            reason: 'Pending partial refund',
          }),
      ).expect(200);
      await expect(
        orderService.updateStatus(
          tenantA.id,
          pendPartial.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_READY' });

      // 3) RECONCILIATION_REQUIRED refund blocks fulfillment
      const reconOrder = await createCapturedCardOrder();
      await orderService.updateStatus(
        tenantA.id,
        reconOrder.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      MockMyFatoorahProvider.enqueueRefundBehavior(reconOrder.invoiceId, {
        outcome: 'UNKNOWN',
        failureCode: 'GATEWAY_TIMEOUT',
      });
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${reconOrder.paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: `b3-recon-${reconOrder.paymentId}`,
            reason: 'Unknown outcome blocks fulfillment',
          }),
      ).expect(503);
      await expect(
        orderService.updateStatus(
          tenantA.id,
          reconOrder.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });

      // 4) Legacy PARTIALLY_REFUNDED without ledger rows rejected
      const legacyPartial = await createCapturedCardOrder();
      await orderService.updateStatus(
        tenantA.id,
        legacyPartial.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      await testPrisma.payment.update({
        where: { id: legacyPartial.paymentId },
        data: { status: PaymentStatus.PARTIALLY_REFUNDED },
      });
      await testPrisma.order.update({
        where: { id: legacyPartial.orderId },
        data: { paymentStatus: PaymentStatus.PARTIALLY_REFUNDED },
      });
      await expect(
        orderService.updateStatus(
          tenantA.id,
          legacyPartial.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });

      // 5) Legacy REFUND_PENDING without ledger rows rejected
      const legacyPending = await createCapturedCardOrder();
      await orderService.updateStatus(
        tenantA.id,
        legacyPending.orderId,
        { status: OrderStatus.CONFIRMED },
        ownerAId,
      );
      await testPrisma.payment.update({
        where: { id: legacyPending.paymentId },
        data: { status: PaymentStatus.REFUND_PENDING },
      });
      await testPrisma.order.update({
        where: { id: legacyPending.orderId },
        data: { paymentStatus: PaymentStatus.REFUND_PENDING },
      });
      await expect(
        orderService.updateStatus(
          tenantA.id,
          legacyPending.orderId,
          { status: OrderStatus.PROCESSING },
          ownerAId,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });

      // 6) Fully refunded payment blocks even post-shipment DELIVERED
      const fullAfterShip = await createCapturedCardOrder();
      for (const st of [
        OrderStatus.CONFIRMED,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
      ]) {
        await orderService.updateStatus(
          tenantA.id,
          fullAfterShip.orderId,
          { status: st },
          ownerAId,
        );
      }
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${fullAfterShip.paymentId}/refund`)
          .send({
            amount: '10.000',
            idempotencyKey: `b3-full-post-${fullAfterShip.paymentId}`,
            reason: 'Full refund after shipment',
          }),
      ).expect(200);
      await expect(
        orderService.updateStatus(
          tenantA.id,
          fullAfterShip.orderId,
          { status: OrderStatus.DELIVERED },
          ownerAId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_READY' });
    });

    it('allows post-shipment DELIVERED/COMPLETED after settled partial refund, preserves non-refunded PAID & COD fulfillment, and handles both concurrent shipment/refund execution orders', async () => {
      // 1) Post-shipment settled partial refund allows DELIVERED -> COMPLETED
      const postShip = await createCapturedCardOrder();
      for (const st of [
        OrderStatus.CONFIRMED,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
      ]) {
        await orderService.updateStatus(
          tenantA.id,
          postShip.orderId,
          { status: st },
          ownerAId,
        );
      }
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${postShip.paymentId}/refund`)
          .send({
            amount: '2.500',
            idempotencyKey: `b3-post-ship-${postShip.paymentId}`,
            reason: 'Post-shipment partial credit',
          }),
      ).expect(200);
      expect(
        (
          await orderService.updateStatus(
            tenantA.id,
            postShip.orderId,
            { status: OrderStatus.DELIVERED },
            ownerAId,
          )
        ).status,
      ).toBe(OrderStatus.DELIVERED);
      expect(
        (
          await orderService.updateStatus(
            tenantA.id,
            postShip.orderId,
            { status: OrderStatus.COMPLETED },
            ownerAId,
          )
        ).status,
      ).toBe(OrderStatus.COMPLETED);

      // 2) Normal PAID order & COD order unchanged
      const normalPaid = await createCapturedCardOrder();
      for (const st of [
        OrderStatus.CONFIRMED,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
        OrderStatus.DELIVERED,
        OrderStatus.COMPLETED,
      ]) {
        expect(
          (
            await orderService.updateStatus(
              tenantA.id,
              normalPaid.orderId,
              { status: st },
              ownerAId,
            )
          ).status,
        ).toBe(st);
      }
      const codOrder = await createPaidCodOrder();
      expect(
        (
          await orderService.updateStatus(
            tenantA.id,
            codOrder.orderId,
            { status: OrderStatus.COMPLETED },
            ownerAId,
          )
        ).status,
      ).toBe(OrderStatus.COMPLETED);

      // 3) Concurrent shipment vs refund reservation:
      // Order A: refund reservation wins lock first -> SHIPPED blocked (409)
      const orderRefundFirst = await createCapturedCardOrder();
      for (const st of [OrderStatus.CONFIRMED, OrderStatus.PROCESSING]) {
        await orderService.updateStatus(
          tenantA.id,
          orderRefundFirst.orderId,
          { status: st },
          ownerAId,
        );
      }
      await refundService.reserveRefund(tenantA.id, orderRefundFirst.paymentId, {
        amount: '3.000',
        idempotencyKey: `b3-order-a-${orderRefundFirst.paymentId}`,
        reason: 'Refund reservation wins before shipment',
        requestedByUserId: ownerAId,
      });
      await expect(
        orderService.updateStatus(
          tenantA.id,
          orderRefundFirst.orderId,
          { status: OrderStatus.SHIPPED },
          ownerAId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_READY' });

      // Order B: shipment wins lock first -> SHIPPED succeeds, post-shipment refund also succeeds cleanly
      const orderShipFirst = await createCapturedCardOrder();
      for (const st of [
        OrderStatus.CONFIRMED,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
      ]) {
        await orderService.updateStatus(
          tenantA.id,
          orderShipFirst.orderId,
          { status: st },
          ownerAId,
        );
      }
      const postShipRefund = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${orderShipFirst.paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `b3-order-b-${orderShipFirst.paymentId}`,
            reason: 'Refund after shipment won first',
          }),
      ).expect(200);
      expect(postShipRefund.body.data.payment.status).toBe(
        PaymentStatus.PARTIALLY_REFUNDED,
      );
      const shippedDbOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: orderShipFirst.orderId },
      });
      expect(shippedDbOrder.status).toBe(OrderStatus.SHIPPED);

      // True Promise.all race between PROCESSING -> SHIPPED and refundPayment
      const raceOrder = await createCapturedCardOrder();
      for (const st of [OrderStatus.CONFIRMED, OrderStatus.PROCESSING]) {
        await orderService.updateStatus(
          tenantA.id,
          raceOrder.orderId,
          { status: st },
          ownerAId,
        );
      }
      const [shipOutcome, refOutcome] = await Promise.allSettled([
        orderService.updateStatus(
          tenantA.id,
          raceOrder.orderId,
          { status: OrderStatus.SHIPPED },
          ownerAId,
        ),
        asOwnerA(
          request(app)
            .post(`/api/v1/payments/${raceOrder.paymentId}/refund`)
            .send({
              amount: '4.000',
              idempotencyKey: `b3-race-${raceOrder.paymentId}`,
              reason: 'Concurrent shipment/refund race',
            }),
        ),
      ]);
      expect(refOutcome.status).toBe('fulfilled');
      if (refOutcome.status === 'fulfilled') {
        expect(refOutcome.value.status).toBe(200);
      }
      const dbRaceOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: raceOrder.orderId },
      });
      // Either refund won first (order stayed PROCESSING & ship rejected 409)
      // OR ship won first (order became SHIPPED & post-shipment refund succeeded)
      if (shipOutcome.status === 'rejected') {
        expect(shipOutcome.reason).toMatchObject({ statusCode: 409 });
        expect(dbRaceOrder.status).toBe(OrderStatus.PROCESSING);
      } else {
        expect(dbRaceOrder.status).toBe(OrderStatus.SHIPPED);
      }
      expect(dbRaceOrder.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });
  });

  // =========================================================================
  // D. AUTHORIZATION & REQUEST VALIDATION (Items 43-49)
  // =========================================================================
  describe('D. Authorization & Request Validation', () => {
    it('rejects Idempotency-Key mismatch, missing amount/key/reason, payment reconciliationRequired, and unauthorized actors', async () => {
      const orderCase = await createCapturedCardOrder();

      // Header vs body Idempotency-Key mismatch
      const mismatch = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
          .set('Idempotency-Key', 'header-key-1')
          .send({
            amount: '1.000',
            idempotencyKey: 'body-key-2',
            reason: 'Mismatched key test',
          }),
      );
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');

      // Missing amount
      const noAmt = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
          .send({ idempotencyKey: 'no-amt-1', reason: 'Missing amount' }),
      );
      expect(noAmt.status).toBe(400);
      expect(noAmt.body.code).toBe('INVALID_REFUND_AMOUNT');

      // Missing idempotencyKey
      const noKey = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
          .send({ amount: '1.000', reason: 'Missing key' }),
      );
      expect(noKey.status).toBe(400);
      expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      // Missing or too-short reason
      const noReason = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
          .send({ amount: '1.000', idempotencyKey: 'no-reason-1' }),
      );
      expect(noReason.status).toBe(400);
      expect(noReason.body.code).toBe('REFUND_REASON_REQUIRED');

      const shortReason = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
          .send({ amount: '1.000', idempotencyKey: 'short-reason-1', reason: 'ab' }),
      );
      expect(shortReason.status).toBe(400);
      expect(shortReason.body.code).toBe('REFUND_REASON_REQUIRED');

      // Cross-tenant & unauthorized roles
      expect(
        (
          await asOwnerB(
            request(app)
              .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
              .send({
                amount: '1.000',
                idempotencyKey: 'xt-auth-1',
                reason: 'Cross-tenant denied',
              }),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await asManagerA(
            request(app)
              .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
              .send({
                amount: '1.000',
                idempotencyKey: 'mgr-auth-1',
                reason: 'Manager denied',
              }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await asCustomerA(
            request(app)
              .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
              .send({
                amount: '1.000',
                idempotencyKey: 'cust-auth-1',
                reason: 'Customer denied',
              }),
          )
        ).status,
      ).toBe(403);

      // Existing Payment.reconciliationRequired blocks new refunds
      await testPrisma.payment.update({
        where: { id: orderCase.paymentId },
        data: {
          reconciliationRequired: true,
          reconciliationReason: 'MANUAL_HOLD',
        },
      });
      const reconBlocked = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${orderCase.paymentId}/refund`)
          .send({
            amount: '1.000',
            idempotencyKey: 'recon-blocked-1',
            reason: 'Should be blocked by reconciliationRequired',
          }),
      );
      expect(reconBlocked.status).toBe(409);
      expect(reconBlocked.body.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    });
  });

  // =========================================================================
  // E. REFUND NOTIFICATIONS & TRANSACTIONAL OUTBOX (Items 50-54)
  // =========================================================================
  describe('E. Refund Notifications & Transactional Outbox', () => {
    it('atomically creates Notification + NotificationPushJob, preserves rollback consistency, deduplicates replays, uses accurate final partial refund wording, and passes refundId to mocked FCM payload', async () => {
      // Drain only jobs created by this test cleanly
      await testPrisma.notificationPushJob.deleteMany({
        where: { tenantId: tenantA.id },
      });
      const notifCase = await createCapturedCardOrder();

      // Register a mock customer device token for FCM payload verification
      const mockFcmToken = `mock-fcm-token-${runId}`;
      await testPrisma.userDevice.create({
        data: {
          userId: customerAId,
          token: mockFcmToken,
          platform: DevicePlatform.IOS,
          isActive: true,
        },
      });

      // Partial #1 (3.000) + Partial #2 (2.000) + Final Partial #3 (5.000)
      const r1 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${notifCase.paymentId}/refund`)
          .send({
            amount: '3.000',
            idempotencyKey: `e-p1-${notifCase.paymentId}`,
            reason: 'Partial #1',
          }),
      ).expect(200);
      await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${notifCase.paymentId}/refund`)
          .send({
            amount: '2.000',
            idempotencyKey: `e-p2-${notifCase.paymentId}`,
            reason: 'Partial #2',
          }),
      ).expect(200);
      const r3 = await asOwnerA(
        request(app)
          .post(`/api/v1/payments/${notifCase.paymentId}/refund`)
          .send({
            amount: '5.000',
            idempotencyKey: `e-p3-${notifCase.paymentId}`,
            reason: 'Final partial #3',
          }),
      ).expect(200);

      const finalRefundId = r3.body.data.refund.id as string;

      // Compatible replay creates ZERO duplicate notifications or push jobs
      await refundService.applyRefundOutcome(tenantA.id, finalRefundId, {
        outcome: 'SUCCEEDED',
        providerRefundId: r3.body.data.refund.providerRefundId,
      });

      const refundNotifs = await testPrisma.notification.findMany({
        where: {
          tenantId: tenantA.id,
          eventKey: { contains: `_refund_` },
          data: { path: ['paymentId'], equals: notifCase.paymentId },
        },
        include: { pushJob: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(refundNotifs).toHaveLength(3);
      for (const n of refundNotifs) {
        expect(n.pushJob).not.toBeNull();
        expect(n.pushJob!.state).toBe('READY');
      }

      // Verify final partial refund wording distinguishes KWD 5.000 transaction vs full aggregate status
      const finalNotif = refundNotifs[2]!;
      expect(finalNotif.eventKey).toBe(
        `payment_refunded_${notifCase.paymentId}_refund_${finalRefundId}`,
      );
      expect(finalNotif.body).toContain('KWD 5.000');
      expect(finalNotif.body).toContain('completing the full refund');
      expect(finalNotif.body).not.toContain('A full refund of KWD 5.000');
      expect((finalNotif.data as Record<string, unknown>).refundId).toBe(
        finalRefundId,
      );
      expect(
        (finalNotif.data as Record<string, unknown>).aggregatePaymentStatus,
      ).toBe('REFUNDED');

      // Rollback consistency: failed settlement leaves 0 refund notifications & 0 push jobs
      const failNotifCase = await createCapturedCardOrder();
      const reserved = await refundService.reserveRefund(
        tenantA.id,
        failNotifCase.paymentId,
        {
          amount: '5.000',
          idempotencyKey: `e-rollback-${failNotifCase.paymentId}`,
          reason: 'Settlement fails missing providerRefundId',
          requestedByUserId: ownerAId,
        },
      );
      await expect(
        refundService.applyRefundOutcome(tenantA.id, reserved.refund.id, {
          outcome: 'SUCCEEDED',
          providerRefundId: null,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'REFUND_FINANCIAL_EVIDENCE_INCOMPLETE',
      });
      const failedNotifs = await testPrisma.notification.findMany({
        where: {
          tenantId: tenantA.id,
          eventKey: { contains: `_refund_` },
          data: { path: ['paymentId'], equals: failNotifCase.paymentId },
        },
      });
      expect(failedNotifs).toHaveLength(0);

      // Verify NotificationPushWorker includes refundId in mocked FCM payload (zero live Firebase)
      const capturedPayloads: Array<Record<string, string>> = [];
      const mockFirebase = {
        sendMulticastNotification: vi.fn(
          async (args: {
            tokens: string[];
            title: string;
            body: string;
            data: Record<string, string>;
          }) => {
            capturedPayloads.push(args.data);
            return {
              successCount: args.tokens.length,
              failureCount: 0,
              successfulTokens: args.tokens,
              invalidTokens: [],
              isDryRun: true,
            };
          },
        ),
      };
      const pushWorker = new NotificationPushWorker(
        new NotificationPushRepository(),
        mockFirebase as never,
      );
      let processedTotal = 0;
      for (let i = 0; i < 10; i++) {
        const count = await pushWorker.processBatch();
        processedTotal += count;
        if (count === 0) break;
      }
      expect(processedTotal).toBeGreaterThanOrEqual(3);
      const refundPushPayloads = capturedPayloads.filter(
        (p) => p.refundId === finalRefundId || p.refundId === r1.body.data.refund.id,
      );
      expect(refundPushPayloads.length).toBeGreaterThanOrEqual(2);
      const finalPushPayload = capturedPayloads.find(
        (p) => p.refundId === finalRefundId,
      );
      expect(finalPushPayload).toMatchObject({
        eventType: 'PAYMENT_REFUNDED',
        refundId: finalRefundId,
        orderId: notifCase.orderId,
        tenantSlug: tenantA.slug,
      });
      // No sensitive credentials exposed
      expect(JSON.stringify(finalPushPayload)).not.toContain('Bearer');
      expect(JSON.stringify(finalPushPayload)).not.toContain('secret');
    });
  });
});
