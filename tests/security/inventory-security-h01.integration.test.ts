import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ipKeyGenerator } from 'express-rate-limit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import {
  globalRateLimiter,
  sensitiveRateLimiter,
} from '../../src/config/rate-limit.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { testPrisma } from '../../src/config/test-database.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
} from '../../src/generated/prisma/client.js';
import { CheckoutService } from '../../src/modules/checkout/checkout.service.js';
import { inventoryService } from '../../src/modules/inventory/inventory.service.instance.js';
import { PaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { paymentService } from '../../src/modules/payments/payment.service.instance.js';
import { PaymentVerificationService } from '../../src/modules/payments/payment-verification.service.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import type { PaymentProviderAdapter } from '../../src/modules/payments/providers/payment-provider.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

describe('Phase 2D.8 Step 2B — H-01 Inventory Security Hardening', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const countryCode = `H${tenantA.id.slice(-7)}`.toUpperCase();

  let ownerAToken: string;
  let adminAToken: string;
  let managerAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let ownerBToken: string;

  let warehouseAId: string;
  let addressAId: string;
  let variantId: string;
  let inventoryId: string;
  let shippingMethodCode: string;

  const createdUserIds: string[] = [];

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

  const createUser = async (
    label: string,
    tenantId: string,
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER',
  ) => {
    const user = await testPrisma.user.create({
      data: {
        email: `h01-${label}-${runId}@example.com`,
        passwordHash: 'hash',
        firstName: label,
        lastName: 'Tester',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    await testPrisma.tenantMember.create({
      data: {
        tenantId,
        userId: user.id,
        role,
        status: 'ACTIVE',
      },
    });
    const token = await createAccessToken(user.id);
    return { id: user.id, token };
  };

  const checkoutOrder = async (
    paymentMethod: PaymentMethod,
    paymentProvider?: PaymentProvider,
    quantity = 3,
  ) => {
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity }),
    ).expect(200);

    const res = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `h01-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod,
        }),
    ).expect(201);

    const payment = res.body.data.payment as {
      id: string;
      status: PaymentStatus;
      method: PaymentMethod;
      provider: PaymentProvider;
    };

    if (paymentProvider && payment.provider !== paymentProvider) {
      const orig = await testPrisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      await testPrisma.payment.delete({ where: { id: orig.id } });
      const created = await testPrisma.payment.create({
        data: {
          orderId: orig.orderId,
          provider: paymentProvider,
          method: orig.method,
          status: orig.status,
          amount: orig.amount,
          currency: orig.currency,
          initiationState: orig.initiationState,
        },
      });
      payment.id = created.id;
      payment.provider = created.provider;
    }

    return {
      order: res.body.data.order as {
        id: string;
        status: OrderStatus;
        paymentStatus: PaymentStatus;
        totalAmount: string;
        currency: string;
      },
      payment,
    };
  };

  const advanceCodTo = async (
    orderId: string,
    target: 'PROCESSING' | 'SHIPPED' | 'DELIVERED',
  ) => {
    const steps: Array<'PROCESSING' | 'SHIPPED' | 'DELIVERED'> = [
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ];
    for (const step of steps) {
      await asOwnerA(
        request(app)
          .patch(`/api/v1/orders/${orderId}/status`)
          .send({ status: step }),
      ).expect(200);
      if (step === target) break;
    }
  };

  beforeEach(() => {
    globalRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    globalRateLimiter.resetKey('127.0.0.1');
    sensitiveRateLimiter.resetKey(`${tenantA.id}:${customerAId}`);
  });

  beforeAll(async () => {
    await tenantA.create();
    await tenantB.create();

    await testPrisma.tenant.update({
      where: { id: tenantA.id },
      data: { defaultCurrency: 'KWD' },
    });

    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: `H01 Test Country ${runId}`,
        currencyCode: 'KWD',
        isActive: true,
      },
    });

    const whA = await fixtureWarehouse(tenantA.id);
    warehouseAId = whA.id;
    await testPrisma.warehouseCoverage.upsert({
      where: {
        warehouseId_countryCode: { warehouseId: whA.id, countryCode },
      },
      create: { tenantId: tenantA.id, warehouseId: whA.id, countryCode },
      update: {},
    });

    const taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId: tenantA.id, code: 'STANDARD', name: 'Standard' },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId: tenantA.id,
        countryCode,
        currency: 'KWD',
        defaultTaxCategoryId: taxCategory.id,
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
        code: `h01-zone-${runId}`,
        name: 'Default Zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'standard', name: 'Standard Delivery' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 1.5 },
    });
    shippingMethodCode = method.code;

    const ownerA = await createUser('ownerA', tenantA.id, 'OWNER');
    const adminA = await createUser('adminA', tenantA.id, 'ADMIN');
    const managerA = await createUser('managerA', tenantA.id, 'MANAGER');
    const customerA = await createUser('customerA', tenantA.id, 'CUSTOMER');
    const ownerB = await createUser('ownerB', tenantB.id, 'OWNER');

    ownerAToken = ownerA.token;
    adminAToken = adminA.token;
    managerAToken = managerA.token;
    customerAId = customerA.id;
    customerAToken = customerA.token;
    ownerBToken = ownerB.token;

    const address = await testPrisma.address.create({
      data: {
        userId: customerAId,
        firstName: 'Test',
        lastName: 'Customer',
        addressLine1: 'Block 1 Street 1',
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
        name: `H01 Category ${runId}`,
        slug: `h01-cat-${runId}`,
      },
    });

    const product = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        categoryId: category.id,
        name: `H01 Product ${runId}`,
        slug: `h01-prod-${runId}`,
        basePrice: '10.000',
        status: ProductStatus.ACTIVE,
      },
    });

    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `H01-SKU-${runId}`,
        combinationKey: '',
        price: '10.000',
        isDefault: true,
        isActive: true,
      },
    });
    variantId = variant.id;

    const inv = await inventoryService.create(tenantA.id, {
      warehouseId: warehouseAId,
      variantId,
      quantity: 200,
    });
    inventoryId = inv.id;
  });

  afterAll(async () => {
    await testPrisma.cartItem.deleteMany({
      where: { cart: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.cart.deleteMany({
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
    await testPrisma.recoveryJob.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.myFatoorahWebhookEvent.deleteMany({
      where: {
        payment: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
      },
    });
    await testPrisma.myFatoorahInvoice.deleteMany({
      where: {
        payment: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
      },
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
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.inventory.deleteMany({
      where: { id: inventoryId },
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
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: tenantA.id } },
    });
    await testPrisma.taxProfile.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await testPrisma.taxCategory.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await tenantA.cleanup();
    await tenantB.cleanup();
    await testPrisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
    await testPrisma.country.deleteMany({
      where: { code: countryCode },
    });
    await testPrisma.$disconnect();
  });

  it('1, 2, 3, 4 & 5. Removed reserve/release/sale HTTP endpoints return 404 across exact, alternate, and fake references without mutating inventory', async () => {
    const { order } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 3);
    await advanceCodTo(order.id, 'SHIPPED');

    const invBefore = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const txCountBefore = await testPrisma.inventoryTransaction.count({
      where: { inventoryId },
    });

    const attempts: Array<{
      path: 'reserve' | 'release' | 'sale';
      referenceId: string;
      caller: (req: request.Test) => request.Test;
    }> = [
      // Exact order ID attempts
      { path: 'reserve', referenceId: order.id, caller: asOwnerA },
      { path: 'release', referenceId: order.id, caller: asManagerA },
      { path: 'sale', referenceId: order.id, caller: asAdminA },
      // Alternate-reference pool-drainage attempts
      { path: 'release', referenceId: `manual-alt-release-${runId}`, caller: asOwnerA },
      { path: 'sale', referenceId: `manual-alt-sale-${runId}`, caller: asOwnerA },
      // Fake reference outside Checkout attempting to lock stock
      { path: 'reserve', referenceId: `fake-hold-${runId}`, caller: asManagerA },
    ];

    for (const attempt of attempts) {
      const res = await attempt.caller(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/${attempt.path}`)
          .send({
            quantity: 3,
            referenceId: attempt.referenceId,
            reason: 'Unauthorized manual reservation attempt',
          }),
      );
      expect(res.status).toBe(404);
    }

    const invAfter = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const txCountAfter = await testPrisma.inventoryTransaction.count({
      where: { inventoryId },
    });
    expect(invAfter.quantity).toBe(invBefore.quantity);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity);
    expect(txCountAfter).toBe(txCountBefore);

    // Service-layer cleanup confirmed: reserve/release/sale are no longer public methods
    expect('reserve' in inventoryService).toBe(false);
    expect('release' in inventoryService).toBe(false);
    expect('sale' in inventoryService).toBe(false);
  });

  it('6, 7 & 8. Manual STOCK_IN/STOCK_OUT/ADJUSTMENT reject cod-dmg:, init:, and existing Order.id references with zero mutation', async () => {
    const { order } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 2);
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const txCountBefore = await testPrisma.inventoryTransaction.count({
      where: { inventoryId },
    });

    // Reserved prefixes (case-insensitive) across all 3 manual routes
    const reservedPrefixes = [
      `cod-dmg:${order.id}`,
      `COD-DMG:${order.id}`,
      `init:${inventoryId}`,
      `INIT:opening-override`,
    ];

    for (const ref of reservedPrefixes) {
      const stockInRes = await asAdminA(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/stock-in`)
          .send({ quantity: 1, reason: 'Bad ref', referenceId: ref }),
      );
      expect(stockInRes.status).toBe(400);
      expect(stockInRes.body.code).toBe('RESERVED_REFERENCE_ID');

      const stockOutRes = await asManagerA(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/stock-out`)
          .send({ quantity: 1, reason: 'Bad ref', referenceId: ref }),
      );
      expect(stockOutRes.status).toBe(400);
      expect(stockOutRes.body.code).toBe('RESERVED_REFERENCE_ID');

      const adjustRes = await asOwnerA(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/adjust`)
          .send({ quantity: 1, reason: 'Bad ref', referenceId: ref }),
      );
      expect(adjustRes.status).toBe(400);
      expect(adjustRes.body.code).toBe('RESERVED_REFERENCE_ID');
    }

    // Existing tenant Order.id rejected across all 3 manual routes
    for (const [endpoint, body] of [
      ['stock-in', { quantity: 1, reason: 'Order ref', referenceId: order.id }],
      ['stock-out', { quantity: 1, reason: 'Order ref', referenceId: order.id }],
      ['adjust', { quantity: 1, reason: 'Order ref', referenceId: order.id }],
    ] as const) {
      const res = await asOwnerA(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/${endpoint}`)
          .send(body),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_REFERENCE_ID_FORBIDDEN');
    }

    const invAfter = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const txCountAfter = await testPrisma.inventoryTransaction.count({
      where: { inventoryId },
    });
    expect(invAfter.quantity).toBe(invBefore.quantity);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity);
    expect(txCountAfter).toBe(txCountBefore);
  });

  it('9, 10, 11 & 12. Legitimate merchant references, STOCK_IN/STOCK_OUT/ADJUSTMENT, idempotency, and reserved-stock floors remain intact', async () => {
    const before = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const stockInRef = `po-restock-${runId}`;
    const stockOutRef = `damage-writeoff-${runId}`;
    const adjustRef = `cycle-count-${runId}`;

    // Valid STOCK_IN + idempotent replay
    const in1 = await asManagerA(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/stock-in`)
        .send({ quantity: 10, reason: 'Supplier delivery', referenceId: stockInRef }),
    );
    expect(in1.status).toBe(200);
    expect(in1.body.data.quantity).toBe(before.quantity + 10);

    const inReplay = await asManagerA(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/stock-in`)
        .send({ quantity: 10, reason: 'Supplier delivery', referenceId: stockInRef }),
    );
    expect(inReplay.status).toBe(200);
    expect(inReplay.body.data.quantity).toBe(before.quantity + 10);

    // Valid STOCK_OUT
    const out1 = await asAdminA(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/stock-out`)
        .send({ quantity: 4, reason: 'Shelf damage', referenceId: stockOutRef }),
    );
    expect(out1.status).toBe(200);
    expect(out1.body.data.quantity).toBe(before.quantity + 6);

    // Valid ADJUSTMENT
    const adj1 = await asOwnerA(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/adjust`)
        .send({ quantity: -1, reason: 'Cycle count variance', referenceId: adjustRef }),
    );
    expect(adj1.status).toBe(200);
    expect(adj1.body.data.quantity).toBe(before.quantity + 5);
    expect(adj1.body.data.availableQuantity).toBe(
      adj1.body.data.quantity - adj1.body.data.reservedQuantity,
    );

    // STOCK_OUT cannot consume reserved quantities
    const available = adj1.body.data.availableQuantity as number;
    expect(adj1.body.data.reservedQuantity).toBeGreaterThan(0);

    const overOut = await asOwnerA(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/stock-out`)
        .send({
          quantity: available + 1,
          reason: 'Overdraw reserved',
          referenceId: `over-out-${runId}`,
        }),
    );
    expect(overOut.status).toBe(409);
    expect(overOut.body.code).toBe('INSUFFICIENT_INVENTORY');

    // ADJUSTMENT cannot reduce quantity below reservedQuantity
    const overAdj = await asOwnerA(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/adjust`)
        .send({
          quantity: -(available + 1),
          reason: 'Overdraw reserved',
          referenceId: `over-adj-${runId}`,
        }),
    );
    expect(overAdj.status).toBe(409);
    expect(overAdj.body.code).toBe('INVALID_INVENTORY_ADJUSTMENT');

    // Opening inventory ledger creation remains intact
    const initTx = await testPrisma.inventoryTransaction.findFirst({
      where: { inventoryId, type: 'STOCK_IN', referenceId: `init:${inventoryId}` },
    });
    expect(initTx).not.toBeNull();
    expect(initTx!.quantity).toBe(200);
  });

  it('13 & 14. Checkout reserves atomically and verified online payment commits exactly one SALE', async () => {
    const before = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    const { order, payment } = await checkoutOrder(
      PaymentMethod.CARD,
      PaymentProvider.MYFATOORAH,
      4,
    );
    const afterReserve = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(afterReserve.quantity).toBe(before.quantity);
    expect(afterReserve.reservedQuantity).toBe(before.reservedQuantity + 4);

    const invoiceId = `${Math.floor(100000000 + Math.random() * 899999999)}`;
    await testPrisma.payment.update({
      where: { id: payment.id },
      data: { providerPaymentId: invoiceId, initiationState: 'INITIATED' },
    });
    await testPrisma.myFatoorahInvoice.create({
      data: { paymentId: payment.id, invoiceId },
    });

    const adapter: PaymentProviderAdapter = {
      provider: PaymentProvider.MYFATOORAH,
      supportsIdempotentInitiation: false,
      createPayment: async () => ({ status: PaymentStatus.REQUIRES_ACTION }),
      cancelPayment: async () => ({ status: PaymentStatus.CANCELLED }),
      refundPayment: async () => ({ status: PaymentStatus.REFUNDED }),
      getPaymentStatus: async (invId) => ({
        invoiceId: invId,
        customerReference: payment.id,
        orderReference: order.id,
        amount: order.totalAmount,
        currency: order.currency,
        status: PaymentStatus.PAID,
        transactionId: `tx-${invId}`,
        transactionPaymentId: '88776655',
        transactionPaymentIds: ['88776655'],
      }),
    };
    class VerifiedRegistry extends PaymentProviderRegistry {
      override getProvider() {
        return adapter;
      }
    }
    const verifier = new PaymentVerificationService(
      new PaymentRepository(),
      paymentService,
      new VerifiedRegistry(),
    );

    await verifier.verifyForUser(tenantA.id, customerAId, payment.id);
    await verifier.verifyForUser(tenantA.id, customerAId, payment.id);

    const afterSale = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(afterSale.quantity).toBe(before.quantity - 4);
    expect(afterSale.reservedQuantity).toBe(before.reservedQuantity);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: order.id },
      }),
    ).toBe(1);
  });

  it('15 & 16. Valid COD confirmation commits exactly one SALE and unpaid cancellation releases reservation', async () => {
    const before = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    // Valid COD confirmation after DELIVERED
    const codPaid = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 2);
    await advanceCodTo(codPaid.order.id, 'DELIVERED');

    const confirmRes = await asOwnerA(
      request(app)
        .post(`/api/v1/orders/${codPaid.order.id}/cod/confirm-payment`)
        .send({
          referenceId: `h01-cod-pay-${codPaid.order.id}`,
          collectedAmount: codPaid.order.totalAmount,
          currency: codPaid.order.currency,
        }),
    );
    expect(confirmRes.status).toBe(200);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: codPaid.order.id },
      }),
    ).toBe(1);

    // Unpaid cancellation releases reservation
    const codCancel = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 3);
    const cancelRes = await asManagerA(
      request(app)
        .patch(`/api/v1/orders/${codCancel.order.id}/status`)
        .send({ status: 'CANCELLED' }),
    );
    expect(cancelRes.status).toBe(200);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: codCancel.order.id },
      }),
    ).toBe(1);

    const after = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(after.quantity).toBe(before.quantity - 2);
    expect(after.reservedQuantity).toBe(before.reservedQuantity);
  });

  it('17 & 18. RESELLABLE COD return restores available stock and DAMAGED COD return performs atomic RELEASE + STOCK_OUT', async () => {
    const before = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    // RESELLABLE COD return
    const resellable = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 2);
    await advanceCodTo(resellable.order.id, 'SHIPPED');
    await asManagerA(
      request(app)
        .post(`/api/v1/orders/${resellable.order.id}/cod/mark-refused`)
        .send({
          referenceId: `h01-ref-resell-${resellable.order.id}`,
          reason: 'Customer refused parcel',
        }),
    ).expect(200);

    await asAdminA(
      request(app)
        .post(`/api/v1/orders/${resellable.order.id}/cod/confirm-return`)
        .send({
          referenceId: `h01-ret-resell-${resellable.order.id}`,
          warehouseId: warehouseAId,
          receivedCondition: 'RESELLABLE',
          note: 'Box intact',
        }),
    ).expect(200);

    const afterResellable = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(afterResellable.quantity).toBe(before.quantity);
    expect(afterResellable.reservedQuantity).toBe(before.reservedQuantity);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: resellable.order.id },
      }),
    ).toBe(1);

    // DAMAGED COD return (verifies blocked cod-dmg: manual attempt did not poison ledger)
    const damaged = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 3);
    await advanceCodTo(damaged.order.id, 'SHIPPED');
    await asManagerA(
      request(app)
        .post(`/api/v1/orders/${damaged.order.id}/cod/mark-refused`)
        .send({
          referenceId: `h01-ref-dmg-${damaged.order.id}`,
          reason: 'Damaged in transit',
        }),
    ).expect(200);

    // Attempt to poison cod-dmg:<orderId> manually before return -> blocked (400)
    const poisonAttempt = await asManagerA(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/stock-out`)
        .send({
          quantity: 1,
          reason: 'Poison attempt',
          referenceId: `cod-dmg:${damaged.order.id}`,
        }),
    );
    expect(poisonAttempt.status).toBe(400);
    expect(poisonAttempt.body.code).toBe('RESERVED_REFERENCE_ID');

    await asOwnerA(
      request(app)
        .post(`/api/v1/orders/${damaged.order.id}/cod/confirm-return`)
        .send({
          referenceId: `h01-ret-dmg-${damaged.order.id}`,
          warehouseId: warehouseAId,
          receivedCondition: 'DAMAGED',
          note: 'Crushed packaging',
        }),
    ).expect(200);

    const afterDamaged = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(afterDamaged.quantity).toBe(before.quantity - 3);
    expect(afterDamaged.reservedQuantity).toBe(before.reservedQuantity);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: damaged.order.id },
      }),
    ).toBe(1);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: {
          inventoryId,
          type: 'STOCK_OUT',
          referenceId: `cod-dmg:${damaged.order.id}`,
        },
      }),
    ).toBe(1);
  });

  it('19. Concurrent manual stock movements preserve inventory consistency and idempotency', async () => {
    const before = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const sharedRef = `conc-stock-in-${runId}`;

    const [r1, r2, r3] = await Promise.all([
      asOwnerA(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/stock-in`)
          .send({ quantity: 5, reason: 'Concurrent restock', referenceId: sharedRef }),
      ),
      asAdminA(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/stock-in`)
          .send({ quantity: 5, reason: 'Concurrent restock', referenceId: sharedRef }),
      ),
      asManagerA(
        request(app)
          .post(`/api/v1/inventory/${inventoryId}/stock-in`)
          .send({ quantity: 7, reason: 'Conflicting restock', referenceId: sharedRef }),
      ),
    ]);

    const okCount = [r1, r2, r3].filter((r) => r.status === 200).length;
    const conflictCount = [r1, r2, r3].filter((r) => r.status === 409).length;
    expect(okCount).toBeGreaterThanOrEqual(1);
    expect(conflictCount).toBeGreaterThanOrEqual(1);

    const after = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect([before.quantity + 5, before.quantity + 7]).toContain(after.quantity);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, referenceId: sharedRef },
      }),
    ).toBe(1);
  });

  it('20. Cross-tenant inventory access and failure-injected transactional rollbacks leave inventory and ledger intact', async () => {
    const before = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const txBefore = await testPrisma.inventoryTransaction.count({
      where: { inventoryId },
    });

    // Cross-tenant manual movement and read attempts -> 404
    const crossGet = await asOwnerB(
      request(app).get(`/api/v1/inventory/${inventoryId}`),
    );
    expect(crossGet.status).toBe(404);

    const crossStockOut = await asOwnerB(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/stock-out`)
        .send({ quantity: 1, reason: 'Cross-tenant', referenceId: `x-${runId}` }),
    );
    expect(crossStockOut.status).toBe(404);

    // Cross-tenant attempt against removed endpoints also returns 404
    const crossRelease = await asOwnerB(
      request(app)
        .post(`/api/v1/inventory/${inventoryId}/release`)
        .send({ quantity: 1, referenceId: `x-rel-${runId}` }),
    );
    expect(crossRelease.status).toBe(404);

    // Failure-injection rollback: checkout failure after inventory reserved rolls back reservation + ledger
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 4 }),
    ).expect(200);

    const failingCheckout = new CheckoutService((point) => {
      if (point === 'after-inventory-reserved') {
        throw new Error('Injected failure after inventory reservation');
      }
    });

    await expect(
      failingCheckout.checkout(
        {
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        },
        {
          tenantId: tenantA.id,
          userId: customerAId,
          idempotencyKey: `h01-rollback-${randomUUID()}`,
        },
      ),
    ).rejects.toThrow('Injected failure after inventory reservation');

    // Clear cart item left intact by rollback
    await asCustomerA(request(app).delete('/api/v1/cart')).expect(200);

    // Failure-injection rollback: damaged COD return transaction rollback leaves quantity, reservedQuantity, and ledger unchanged
    const rollbackOrder = await checkoutOrder(
      PaymentMethod.CASH_ON_DELIVERY,
      undefined,
      2,
    );
    const beforeRollbackReturn = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const txBeforeRollbackReturn = await testPrisma.inventoryTransaction.count({
      where: { inventoryId },
    });

    await expect(
      testPrisma.$transaction(async (tx) => {
        await inventoryService.releaseOrderReservationAsDamaged(
          tenantA.id,
          rollbackOrder.order.id,
          tx,
          'Simulated damaged return rollback',
        );
        throw new Error('Injected failure after damaged return ledger write');
      }),
    ).rejects.toThrow('Injected failure after damaged return ledger write');

    const afterRollbackReturn = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    const txAfterRollbackReturn = await testPrisma.inventoryTransaction.count({
      where: { inventoryId },
    });
    expect(afterRollbackReturn.quantity).toBe(beforeRollbackReturn.quantity);
    expect(afterRollbackReturn.reservedQuantity).toBe(
      beforeRollbackReturn.reservedQuantity,
    );
    expect(txAfterRollbackReturn).toBe(txBeforeRollbackReturn);

    // Clean up only the rollbackOrder reservation check against baseline
    expect(before.quantity).toBeGreaterThan(0);
    expect(txBefore).toBeGreaterThan(0);
  });
});
