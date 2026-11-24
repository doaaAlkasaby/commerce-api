import crypto from 'node:crypto';
import request from 'supertest';
import { ipKeyGenerator } from 'express-rate-limit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { testPrisma } from '../../src/config/test-database.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../src/generated/prisma/client.js';
import {
  globalRateLimiter,
  sensitiveRateLimiter,
} from '../../src/config/rate-limit.js';
import { paymentService } from '../../src/modules/payments/payment.service.instance.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

describe('Phase 2D.7 Step 2A — COD Payment & Merchant Fulfillment (Commerce API)', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const countryCode = `C${tenantA.id.replace(/[^a-zA-Z0-9]/g, '').slice(-7)}`.toUpperCase();

  let ownerAId: string;
  let ownerAToken: string;
  let adminAId: string;
  let adminAToken: string;
  let managerAId: string;
  let managerAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let adminBId: string;
  let adminBToken: string;

  let categoryAId: string;
  let warehouseA1Id: string;
  let warehouseA2Id: string;
  let warehouseBId: string;
  let addressAId: string;

  let product1Id: string;
  let variant1Id: string;
  let inventory1Id: string;
  let product2Id: string;
  let variant2Id: string;
  let inventory2Id: string;

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

  const asAdminB = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${adminBToken}`);

  const checkoutOrder = async (
    items: Array<{ variantId: string; quantity: number }>,
    paymentMethod: PaymentMethod = PaymentMethod.CASH_ON_DELIVERY,
  ) => {
    for (const item of items) {
      const addRes = await asCustomerA(
        request(app).post('/api/v1/cart/items'),
      ).send({
        variantId: item.variantId,
        quantity: item.quantity,
      });
      expect(addRes.status).toBe(200);
    }

    const checkoutRes = await asCustomerA(request(app).post('/api/v1/checkout'))
      .set('Idempotency-Key', `cod-e2e-${crypto.randomUUID()}`)
      .send({
        shippingAddressId: addressAId,
        paymentMethod,
      });

    expect(checkoutRes.status).toBe(201);
    const data = checkoutRes.body.data as {
      order: {
        id: string;
        orderNumber: string;
        warehouseId: string;
        status: OrderStatus;
        paymentStatus: PaymentStatus;
        currency: string;
        totalAmount: string;
      };
      payment: {
        id: string;
        method: string;
        provider: string;
        status: PaymentStatus;
      };
    };
    return {
      ...data.order,
      payment: data.payment,
    };
  };

  const advanceOrderTo = async (
    orderId: string,
    target: 'PROCESSING' | 'SHIPPED' | 'DELIVERED',
  ) => {
    const steps: OrderStatus[] =
      target === 'PROCESSING'
        ? [OrderStatus.PROCESSING]
        : target === 'SHIPPED'
          ? [OrderStatus.PROCESSING, OrderStatus.SHIPPED]
          : [OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED];

    let lastRes: request.Response | undefined;
    for (const status of steps) {
      lastRes = await asManagerA(
        request(app).patch(`/api/v1/orders/${orderId}/status`),
      ).send({ status });
      expect(lastRes.status).toBe(200);
    }
    return lastRes!;
  };

  beforeAll(async () => {
    await testPrisma.$connect();
    await tenantA.create();
    await tenantB.create();

    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: 'COD test country',
        currencyCode: 'USD',
      },
    });

    const catA = await testPrisma.category.create({
      data: {
        tenantId: tenantA.id,
        name: `COD Cat ${runId}`,
        slug: `cod-cat-${runId}`,
      },
    });
    categoryAId = catA.id;

    const [ownerA, adminA, managerA, customerA, adminB] = await Promise.all([
      testPrisma.user.create({
        data: {
          email: `cod-owner-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Owner',
          lastName: 'A',
          role: 'ADMIN',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `cod-admin-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Admin',
          lastName: 'A',
          role: 'ADMIN',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `cod-manager-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Manager',
          lastName: 'A',
          role: 'MANAGER',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `cod-cust-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Customer',
          lastName: 'A',
          role: 'CUSTOMER',
          emailVerifiedAt: new Date(),
        },
      }),
      testPrisma.user.create({
        data: {
          email: `cod-admin-b-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Admin',
          lastName: 'B',
          role: 'ADMIN',
        },
      }),
    ]);

    ownerAId = ownerA.id;
    adminAId = adminA.id;
    managerAId = managerA.id;
    customerAId = customerA.id;
    adminBId = adminB.id;

    await testPrisma.tenantMember.createMany({
      data: [
        { tenantId: tenantA.id, userId: ownerAId, role: 'OWNER', status: 'ACTIVE' },
        { tenantId: tenantA.id, userId: adminAId, role: 'ADMIN', status: 'ACTIVE' },
        { tenantId: tenantA.id, userId: managerAId, role: 'MANAGER', status: 'ACTIVE' },
        { tenantId: tenantA.id, userId: customerAId, role: 'CUSTOMER', status: 'ACTIVE' },
        { tenantId: tenantB.id, userId: adminBId, role: 'ADMIN', status: 'ACTIVE' },
      ],
    });

    [ownerAToken, adminAToken, managerAToken, customerAToken, adminBToken] =
      await Promise.all([
        createAccessToken(ownerAId),
        createAccessToken(adminAId),
        createAccessToken(managerAId),
        createAccessToken(customerAId),
        createAccessToken(adminBId),
      ]);

    const whA1 = await fixtureWarehouse(tenantA.id);
    warehouseA1Id = whA1.id;
    await testPrisma.warehouseCoverage.upsert({
      where: {
        warehouseId_countryCode: { warehouseId: whA1.id, countryCode },
      },
      create: { tenantId: tenantA.id, warehouseId: whA1.id, countryCode },
      update: {},
    });

    const whA2 = await testPrisma.warehouse.create({
      data: {
        tenantId: tenantA.id,
        code: `COD-WH-A2-${runId}`,
        name: 'COD Warehouse Secondary',
        countryCode,
        city: 'Alexandria',
        address: '200 Corniche Rd',
        isActive: true,
        isDefault: false,
        priority: 2,
      },
    });
    warehouseA2Id = whA2.id;

    const whB = await fixtureWarehouse(tenantB.id);
    warehouseBId = whB.id;

    const taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId: tenantA.id, code: 'STANDARD', name: 'Standard' },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId: tenantA.id,
        countryCode,
        currency: 'USD',
        defaultTaxCategoryId: taxCategory.id,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: 0 },
    });

    const shippingProfile = await createShippingProfileFixture({
      data: { tenantId: tenantA.id, countryCode, currency: 'USD' },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: shippingProfile.id,
        code: `cod-zone-${runId}`,
        name: 'Default Zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'standard', name: 'Standard Delivery' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 0 },
    });

    const addrA = await testPrisma.address.create({
      data: {
        userId: customerAId,
        label: 'Home',
        firstName: 'COD',
        lastName: 'Customer',
        phone: '+201000000001',
        addressLine1: '10 Nile Street',
        city: 'Cairo',
        countryCode,
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
    addressAId = addrA.id;

    const p1 = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        categoryId: categoryAId,
        name: `COD Product One ${runId}`,
        slug: `cod-prod-1-${runId}`,
        basePrice: 50,
        status: 'ACTIVE',
      },
    });
    product1Id = p1.id;

    const v1 = await testPrisma.productVariant.create({
      data: {
        productId: product1Id,
        sku: `COD-SKU-1-${runId}`,
        combinationKey: 'default',
        price: 50,
        isActive: true,
      },
    });
    variant1Id = v1.id;

    const inv1 = await testPrisma.inventory.create({
      data: {
        tenantId: tenantA.id,
        warehouseId: warehouseA1Id,
        variantId: variant1Id,
        quantity: 200,
        reservedQuantity: 0,
      },
    });
    inventory1Id = inv1.id;

    const p2 = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        categoryId: categoryAId,
        name: `COD Product Two ${runId}`,
        slug: `cod-prod-2-${runId}`,
        basePrice: 30,
        status: 'ACTIVE',
      },
    });
    product2Id = p2.id;

    const v2 = await testPrisma.productVariant.create({
      data: {
        productId: product2Id,
        sku: `COD-SKU-2-${runId}`,
        combinationKey: 'default',
        price: 30,
        isActive: true,
      },
    });
    variant2Id = v2.id;

    const inv2 = await testPrisma.inventory.create({
      data: {
        tenantId: tenantA.id,
        warehouseId: warehouseA1Id,
        variantId: variant2Id,
        quantity: 200,
        reservedQuantity: 0,
      },
    });
    inventory2Id = inv2.id;
  });

  beforeEach(() => {
    // Fresh in-process limiter budgets per test case while middleware stays enabled.
    globalRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    globalRateLimiter.resetKey('127.0.0.1');
    sensitiveRateLimiter.resetKey(`${tenantA.id}:${customerAId}`);
    sensitiveRateLimiter.resetKey(`${tenantA.id}:${ownerAId}`);
    sensitiveRateLimiter.resetKey(`${tenantA.id}:${adminAId}`);
    sensitiveRateLimiter.resetKey(`${tenantA.id}:${managerAId}`);
    sensitiveRateLimiter.resetKey(`${tenantB.id}:${adminBId}`);
  });

  afterAll(async () => {
    const tenantIds = [tenantA.id, tenantB.id];
    const userIds = [ownerAId, adminAId, managerAId, customerAId, adminBId].filter(
      Boolean,
    );

    await testPrisma.notification.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.cartItem.deleteMany({
      where: { cart: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.cart.deleteMany({
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
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventory: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.inventory.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.productVariant.deleteMany({
      where: { product: { tenantId: { in: tenantIds } } },
    });
    await testPrisma.product.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.category.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.address.deleteMany({
      where: { userId: { in: userIds } },
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
    await testPrisma.warehouseCoverage.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.warehouse.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.tenantMember.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: tenantIds } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
    await testPrisma.country.deleteMany({
      where: { code: countryCode },
    });
    await testPrisma.$disconnect();
  });

  it('1. COD happy path: fulfills while PENDING, enforces DELIVERED-only cash confirmation, preserves metadata, derives age from DELIVERED history, commits SALE, and completes', async () => {
    const beforeInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });

    const order = await checkoutOrder([{ variantId: variant1Id, quantity: 2 }]);
    expect(order.status).toBe('CONFIRMED');
    expect(order.paymentStatus).toBe('PENDING');

    const initialPayment = await testPrisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const initialMetadata = initialPayment.metadata as Record<string, unknown>;
    expect(initialMetadata).toHaveProperty('shippingMethod');

    // Cannot confirm payment at CONFIRMED
    const confirmAtConfirmed = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: `cash-${order.id}`,
      collectedAmount: order.totalAmount,
      currency: order.currency,
    });
    expect(confirmAtConfirmed.status).toBe(409);
    expect(confirmAtConfirmed.body.code).toBe('ORDER_NOT_READY_FOR_COD_COLLECTION');

    // Progress CONFIRMED -> PROCESSING -> SHIPPED while PENDING
    const processingRes = await asManagerA(
      request(app).patch(`/api/v1/orders/${order.id}/status`),
    ).send({ status: 'PROCESSING' });
    expect(processingRes.status).toBe(200);
    expect(processingRes.body.data.status).toBe('PROCESSING');
    expect(processingRes.body.data.paymentStatus).toBe('PENDING');

    const confirmAtProcessing = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: `cash-${order.id}`,
      collectedAmount: order.totalAmount,
      currency: order.currency,
    });
    expect(confirmAtProcessing.status).toBe(409);
    expect(confirmAtProcessing.body.code).toBe('ORDER_NOT_READY_FOR_COD_COLLECTION');

    const shippedRes = await asManagerA(
      request(app).patch(`/api/v1/orders/${order.id}/status`),
    ).send({ status: 'SHIPPED' });
    expect(shippedRes.status).toBe(200);
    expect(shippedRes.body.data.codSummary).toMatchObject({
      isCod: true,
      collectionStatus: 'AWAITING_DELIVERY',
      canConfirmPayment: false,
      canMarkRefused: true,
      canConfirmReturn: false,
      deliveredAt: null,
      unpaidDeliveredAgeHours: null,
    });

    const confirmAtShipped = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: `cash-${order.id}`,
      collectedAmount: order.totalAmount,
      currency: order.currency,
    });
    expect(confirmAtShipped.status).toBe(409);
    expect(confirmAtShipped.body.code).toBe('ORDER_NOT_READY_FOR_COD_COLLECTION');

    // Progress SHIPPED -> DELIVERED; payment must remain PENDING
    const deliveredRes = await asManagerA(
      request(app).patch(`/api/v1/orders/${order.id}/status`),
    ).send({ status: 'DELIVERED' });
    expect(deliveredRes.status).toBe(200);
    expect(deliveredRes.body.data.status).toBe('DELIVERED');
    expect(deliveredRes.body.data.paymentStatus).toBe('PENDING');
    expect(deliveredRes.body.data.codSummary).toMatchObject({
      isCod: true,
      collectionStatus: 'AWAITING_COLLECTION',
      canConfirmPayment: true,
      canMarkRefused: false,
      canConfirmReturn: false,
    });
    expect(deliveredRes.body.data.codSummary.deliveredAt).toBeTruthy();

    // Verify unpaidDeliveredAgeHours comes from OrderStatusHistory, NOT Order.updatedAt
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3_600_000);
    await testPrisma.$executeRaw`
      UPDATE "Order" SET "updatedAt" = ${fiveDaysAgo} WHERE "id" = ${order.id}
    `;
    const afterUpdatedAtTouch = await asOwnerA(
      request(app).get(`/api/v1/orders/${order.id}`),
    );
    expect(afterUpdatedAtTouch.status).toBe(200);
    expect(afterUpdatedAtTouch.body.data.codSummary.unpaidDeliveredAgeHours).toBeLessThan(1);

    const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000);
    await testPrisma.orderStatusHistory.updateMany({
      where: { orderId: order.id, toStatus: OrderStatus.DELIVERED },
      data: { createdAt: sixHoursAgo },
    });
    const afterHistoryShift = await asOwnerA(
      request(app).get(`/api/v1/orders/${order.id}`),
    );
    expect(afterHistoryShift.status).toBe(200);
    expect(afterHistoryShift.body.data.codSummary.unpaidDeliveredAgeHours).toBeGreaterThanOrEqual(5.9);
    expect(afterHistoryShift.body.data.codSummary.unpaidDeliveredAgeHours).toBeLessThan(6.5);

    // Block DELIVERED -> COMPLETED while unpaid
    const prematureComplete = await asOwnerA(
      request(app).patch(`/api/v1/orders/${order.id}/status`),
    ).send({ status: 'COMPLETED' });
    expect(prematureComplete.status).toBe(409);
    expect(prematureComplete.body.code).toBe('COD_PAYMENT_CONFIRMATION_REQUIRED');

    // Reject amount and currency mismatch
    const wrongAmount = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: `cash-${order.id}`,
      collectedAmount: '1.00',
      currency: order.currency,
    });
    expect(wrongAmount.status).toBe(409);
    expect(wrongAmount.body.code).toBe('PAYMENT_AMOUNT_MISMATCH');

    const wrongCurrency = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: `cash-${order.id}`,
      collectedAmount: order.totalAmount,
      currency: 'EUR',
    });
    expect(wrongCurrency.status).toBe(409);
    expect(wrongCurrency.body.code).toBe('PAYMENT_CURRENCY_MISMATCH');

    // Confirm COD cash collection as OWNER
    const confirmRes = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: `cash-${order.id}`,
      collectedAmount: order.totalAmount,
      currency: order.currency,
      note: '  Collected by courier Ali  ',
    });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.paymentStatus).toBe('PAID');
    expect(confirmRes.body.data.paymentMethod).toBe('CASH_ON_DELIVERY');
    expect(confirmRes.body.data.codSummary).toMatchObject({
      isCod: true,
      collectionStatus: 'COLLECTED',
      canConfirmPayment: false,
      unpaidDeliveredAgeHours: null,
      collection: {
        referenceId: `cash-${order.id}`,
        currency: order.currency,
        collectedByUserId: ownerAId,
        note: 'Collected by courier Ali',
      },
    });

    // Verify existing Payment.metadata preserved non-destructively
    const paidPayment = await testPrisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const paidMeta = paidPayment.metadata as Record<string, unknown>;
    expect(paidMeta.shippingMethod).toBe(initialMetadata.shippingMethod);
    expect(paidMeta.shippingMethodName).toBe(initialMetadata.shippingMethodName);
    expect(paidMeta.codCollection).toBeTruthy();

    // Verify inventory SALE committed cleanly
    const afterInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });
    expect(afterInv.quantity).toBe(beforeInv.quantity - 2);
    expect(afterInv.reservedQuantity).toBe(beforeInv.reservedQuantity);

    const sales = await testPrisma.inventoryTransaction.findMany({
      where: { inventoryId: inventory1Id, referenceId: order.id, type: 'SALE' },
    });
    expect(sales).toHaveLength(1);
    expect(sales[0]!.quantity).toBe(2);

    // Verify OrderStatusHistory audit trail (note SHIPPED->DELIVERED was backdated 6h above)
    const history = await testPrisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history).toHaveLength(4);
    expect(history.map((h) => `${h.fromStatus}->${h.toStatus}`).sort()).toEqual(
      [
        'CONFIRMED->PROCESSING',
        'DELIVERED->DELIVERED',
        'PROCESSING->SHIPPED',
        'SHIPPED->DELIVERED',
      ],
    );
    const paymentConfirmHistory = history.find(
      (h) => h.fromStatus === 'DELIVERED' && h.toStatus === 'DELIVERED',
    );
    expect(paymentConfirmHistory?.changedByUserId).toBe(ownerAId);
    expect(paymentConfirmHistory?.reason).toContain(
      `COD_PAYMENT_CONFIRMED:cash-${order.id}`,
    );

    // Verify PAYMENT_PAID notification emitted
    const paidNotifications = await testPrisma.notification.findMany({
      where: {
        tenantId: tenantA.id,
        eventKey: `payment_paid_${paidPayment.id}`,
      },
    });
    expect(paidNotifications).toHaveLength(1);

    // Now DELIVERED -> COMPLETED succeeds
    const completeRes = await asManagerA(
      request(app).patch(`/api/v1/orders/${order.id}/status`),
    ).send({ status: 'COMPLETED' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('COMPLETED');

    // Verify additive projection in order list and sanitized customer /my view
    const listRes = await asOwnerA(request(app).get('/api/v1/orders?limit=20'));
    expect(listRes.status).toBe(200);
    const listed = listRes.body.data.items.find((o: { id: string }) => o.id === order.id);
    expect(listed.paymentMethod).toBe('CASH_ON_DELIVERY');
    expect(listed.codSummary.collectionStatus).toBe('COLLECTED');

    const customerRes = await asCustomerA(
      request(app).get(`/api/v1/orders/my/${order.id}`),
    );
    expect(customerRes.status).toBe(200);
    expect(customerRes.body.data.paymentMethod).toBe('CASH_ON_DELIVERY');
    expect(customerRes.body.data.codSummary).toMatchObject({
      isCod: true,
      collectionStatus: 'COLLECTED',
      canConfirmPayment: false,
      canMarkRefused: false,
      canConfirmReturn: false,
      collection: null,
      returnInfo: null,
    });
  });

  it('2. Single SALE despite concurrent and repeated confirmation + strict idempotency with normalized optional fields and conflicting references', async () => {
    const beforeInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });

    const order = await checkoutOrder([{ variantId: variant1Id, quantity: 3 }]);
    await advanceOrderTo(order.id, 'DELIVERED');

    const refId = `conc-cash-${order.id}`;
    const payloadA = {
      referenceId: refId,
      collectedAmount: order.totalAmount,
      currency: order.currency,
    };
    const payloadNormalized = {
      referenceId: refId,
      collectedAmount: `${Number(order.totalAmount).toFixed(2)}`,
      currency: order.currency,
      note: '   ',
    };

    const responses = await Promise.all([
      asOwnerA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`)).send(payloadA),
      asAdminA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`)).send(payloadA),
      asOwnerA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`)).send(payloadNormalized),
      asAdminA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`)).send(payloadNormalized),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatus).toBe('PAID');
    }

    const sales = await testPrisma.inventoryTransaction.findMany({
      where: { inventoryId: inventory1Id, referenceId: order.id, type: 'SALE' },
    });
    expect(sales).toHaveLength(1);
    expect(sales[0]!.quantity).toBe(3);

    const afterInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });
    expect(afterInv.quantity).toBe(beforeInv.quantity - 3);
    expect(afterInv.reservedQuantity).toBe(beforeInv.reservedQuantity);

    const paidNotifs = await testPrisma.notification.findMany({
      where: {
        tenantId: tenantA.id,
        eventKey: `payment_paid_${order.payment.id}`,
      },
    });
    expect(paidNotifs).toHaveLength(1);

    // Same referenceId with different note -> 409 IDEMPOTENCY_KEY_REUSED
    const sameRefDiffNote = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: refId,
      collectedAmount: order.totalAmount,
      currency: order.currency,
      note: 'Different note',
    });
    expect(sameRefDiffNote.status).toBe(409);
    expect(sameRefDiffNote.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Different referenceId -> 409 COD_PAYMENT_ALREADY_CONFIRMED
    const diffRef = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
    ).send({
      referenceId: `other-ref-${order.id}`,
      collectedAmount: order.totalAmount,
      currency: order.currency,
    });
    expect(diffRef.status).toBe(409);
    expect(diffRef.body.code).toBe('COD_PAYMENT_ALREADY_CONFIRMED');
  });

  it('3. Pre-shipment cancellation allowed at CONFIRMED and PROCESSING; generic SHIPPED/DELIVERED cancellation blocked', async () => {
    const beforeInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });

    // Cancel at CONFIRMED
    const orderConfirmed = await checkoutOrder([{ variantId: variant1Id, quantity: 2 }]);
    const cancelConfirmed = await asManagerA(
      request(app).patch(`/api/v1/orders/${orderConfirmed.id}/status`),
    ).send({ status: 'CANCELLED' });
    expect(cancelConfirmed.status).toBe(200);
    expect(cancelConfirmed.body.data.status).toBe('CANCELLED');
    expect(cancelConfirmed.body.data.paymentStatus).toBe('CANCELLED');
    expect(cancelConfirmed.body.data.codSummary.collectionStatus).toBe('CANCELLED');

    // Cancel at PROCESSING (pre-shipment unpaid COD)
    const orderProcessing = await checkoutOrder([{ variantId: variant1Id, quantity: 2 }]);
    await advanceOrderTo(orderProcessing.id, 'PROCESSING');
    const cancelProcessing = await asManagerA(
      request(app).patch(`/api/v1/orders/${orderProcessing.id}/status`),
    ).send({ status: 'CANCELLED' });
    expect(cancelProcessing.status).toBe(200);
    expect(cancelProcessing.body.data.status).toBe('CANCELLED');
    expect(cancelProcessing.body.data.paymentStatus).toBe('CANCELLED');

    const releasesProcessing = await testPrisma.inventoryTransaction.findMany({
      where: { inventoryId: inventory1Id, referenceId: orderProcessing.id, type: 'RELEASE' },
    });
    expect(releasesProcessing).toHaveLength(1);
    expect(releasesProcessing[0]!.quantity).toBe(2);

    // Generic SHIPPED -> CANCELLED blocked
    const orderShipped = await checkoutOrder([{ variantId: variant1Id, quantity: 1 }]);
    await advanceOrderTo(orderShipped.id, 'SHIPPED');
    const cancelShipped = await asOwnerA(
      request(app).patch(`/api/v1/orders/${orderShipped.id}/status`),
    ).send({ status: 'CANCELLED' });
    expect(cancelShipped.status).toBe(409);
    expect(cancelShipped.body.code).toBe('INVALID_ORDER_STATUS_TRANSITION');

    // Generic DELIVERED -> CANCELLED blocked
    await asManagerA(
      request(app).patch(`/api/v1/orders/${orderShipped.id}/status`),
    ).send({ status: 'DELIVERED' });
    const cancelDelivered = await asOwnerA(
      request(app).patch(`/api/v1/orders/${orderShipped.id}/status`),
    ).send({ status: 'CANCELLED' });
    expect(cancelDelivered.status).toBe(409);
    expect(cancelDelivered.body.code).toBe('INVALID_ORDER_STATUS_TRANSITION');

    // Inventory reflects only orderShipped still reserved (+1)
    const afterInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });
    expect(afterInv.quantity).toBe(beforeInv.quantity);
    expect(afterInv.reservedQuantity).toBe(beforeInv.reservedQuantity + 1);
  });

  it('4. Refusal while parcel remains with courier keeps reservation held, blocks DELIVERED, and allows verified RESELLABLE warehouse return', async () => {
    const beforeInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });

    const order = await checkoutOrder([{ variantId: variant1Id, quantity: 4 }]);
    await advanceOrderTo(order.id, 'SHIPPED');

    // Cannot confirm return before refusal
    const prematureReturn = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
    ).send({
      referenceId: `ret-${order.id}`,
      warehouseId: warehouseA1Id,
      receivedCondition: 'RESELLABLE',
      note: 'Premature return attempt',
    });
    expect(prematureReturn.status).toBe(409);
    expect(prematureReturn.body.code).toBe('COD_RETURN_REQUIRES_REFUSAL');

    // MANAGER marks delivery refused
    const refusalRef = `ref-${order.id}`;
    const refuseRes = await asManagerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
    ).send({
      referenceId: refusalRef,
      reason: 'Customer refused parcel at doorstep',
      courierReference: '  AWB-778899  ',
    });
    expect(refuseRes.status).toBe(200);
    expect(refuseRes.body.data.status).toBe('SHIPPED');
    expect(refuseRes.body.data.paymentStatus).toBe('PENDING');
    expect(refuseRes.body.data.codSummary).toMatchObject({
      isCod: true,
      collectionStatus: 'REFUSED_WITH_COURIER',
      canConfirmPayment: false,
      canMarkRefused: false,
      canConfirmReturn: true,
      returnInfo: {
        state: 'REFUSED_WITH_COURIER',
        refusalReferenceId: refusalRef,
        refusedByUserId: managerAId,
        reason: 'Customer refused parcel at doorstep',
        courierReference: 'AWB-778899',
        returnReferenceId: null,
      },
    });

    // Reservation MUST still be held (no RELEASE while parcel is with courier!)
    const duringRefusalInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });
    expect(duringRefusalInv.reservedQuantity).toBe(beforeInv.reservedQuantity + 4);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId: inventory1Id, referenceId: order.id, type: 'RELEASE' },
      }),
    ).toBe(0);

    // Idempotent retry of mark-refused succeeds; conflicting details fail
    const refuseReplay = await asManagerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
    ).send({
      referenceId: refusalRef,
      reason: 'Customer refused parcel at doorstep',
      courierReference: 'AWB-778899',
    });
    expect(refuseReplay.status).toBe(200);

    const refuseConflict = await asManagerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
    ).send({
      referenceId: refusalRef,
      reason: 'Different reason',
      courierReference: 'AWB-778899',
    });
    expect(refuseConflict.status).toBe(409);
    expect(refuseConflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // SHIPPED -> DELIVERED must be blocked after refusal
    const deliverAfterRefusal = await asOwnerA(
      request(app).patch(`/api/v1/orders/${order.id}/status`),
    ).send({ status: 'DELIVERED' });
    expect(deliverAfterRefusal.status).toBe(409);
    expect(deliverAfterRefusal.body.code).toBe('COD_DELIVERY_REFUSED_AWAITING_RETURN');

    // Wrong warehouse rejected
    const wrongWhReturn = await asAdminA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
    ).send({
      referenceId: `ret-${order.id}`,
      warehouseId: warehouseA2Id,
      receivedCondition: 'RESELLABLE',
      note: 'Returned to wrong warehouse',
    });
    expect(wrongWhReturn.status).toBe(409);
    expect(wrongWhReturn.body.code).toBe('RETURN_WAREHOUSE_MISMATCH');

    // Foreign tenant warehouse rejected
    const foreignWhReturn = await asAdminA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
    ).send({
      referenceId: `ret-${order.id}`,
      warehouseId: warehouseBId,
      receivedCondition: 'RESELLABLE',
      note: 'Foreign warehouse attempt',
    });
    expect(foreignWhReturn.status).toBe(404);
    expect(foreignWhReturn.body.code).toBe('WAREHOUSE_NOT_FOUND');

    // Verified RESELLABLE return by ADMIN
    const returnRef = `ret-resell-${order.id}`;
    const returnRes = await asAdminA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
    ).send({
      referenceId: returnRef,
      warehouseId: warehouseA1Id,
      receivedCondition: 'RESELLABLE',
      note: 'Box sealed and inspected at Cairo warehouse',
    });
    expect(returnRes.status).toBe(200);
    expect(returnRes.body.data.status).toBe('CANCELLED');
    expect(returnRes.body.data.paymentStatus).toBe('CANCELLED');
    expect(returnRes.body.data.codSummary).toMatchObject({
      isCod: true,
      collectionStatus: 'RETURNED_TO_WAREHOUSE',
      canConfirmPayment: false,
      canMarkRefused: false,
      canConfirmReturn: false,
      returnInfo: {
        state: 'RETURNED_TO_WAREHOUSE',
        refusalReferenceId: refusalRef,
        returnReferenceId: returnRef,
        returnedByUserId: adminAId,
        warehouseId: warehouseA1Id,
        receivedCondition: 'RESELLABLE',
        returnNote: 'Box sealed and inspected at Cairo warehouse',
      },
    });

    // Inventory fully restored to available stock
    const afterReturnInv = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventory1Id },
    });
    expect(afterReturnInv.quantity).toBe(beforeInv.quantity);
    expect(afterReturnInv.reservedQuantity).toBe(beforeInv.reservedQuantity);

    const txRows = await testPrisma.inventoryTransaction.findMany({
      where: {
        inventoryId: inventory1Id,
        referenceId: { in: [order.id, `cod-dmg:${order.id}`] },
      },
    });
    expect(txRows.filter((t) => t.type === 'RELEASE')).toHaveLength(1);
    expect(txRows.filter((t) => t.type === 'STOCK_OUT')).toHaveLength(0);
    expect(txRows.filter((t) => t.type === 'SALE')).toHaveLength(0);

    // Idempotent replay succeeds; conflicting condition fails
    const replayReturn = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
    ).send({
      referenceId: returnRef,
      warehouseId: warehouseA1Id,
      receivedCondition: 'RESELLABLE',
      note: 'Box sealed and inspected at Cairo warehouse',
    });
    expect(replayReturn.status).toBe(200);

    const conflictReturn = await asOwnerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
    ).send({
      referenceId: returnRef,
      warehouseId: warehouseA1Id,
      receivedCondition: 'DAMAGED',
      note: 'Box sealed and inspected at Cairo warehouse',
    });
    expect(conflictReturn.status).toBe(409);
    expect(conflictReturn.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('5. Damaged return with multi-item inventory accounting: atomic RELEASE + STOCK_OUT, zero damaged units become sellable, concurrent retries do not double deduct', async () => {
    const [beforeInv1, beforeInv2] = await Promise.all([
      testPrisma.inventory.findUniqueOrThrow({ where: { id: inventory1Id } }),
      testPrisma.inventory.findUniqueOrThrow({ where: { id: inventory2Id } }),
    ]);

    const order = await checkoutOrder([
      { variantId: variant1Id, quantity: 2 },
      { variantId: variant2Id, quantity: 3 },
    ]);
    await advanceOrderTo(order.id, 'SHIPPED');

    const [reservedInv1, reservedInv2] = await Promise.all([
      testPrisma.inventory.findUniqueOrThrow({ where: { id: inventory1Id } }),
      testPrisma.inventory.findUniqueOrThrow({ where: { id: inventory2Id } }),
    ]);
    const availBeforeReturn1 = reservedInv1.quantity - reservedInv1.reservedQuantity;
    const availBeforeReturn2 = reservedInv2.quantity - reservedInv2.reservedQuantity;

    const refuseRes = await asManagerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
    ).send({
      referenceId: `dmg-ref-${order.id}`,
      reason: 'Parcel crushed during courier transit',
    });
    expect(refuseRes.status).toBe(200);

    const returnPayload = {
      referenceId: `dmg-ret-${order.id}`,
      warehouseId: warehouseA1Id,
      receivedCondition: 'DAMAGED' as const,
      note: 'Water-damaged outer and inner packaging; unsellable',
    };

    // Fire 4 concurrent damaged-return confirmations
    const results = await Promise.all([
      asOwnerA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`)).send(returnPayload),
      asAdminA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`)).send(returnPayload),
      asOwnerA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`)).send(returnPayload),
      asAdminA(request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`)).send(returnPayload),
    ]);

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data.paymentStatus).toBe('CANCELLED');
      expect(res.body.data.codSummary.returnInfo.receivedCondition).toBe('DAMAGED');
    }

    const [afterInv1, afterInv2] = await Promise.all([
      testPrisma.inventory.findUniqueOrThrow({ where: { id: inventory1Id } }),
      testPrisma.inventory.findUniqueOrThrow({ where: { id: inventory2Id } }),
    ]);

    // Both SKUs decreased in physical quantity and reservedQuantity; available UNCHANGED!
    expect(afterInv1.quantity).toBe(beforeInv1.quantity - 2);
    expect(afterInv1.reservedQuantity).toBe(beforeInv1.reservedQuantity);
    expect(afterInv1.quantity - afterInv1.reservedQuantity).toBe(availBeforeReturn1);

    expect(afterInv2.quantity).toBe(beforeInv2.quantity - 3);
    expect(afterInv2.reservedQuantity).toBe(beforeInv2.reservedQuantity);
    expect(afterInv2.quantity - afterInv2.reservedQuantity).toBe(availBeforeReturn2);

    // Exact ledger sequence per SKU: 1 RESERVATION, 1 RELEASE(orderId), 1 STOCK_OUT(cod-dmg:orderId), 0 SALE
    for (const [invId, expectedQty] of [
      [inventory1Id, 2],
      [inventory2Id, 3],
    ] as const) {
      const txs = await testPrisma.inventoryTransaction.findMany({
        where: {
          inventoryId: invId,
          referenceId: { in: [order.id, `cod-dmg:${order.id}`] },
        },
      });
      const releases = txs.filter((t) => t.type === 'RELEASE');
      const stockOuts = txs.filter((t) => t.type === 'STOCK_OUT');
      const sales = txs.filter((t) => t.type === 'SALE');
      expect(releases).toHaveLength(1);
      expect(releases[0]!.quantity).toBe(expectedQty);
      expect(stockOuts).toHaveLength(1);
      expect(stockOuts[0]!.quantity).toBe(expectedQty);
      expect(stockOuts[0]!.referenceId).toBe(`cod-dmg:${order.id}`);
      expect(sales).toHaveLength(0);
    }

    // Exactly 1 ORDER_CANCELLED notification despite 4 concurrent calls
    const cancelNotifs = await testPrisma.notification.findMany({
      where: {
        tenantId: tenantA.id,
        eventKey: `order_cancelled_${order.id}`,
      },
    });
    expect(cancelNotifs).toHaveLength(1);
  });

  it('6. Rollback on partial inventory failure during multi-item damaged return leaves ALL items, order, payment, and notifications untouched', async () => {
    const order = await checkoutOrder([
      { variantId: variant1Id, quantity: 2 },
      { variantId: variant2Id, quantity: 2 },
    ]);
    await advanceOrderTo(order.id, 'SHIPPED');

    await asManagerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
    ).send({
      referenceId: `rb-ref-${order.id}`,
      reason: 'Customer refused damaged parcel',
    });

    // Determine which variant sorts second (matching inventory service lock ordering)
    const sorted = [
      { variantId: variant1Id, inventoryId: inventory1Id },
      { variantId: variant2Id, inventoryId: inventory2Id },
    ].sort((a, b) => a.variantId.localeCompare(b.variantId));
    const firstInvId = sorted[0]!.inventoryId;
    const secondInvId = sorted[1]!.inventoryId;

    const firstBefore = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: firstInvId },
    });
    const secondBefore = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: secondInvId },
    });

    // Corrupt second SKU's reservedQuantity so item #1 passes and item #2 fails
    await testPrisma.inventory.update({
      where: { id: secondInvId },
      data: { reservedQuantity: 0 },
    });

    try {
      const failRes = await asOwnerA(
        request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
      ).send({
        referenceId: `rb-ret-${order.id}`,
        warehouseId: warehouseA1Id,
        receivedCondition: 'DAMAGED',
        note: 'Partial inventory failure rollback test',
      });
      expect(failRes.status).toBe(409);
      expect(failRes.body.code).toBe('INVALID_INVENTORY_RELEASE');

      // Item #1 must be completely rolled back
      const firstAfter = await testPrisma.inventory.findUniqueOrThrow({
        where: { id: firstInvId },
      });
      expect(firstAfter.quantity).toBe(firstBefore.quantity);
      expect(firstAfter.reservedQuantity).toBe(firstBefore.reservedQuantity);

      // Zero RELEASE or STOCK_OUT rows created for either SKU
      const leakedTxs = await testPrisma.inventoryTransaction.findMany({
        where: {
          referenceId: { in: [order.id, `cod-dmg:${order.id}`] },
          type: { in: ['RELEASE', 'STOCK_OUT'] },
        },
      });
      expect(leakedTxs).toHaveLength(0);

      // Order & payment remain untouched at SHIPPED / PENDING / REFUSED_WITH_COURIER
      const persistedOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { payments: true },
      });
      expect(persistedOrder.status).toBe('SHIPPED');
      expect(persistedOrder.paymentStatus).toBe('PENDING');
      expect(persistedOrder.payments[0]!.status).toBe('PENDING');
      const meta = persistedOrder.payments[0]!.metadata as Record<string, unknown>;
      expect((meta.codReturn as Record<string, unknown>).state).toBe('REFUSED_WITH_COURIER');

      const cancelNotifs = await testPrisma.notification.findMany({
        where: {
          tenantId: tenantA.id,
          eventKey: `order_cancelled_${order.id}`,
        },
      });
      expect(cancelNotifs).toHaveLength(0);
    } finally {
      // Restore second SKU reservedQuantity so fixture stays clean
      await testPrisma.inventory.update({
        where: { id: secondInvId },
        data: { reservedQuantity: secondBefore.reservedQuantity },
      });
    }
  });

  it('7. Concurrency races: refusal vs DELIVERED and confirm-payment vs cancel/return never create conflicting SALE and RELEASE outcomes', async () => {
    // Race A: mark-refused vs PATCH status DELIVERED at SHIPPED
    const orderA = await checkoutOrder([{ variantId: variant1Id, quantity: 1 }]);
    await advanceOrderTo(orderA.id, 'SHIPPED');

    const [refuseRace, deliverRace] = await Promise.all([
      asManagerA(
        request(app).post(`/api/v1/orders/${orderA.id}/cod/mark-refused`),
      ).send({
        referenceId: `race-ref-${orderA.id}`,
        reason: 'Race refusal test',
      }),
      asManagerA(
        request(app).patch(`/api/v1/orders/${orderA.id}/status`),
      ).send({ status: 'DELIVERED' }),
    ]);

    const raceAStatuses = [refuseRace.status, deliverRace.status].sort();
    expect(raceAStatuses).toEqual([200, 409]);

    // Race B: confirm-payment vs confirm-return on a DELIVERED order
    const orderB = await checkoutOrder([{ variantId: variant1Id, quantity: 1 }]);
    await advanceOrderTo(orderB.id, 'DELIVERED');

    const [payRace, returnRace] = await Promise.all([
      asOwnerA(
        request(app).post(`/api/v1/orders/${orderB.id}/cod/confirm-payment`),
      ).send({
        referenceId: `race-pay-${orderB.id}`,
        collectedAmount: orderB.totalAmount,
        currency: orderB.currency,
      }),
      asOwnerA(
        request(app).post(`/api/v1/orders/${orderB.id}/cod/confirm-return`),
      ).send({
        referenceId: `race-ret-${orderB.id}`,
        warehouseId: warehouseA1Id,
        receivedCondition: 'RESELLABLE',
        note: 'Concurrent return attempt on delivered order',
      }),
    ]);

    expect(payRace.status).toBe(200);
    expect(returnRace.status).toBe(409);

    const bTxs = await testPrisma.inventoryTransaction.findMany({
      where: { inventoryId: inventory1Id, referenceId: orderB.id },
    });
    expect(bTxs.filter((t) => t.type === 'SALE')).toHaveLength(1);
    expect(bTxs.filter((t) => t.type === 'RELEASE')).toHaveLength(0);

    // Race C: confirm-payment vs pre-shipment cancellation at PROCESSING
    const orderC = await checkoutOrder([{ variantId: variant1Id, quantity: 1 }]);
    await advanceOrderTo(orderC.id, 'PROCESSING');

    const [payProcRace, cancelProcRace] = await Promise.all([
      asOwnerA(
        request(app).post(`/api/v1/orders/${orderC.id}/cod/confirm-payment`),
      ).send({
        referenceId: `race-proc-pay-${orderC.id}`,
        collectedAmount: orderC.totalAmount,
        currency: orderC.currency,
      }),
      asManagerA(
        request(app).patch(`/api/v1/orders/${orderC.id}/status`),
      ).send({ status: 'CANCELLED' }),
    ]);

    expect(payProcRace.status).toBe(409);
    expect(cancelProcRace.status).toBe(200);

    const cTxs = await testPrisma.inventoryTransaction.findMany({
      where: { inventoryId: inventory1Id, referenceId: orderC.id },
    });
    expect(cTxs.filter((t) => t.type === 'SALE')).toHaveLength(0);
    expect(cTxs.filter((t) => t.type === 'RELEASE')).toHaveLength(1);
  });

  it('8. RBAC & cross-tenant isolation: MANAGER blocked from confirm-payment & confirm-return, CUSTOMER blocked from all, Tenant B isolated', async () => {
    const order = await checkoutOrder([{ variantId: variant1Id, quantity: 1 }]);
    await advanceOrderTo(order.id, 'SHIPPED');

    // CUSTOMER blocked from mark-refused, confirm-return, confirm-payment
    expect(
      (
        await asCustomerA(
          request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
        ).send({ referenceId: `cust-ref-${order.id}`, reason: 'Customer test' })
      ).status,
    ).toBe(403);

    expect(
      (
        await asCustomerA(
          request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
        ).send({
          referenceId: `cust-ret-${order.id}`,
          warehouseId: warehouseA1Id,
          receivedCondition: 'RESELLABLE',
          note: 'Customer test',
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await asCustomerA(
          request(app).post(`/api/v1/orders/${order.id}/cod/confirm-payment`),
        ).send({
          referenceId: `cust-pay-${order.id}`,
          collectedAmount: order.totalAmount,
          currency: order.currency,
        })
      ).status,
    ).toBe(403);

    // MANAGER can mark-refused, but CANNOT confirm-return (403)
    const mgrRefuse = await asManagerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
    ).send({ referenceId: `mgr-ref-${order.id}`, reason: 'Refused at gate' });
    expect(mgrRefuse.status).toBe(200);

    const mgrReturn = await asManagerA(
      request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
    ).send({
      referenceId: `mgr-ret-${order.id}`,
      warehouseId: warehouseA1Id,
      receivedCondition: 'RESELLABLE',
      note: 'Manager attempt',
    });
    expect(mgrReturn.status).toBe(403);

    // MANAGER CANNOT confirm-payment (403) even on a DELIVERED order
    const deliveredOrder = await checkoutOrder([{ variantId: variant1Id, quantity: 1 }]);
    await advanceOrderTo(deliveredOrder.id, 'DELIVERED');

    const mgrPay = await asManagerA(
      request(app).post(`/api/v1/orders/${deliveredOrder.id}/cod/confirm-payment`),
    ).send({
      referenceId: `mgr-pay-${deliveredOrder.id}`,
      collectedAmount: deliveredOrder.totalAmount,
      currency: deliveredOrder.currency,
    });
    expect(mgrPay.status).toBe(403);

    // Cross-tenant Admin B gets 404 on Tenant A order IDs
    expect(
      (
        await asAdminB(
          request(app).post(`/api/v1/orders/${deliveredOrder.id}/cod/confirm-payment`),
        ).send({
          referenceId: `cross-pay-${deliveredOrder.id}`,
          collectedAmount: deliveredOrder.totalAmount,
          currency: deliveredOrder.currency,
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await asAdminB(
          request(app).post(`/api/v1/orders/${order.id}/cod/mark-refused`),
        ).send({ referenceId: `cross-ref-${order.id}`, reason: 'Cross tenant' })
      ).status,
    ).toBe(404);

    expect(
      (
        await asAdminB(
          request(app).post(`/api/v1/orders/${order.id}/cod/confirm-return`),
        ).send({
          referenceId: `cross-ret-${order.id}`,
          warehouseId: warehouseBId,
          receivedCondition: 'RESELLABLE',
          note: 'Cross tenant return',
        })
      ).status,
    ).toBe(404);

    // Tenant A admin targeting Tenant B slug -> rejected (401/403)
    const wrongSlugRes = await request(app)
      .post(`/api/v1/orders/${deliveredOrder.id}/cod/confirm-payment`)
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({
        referenceId: `wrong-slug-${deliveredOrder.id}`,
        collectedAmount: deliveredOrder.totalAmount,
        currency: deliveredOrder.currency,
      });
    expect(wrongSlugRes.status).toBe(401);
  });

  it('9. Non-COD regression: CARD orders still require PAID/AUTHORIZED before PROCESSING, reject all COD endpoints, and disallow PROCESSING -> CANCELLED', async () => {
    const cardOrder = await checkoutOrder(
      [{ variantId: variant1Id, quantity: 1 }],
      PaymentMethod.CARD,
    );
    expect(cardOrder.status).toBe('PENDING');
    expect(cardOrder.paymentStatus).toBe('PENDING');
    expect(cardOrder.payment.method).toBe(PaymentMethod.CARD);

    // Confirm order PENDING -> CONFIRMED
    const confirmCard = await asOwnerA(
      request(app).patch(`/api/v1/orders/${cardOrder.id}/status`),
    ).send({ status: 'CONFIRMED' });
    expect(confirmCard.status).toBe(200);
    expect(confirmCard.body.data.paymentMethod).toBe('CARD');
    expect(confirmCard.body.data.codSummary).toMatchObject({
      isCod: false,
      collectionStatus: 'NOT_APPLICABLE',
      canConfirmPayment: false,
      canMarkRefused: false,
      canConfirmReturn: false,
    });

    // CARD still blocked from PROCESSING while PENDING
    const processUnpaidCard = await asOwnerA(
      request(app).patch(`/api/v1/orders/${cardOrder.id}/status`),
    ).send({ status: 'PROCESSING' });
    expect(processUnpaidCard.status).toBe(409);
    expect(processUnpaidCard.body.code).toBe('PAYMENT_NOT_READY');

    // All 3 COD endpoints reject CARD orders with PAYMENT_METHOD_NOT_COD
    expect(
      (
        await asOwnerA(
          request(app).post(`/api/v1/orders/${cardOrder.id}/cod/confirm-payment`),
        ).send({
          referenceId: `card-pay-${cardOrder.id}`,
          collectedAmount: cardOrder.totalAmount,
          currency: cardOrder.currency,
        })
      ).body.code,
    ).toBe('PAYMENT_METHOD_NOT_COD');

    expect(
      (
        await asOwnerA(
          request(app).post(`/api/v1/orders/${cardOrder.id}/cod/mark-refused`),
        ).send({ referenceId: `card-ref-${cardOrder.id}`, reason: 'Card refusal' })
      ).body.code,
    ).toBe('PAYMENT_METHOD_NOT_COD');

    expect(
      (
        await asOwnerA(
          request(app).post(`/api/v1/orders/${cardOrder.id}/cod/confirm-return`),
        ).send({
          referenceId: `card-ret-${cardOrder.id}`,
          warehouseId: warehouseA1Id,
          receivedCondition: 'RESELLABLE',
          note: 'Card return',
        })
      ).body.code,
    ).toBe('PAYMENT_METHOD_NOT_COD');

    // Pay CARD order via trusted provider verification -> PROCESSING allowed, PROCESSING -> CANCELLED still forbidden
    const origCardPayment = await testPrisma.payment.findUniqueOrThrow({
      where: { id: cardOrder.payment.id },
    });
    await testPrisma.payment.delete({ where: { id: origCardPayment.id } });
    const mfCardPayment = await testPrisma.payment.create({
      data: {
        orderId: origCardPayment.orderId,
        provider: PaymentProvider.MYFATOORAH,
        method: origCardPayment.method,
        status: origCardPayment.status,
        amount: origCardPayment.amount,
        currency: origCardPayment.currency,
        initiationState: 'INITIATED',
        providerPaymentId: `card-inv-${runId}`,
      },
    });
    await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      mfCardPayment.id,
      {
        status: PaymentStatus.PAID,
        providerPaymentId: `card-inv-${runId}`,
        providerTransactionId: `card-tx-${runId}`,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: PaymentProvider.MYFATOORAH,
        providerPaymentId: `card-inv-${runId}`,
      },
    );

    const processPaidCard = await asOwnerA(
      request(app).patch(`/api/v1/orders/${cardOrder.id}/status`),
    ).send({ status: 'PROCESSING' });
    expect(processPaidCard.status).toBe(200);

    const cancelProcessingCard = await asOwnerA(
      request(app).patch(`/api/v1/orders/${cardOrder.id}/status`),
    ).send({ status: 'CANCELLED' });
    expect(cancelProcessingCard.status).toBe(409);
    expect(cancelProcessingCard.body.code).toBe('INVALID_ORDER_STATUS_TRANSITION');
  });
});
