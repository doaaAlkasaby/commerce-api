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
import { PaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { paymentService } from '../../src/modules/payments/payment.service.instance.js';
import { PaymentVerificationService } from '../../src/modules/payments/payment-verification.service.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import type { PaymentProviderAdapter } from '../../src/modules/payments/providers/payment-provider.js';
import { RecoveryRepository } from '../../src/modules/recovery/recovery.repository.js';
import { RecoveryService } from '../../src/modules/recovery/recovery.service.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

describe('Phase 2D.8 Step 2A — C-01 Payment Security Hardening', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const countryCode = `C${tenantA.id.slice(-7)}`.toUpperCase();

  let ownerAId: string;
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
    req.set('X-Tenant-Slug', tenantA.slug).set('Authorization', `Bearer ${ownerAToken}`);
  const asAdminA = (req: request.Test) =>
    req.set('X-Tenant-Slug', tenantA.slug).set('Authorization', `Bearer ${adminAToken}`);
  const asManagerA = (req: request.Test) =>
    req.set('X-Tenant-Slug', tenantA.slug).set('Authorization', `Bearer ${managerAToken}`);
  const asCustomerA = (req: request.Test) =>
    req.set('X-Tenant-Slug', tenantA.slug).set('Authorization', `Bearer ${customerAToken}`);
  const asOwnerB = (req: request.Test) =>
    req.set('X-Tenant-Slug', tenantB.slug).set('Authorization', `Bearer ${ownerBToken}`);

  const createUser = async (
    label: string,
    tenantId: string,
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER',
  ) => {
    const user = await testPrisma.user.create({
      data: {
        email: `c01-${label}-${runId}@example.com`,
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
    quantity = 2,
  ) => {
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity }),
    ).expect(200);

    const res = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `c01-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod,
          ...(paymentProvider ? { paymentProvider } : {}),
        }),
    ).expect(201);

    const payment = res.body.data.payment as {
      id: string;
      status: PaymentStatus;
      method: PaymentMethod;
      provider: PaymentProvider;
    };

    if (paymentProvider && payment.provider !== paymentProvider) {
      await testPrisma.payment.update({
        where: { id: payment.id },
        data: { provider: paymentProvider },
      });
      payment.provider = paymentProvider;
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
        request(app).patch(`/api/v1/orders/${orderId}/status`).send({ status: step }),
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
        name: `C01 Test Country ${runId}`,
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
        code: `c01-zone-${runId}`,
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

    ownerAId = ownerA.id;
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
        name: `C01 Category ${runId}`,
        slug: `c01-cat-${runId}`,
      },
    });

    const product = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        categoryId: category.id,
        name: `C01 Product ${runId}`,
        slug: `c01-prod-${runId}`,
        basePrice: '10.000',
        status: ProductStatus.ACTIVE,
      },
    });

    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `C01-SKU-${runId}`,
        combinationKey: '',
        price: '10.000',
        isDefault: true,
        isActive: true,
      },
    });
    variantId = variant.id;

    const inv = await testPrisma.inventory.create({
      data: {
        tenantId: tenantA.id,
        warehouseId: warehouseAId,
        variantId,
        quantity: 200,
        reservedQuantity: 0,
      },
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
      where: { payment: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } } },
    });
    await testPrisma.myFatoorahInvoice.deleteMany({
      where: { payment: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } } },
    });
    await testPrisma.orderStatusHistory.deleteMany({
      where: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
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

  it('1. MANAGER cannot manually mark COD PAID via PATCH /api/v1/payments/:id/status', async () => {
    const { order, payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY);
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

    const res = await asManagerA(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({ status: 'PAID' }),
    );
    expect(res.status).toBe(403);

    const dbPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const dbOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(dbPayment.status).toBe(PaymentStatus.PENDING);
    expect(dbOrder.paymentStatus).toBe(PaymentStatus.PENDING);
    expect(invAfter.quantity).toBe(invBefore.quantity);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: order.id },
      }),
    ).toBe(0);
  });

  it('2. OWNER/ADMIN cannot manually mark COD PAID before or after delivery, nor inject transition fields via HTTP', async () => {
    const { order, payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY);
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

    // Before delivery (CONFIRMED)
    const beforeOwner = await asOwnerA(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({
          status: 'PAID',
          transition: { kind: 'COD_CONFIRMATION', referenceId: 'spoof', actorUserId: 'spoof' },
        }),
    );
    expect(beforeOwner.status).toBe(409);
    expect(beforeOwner.body.code).toBe('COD_PAYMENT_CONFIRMATION_REQUIRED');

    // Advance to DELIVERED and retry via generic endpoint as ADMIN
    await advanceCodTo(order.id, 'DELIVERED');
    const afterAdmin = await asAdminA(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({ status: 'PAID' }),
    );
    expect(afterAdmin.status).toBe(409);
    expect(afterAdmin.body.code).toBe('COD_PAYMENT_CONFIRMATION_REQUIRED');

    // Also reject AUTHORIZED on COD
    const authAttempt = await asOwnerA(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({ status: 'AUTHORIZED' }),
    );
    expect(authAttempt.status).toBe(409);
    expect(authAttempt.body.code).toBe('COD_PAYMENT_CONFIRMATION_REQUIRED');

    const dbPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(dbPayment.status).toBe(PaymentStatus.PENDING);
    expect(invAfter.quantity).toBe(invBefore.quantity);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity);
  });

  it('3. Direct COD metadata forgery, replacement, and deletion are blocked', async () => {
    const { payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY);
    const beforeMeta = (
      await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    ).metadata;

    // Attempt forgery via PENDING -> PENDING no-op
    const forgeRes = await asOwnerA(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({
          status: 'PENDING',
          metadata: {
            codReturn: {
              state: 'REFUSED_WITH_COURIER',
              refusalReferenceId: 'forged-ref',
              refusedByUserId: 'forged-user',
              refusedAt: new Date().toISOString(),
              reason: 'Forged refusal',
            },
          },
        }),
    );
    expect(forgeRes.status).toBe(409);
    expect(forgeRes.body.code).toBe('COD_METADATA_IMMUTABLE');

    // Attempt deletion via metadata: null
    const deleteRes = await asAdminA(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({
          status: 'PENDING',
          metadata: null,
        }),
    );
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.code).toBe('COD_METADATA_IMMUTABLE');

    const afterPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(afterPayment.metadata).toEqual(beforeMeta);
    expect(afterPayment.status).toBe(PaymentStatus.PENDING);
  });

  it('4 & 5. CARD/MYFATOORAH/MOCK/BANK_TRANSFER cannot be manually marked PAID or AUTHORIZED', async () => {
    const cases: Array<{
      method: PaymentMethod;
      provider?: PaymentProvider;
      mockMetadata?: boolean;
    }> = [
      { method: PaymentMethod.CARD, provider: PaymentProvider.MYFATOORAH },
      {
        method: PaymentMethod.CARD,
        provider: PaymentProvider.MYFATOORAH,
        mockMetadata: true,
      },
      { method: PaymentMethod.CARD, provider: PaymentProvider.NONE },
      { method: PaymentMethod.BANK_TRANSFER, provider: PaymentProvider.NONE },
    ];

    for (const item of cases) {
      const { order, payment } = await checkoutOrder(item.method, item.provider, 1);
      if (item.mockMetadata) {
        await testPrisma.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: `mock-inv-${payment.id}`,
            metadata: { environment: 'mock', mockStatus: 'REQUIRES_ACTION' },
          },
        });
      }
      const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

      for (const forbiddenStatus of ['PAID', 'AUTHORIZED'] as const) {
        const res = await asOwnerA(
          request(app)
            .patch(`/api/v1/payments/${payment.id}/status`)
            .send({ status: forbiddenStatus }),
        );
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('PAYMENT_PROVIDER_VERIFICATION_REQUIRED');
      }

      // MANAGER gets 403
      const mgrRes = await asManagerA(
        request(app)
          .patch(`/api/v1/payments/${payment.id}/status`)
          .send({ status: 'PAID' }),
      );
      expect(mgrRes.status).toBe(403);

      const dbPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const dbOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
      expect(dbPayment.status).toBe(PaymentStatus.PENDING);
      expect(dbOrder.paymentStatus).toBe(PaymentStatus.PENDING);
      expect(invAfter.quantity).toBe(invBefore.quantity);
      expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity);
    }
  });

  it('6. Dedicated COD confirmation still succeeds after DELIVERED and commits exactly one SALE', async () => {
    const { order, payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 2);
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

    await advanceCodTo(order.id, 'DELIVERED');

    const confirmRes = await asAdminA(
      request(app)
        .post(`/api/v1/orders/${order.id}/cod/confirm-payment`)
        .send({
          referenceId: `cod-confirm-${order.id}`,
          collectedAmount: order.totalAmount,
          currency: order.currency,
          note: 'Cash verified at handover',
        }),
    );
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.paymentStatus).toBe('PAID');

    const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(invAfter.quantity).toBe(invBefore.quantity - 2);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity - 2);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: order.id },
      }),
    ).toBe(1);

    const dbPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(dbPayment.status).toBe(PaymentStatus.PAID);
  });

  it('7. Authoritative provider verification succeeds and commits exactly one SALE', async () => {
    const { order, payment } = await checkoutOrder(
      PaymentMethod.CARD,
      PaymentProvider.MYFATOORAH,
      2,
    );
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    const invoiceId = `${Math.floor(100000000 + Math.random() * 899999999)}`;

    await testPrisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: invoiceId,
        initiationState: 'INITIATED',
      },
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
        transactionPaymentId: '99887766',
        transactionPaymentIds: ['99887766'],
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

    const verified = await verifier.verifyForUser(tenantA.id, customerAId, payment.id);
    expect(verified.status).toBe(PaymentStatus.PAID);

    // Second verification is idempotent and does not double-commit SALE
    await verifier.verifyForUser(tenantA.id, customerAId, payment.id);

    const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(invAfter.quantity).toBe(invBefore.quantity - 2);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity - 2);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: order.id },
      }),
    ).toBe(1);
  });

  it('8. Payment initiation remains functional via trusted PROVIDER_INITIATION boundary', async () => {
    const { payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 1);

    const res = await asCustomerA(
      request(app).post(`/api/v1/payments/${payment.id}/initiate`).send({}),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: payment.id,
      status: 'PENDING',
      initiationState: 'INITIATED',
    });
  });

  it('9. Valid payment cancellation and reservation release remain functional', async () => {
    const { order, payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 2);
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

    // Order cancellation via MANAGER on CONFIRMED COD order releases reservation
    const cancelOrder = await asManagerA(
      request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .send({ status: 'CANCELLED' }),
    );
    expect(cancelOrder.status).toBe(200);
    expect(cancelOrder.body.data.paymentStatus).toBe('CANCELLED');

    const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(invAfter.quantity).toBe(invBefore.quantity);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity - 2);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: order.id },
      }),
    ).toBe(1);

    // Direct POST /payments/:id/cancel on an unpaid CONFIRMED COD order retains existing semantics
    const second = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 1);
    const cancelPaymentRes = await asManagerA(
      request(app).post(`/api/v1/payments/${second.payment.id}/cancel`),
    );
    expect(cancelPaymentRes.status).toBe(200);
    expect(cancelPaymentRes.body.data.status).toBe('CANCELLED');

    // Direct POST /payments/:id/cancel on a SHIPPED COD order is still blocked
    const shipped = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 1);
    await advanceCodTo(shipped.order.id, 'SHIPPED');
    const shippedCancelRes = await asManagerA(
      request(app).post(`/api/v1/payments/${shipped.payment.id}/cancel`),
    );
    expect(shippedCancelRes.status).toBe(409);
    expect(shippedCancelRes.body.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    expect(
      (await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    ).toBe(PaymentStatus.CANCELLED);
  });

  it('10. Recovery worker expires pending unpaid card orders and ignores active COD orders', async () => {
    const cod = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 1);
    const card = await checkoutOrder(PaymentMethod.CARD, PaymentProvider.NONE, 2);
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

    await testPrisma.$executeRaw`UPDATE "Order" SET "reservationExpiresAt" = clock_timestamp() - interval '5 seconds' WHERE "id" = ${card.order.id}`;

    const repo = new RecoveryRepository(testPrisma);
    await repo.enqueue(50);

    expect(
      await testPrisma.recoveryJob.findUnique({ where: { orderId: cod.order.id } }),
    ).toBeNull();

    const cardJob = await testPrisma.recoveryJob.findUniqueOrThrow({
      where: { orderId: card.order.id },
    });
    const claimed = await repo.claim(10, 60_000);
    const targetJob = claimed.find((j) => j.id === cardJob.id)!;
    expect(targetJob).toBeDefined();

    const recovery = new RecoveryService(repo);
    expect(await recovery.process(targetJob)).toBe('EXPIRED');

    const dbCardOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: card.order.id } });
    const dbCodOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: cod.order.id } });
    expect(dbCardOrder.status).toBe(OrderStatus.CANCELLED);
    expect(dbCardOrder.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(dbCodOrder.status).toBe(OrderStatus.CONFIRMED);
    expect(dbCodOrder.paymentStatus).toBe(PaymentStatus.PENDING);

    const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity - 2);
  });

  it('11. Existing refund workflows remain functional via trusted PAYMENT_REFUND boundary', async () => {
    const { order, payment } = await checkoutOrder(
      PaymentMethod.CARD,
      PaymentProvider.MYFATOORAH,
      1,
    );
    const mockInvoiceId = `mock-inv-${payment.id}`;

    await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      payment.id,
      {
        status: PaymentStatus.PAID,
        providerPaymentId: mockInvoiceId,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: PaymentProvider.MYFATOORAH,
        providerPaymentId: mockInvoiceId,
      },
    );

    const refundAdapter: PaymentProviderAdapter = {
      provider: PaymentProvider.MYFATOORAH,
      supportsIdempotentInitiation: true,
      supportsRefunds: true,
      createPayment: async () => ({ status: PaymentStatus.REQUIRES_ACTION }),
      cancelPayment: async () => ({ status: PaymentStatus.CANCELLED }),
      executeRefund: async (input) => ({
        outcome: 'SUCCEEDED',
        refundId: input.refundId,
        originalProviderPaymentId: input.providerPaymentId,
        amount: input.amount,
        currency: input.currency,
        providerRefundId: `ref-${mockInvoiceId}`,
        providerRefundReference: `ref-no-${mockInvoiceId}`,
      }),
      refundPayment: async () => ({
        status: PaymentStatus.REFUNDED,
        providerTransactionId: `ref-${mockInvoiceId}`,
      }),
    };
    class RefundRegistry extends PaymentProviderRegistry {
      override getProvider() {
        return refundAdapter;
      }
    }
    const localPaymentService = new PaymentService(undefined, new RefundRegistry());
    const refunded = await localPaymentService.refundPayment(
      tenantA.id,
      payment.id,
      order.totalAmount,
      {
        idempotencyKey: `c01-ref-${payment.id}`,
        reason: 'Authorized full refund via ledger boundary',
        requestedByUserId: ownerAId,
      },
    );
    expect(refunded.payment.status).toBe(PaymentStatus.REFUNDED);
    expect(refunded.refund.status).toBe('SUCCEEDED');

    const dbOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(dbOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);
  });

  it('12. Cross-tenant payment mutations are rejected with zero side effects', async () => {
    const { payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 1);

    const crossStatus = await asOwnerB(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({ status: 'FAILED' }),
    );
    expect(crossStatus.status).toBe(404);

    const crossPaid = await asOwnerB(
      request(app)
        .patch(`/api/v1/payments/${payment.id}/status`)
        .send({ status: 'PAID' }),
    );
    expect(crossPaid.status).toBe(404);

    const dbPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(dbPayment.status).toBe(PaymentStatus.PENDING);
  });

  it('13 & 14. Concurrent transitions preserve locking, idempotency, and leave DB unchanged on failed transitions', async () => {
    const { order, payment } = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 2);
    await advanceCodTo(order.id, 'DELIVERED');
    const invBefore = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    const ref = `conc-cod-${order.id}`;

    const [confirmA, confirmB, manualBypass] = await Promise.all([
      asOwnerA(
        request(app)
          .post(`/api/v1/orders/${order.id}/cod/confirm-payment`)
          .send({
            referenceId: ref,
            collectedAmount: order.totalAmount,
            currency: order.currency,
          }),
      ),
      asAdminA(
        request(app)
          .post(`/api/v1/orders/${order.id}/cod/confirm-payment`)
          .send({
            referenceId: ref,
            collectedAmount: order.totalAmount,
            currency: order.currency,
          }),
      ),
      asOwnerA(
        request(app)
          .patch(`/api/v1/payments/${payment.id}/status`)
          .send({ status: 'PAID' }),
      ),
    ]);

    expect(confirmA.status).toBe(200);
    expect(confirmB.status).toBe(200);
    expect(manualBypass.status).toBe(409);
    expect(manualBypass.body.code).toBe('COD_PAYMENT_CONFIRMATION_REQUIRED');

    const invAfter = await testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(invAfter.quantity).toBe(invBefore.quantity - 2);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity - 2);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: order.id },
      }),
    ).toBe(1);
  });

  it('15. Legacy service/repository delegates and forged internal transitions cannot bypass the boundary', async () => {
    const cod = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 1);
    const card = await checkoutOrder(PaymentMethod.CARD, PaymentProvider.MYFATOORAH, 1);
    const repo = new PaymentRepository();

    // Legacy PaymentService.updatePaymentStatus is fail-closed
    await expect(
      paymentService.updatePaymentStatus(tenantA.id, cod.payment.id, {
        status: PaymentStatus.PAID,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'COD_PAYMENT_CONFIRMATION_REQUIRED',
    });
    await expect(
      paymentService.updatePaymentStatus(tenantA.id, card.payment.id, {
        status: PaymentStatus.PAID,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
    });

    // Legacy PaymentRepository.updateStatus and updateStatusWithClient are fail-closed
    await expect(
      repo.updateStatus(tenantA.id, cod.payment.id, { status: PaymentStatus.PAID }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'COD_PAYMENT_CONFIRMATION_REQUIRED',
    });
    await expect(
      testPrisma.$transaction((tx) =>
        repo.updateStatusWithClient(
          tenantA.id,
          card.payment.id,
          { status: PaymentStatus.AUTHORIZED },
          tx,
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
    });

    // Source string alone is NOT proof: COD_CONFIRMATION fails before DELIVERED or without valid metadata
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        cod.payment.id,
        { status: PaymentStatus.PAID },
        { kind: 'COD_CONFIRMATION', referenceId: 'fake-ref', actorUserId: 'fake-user' },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'COD_PAYMENT_CONFIRMATION_REQUIRED',
    });

    // Source string alone is NOT proof: PROVIDER_VERIFICATION fails on COD or provider NONE
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        cod.payment.id,
        { status: PaymentStatus.PAID, providerPaymentId: 'inv-1' },
        {
          kind: 'PROVIDER_VERIFICATION',
          provider: PaymentProvider.NONE,
          providerPaymentId: 'inv-1',
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
    });

    // Confirm no DB state changed on either payment
    expect(
      (await testPrisma.payment.findUniqueOrThrow({ where: { id: cod.payment.id } })).status,
    ).toBe(PaymentStatus.PENDING);
    expect(
      (await testPrisma.payment.findUniqueOrThrow({ where: { id: card.payment.id } })).status,
    ).toBe(PaymentStatus.PENDING);
  });

  it('16. H-04A: OWNER/ADMIN/MANAGER cannot fabricate refund statuses via PATCH /payments/:id/status on CARD or COD', async () => {
    // Prepare one PAID CARD payment and one PAID COD payment
    const card = await checkoutOrder(PaymentMethod.CARD, PaymentProvider.MYFATOORAH, 1);
    const cardInvoiceId = `h04a-inv-${card.payment.id}`;
    await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      card.payment.id,
      { status: PaymentStatus.PAID, providerPaymentId: cardInvoiceId },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: PaymentProvider.MYFATOORAH,
        providerPaymentId: cardInvoiceId,
      },
    );

    const cod = await checkoutOrder(PaymentMethod.CASH_ON_DELIVERY, undefined, 1);
    await advanceCodTo(cod.order.id, 'DELIVERED');
    await asOwnerA(
      request(app)
        .post(`/api/v1/orders/${cod.order.id}/cod/confirm-payment`)
        .send({
          referenceId: `h04a-cod-pay-${cod.order.id}`,
          collectedAmount: cod.order.totalAmount,
          currency: cod.order.currency,
        }),
    ).expect(200);

    const invBefore = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    for (const target of [
      { label: 'CARD', orderId: card.order.id, paymentId: card.payment.id },
      { label: 'COD', orderId: cod.order.id, paymentId: cod.payment.id },
    ]) {
      const notifBefore = await testPrisma.notification.count({
        where: { tenantId: tenantA.id, data: { path: ['orderId'], equals: target.orderId } },
      });

      for (const refundStatus of ['REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const) {
        for (const actor of [asOwnerA, asAdminA]) {
          const res = await actor(
            request(app)
              .patch(`/api/v1/payments/${target.paymentId}/status`)
              .send({ status: refundStatus, refundAmount: '1.000' }),
          );
          expect(res.status, `${target.label} ${refundStatus}`).toBe(409);
          expect(res.body.code).toBe('PAYMENT_REFUND_VERIFICATION_REQUIRED');
        }

        const mgrRes = await asManagerA(
          request(app)
            .patch(`/api/v1/payments/${target.paymentId}/status`)
            .send({ status: refundStatus }),
        );
        expect(mgrRes.status).toBe(403);
      }

      const dbPayment = await testPrisma.payment.findUniqueOrThrow({
        where: { id: target.paymentId },
      });
      const dbOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: target.orderId },
      });
      expect(dbPayment.status).toBe(PaymentStatus.PAID);
      expect(dbOrder.paymentStatus).toBe(PaymentStatus.PAID);
      expect(
        await testPrisma.notification.count({
          where: { tenantId: tenantA.id, data: { path: ['orderId'], equals: target.orderId } },
        }),
      ).toBe(notifBefore);
    }

    // COD POST /api/v1/payments/:id/refund must be explicitly rejected with 409 COD_REFUND_WORKFLOW_REQUIRED
    const codRefundHttp = await asOwnerA(
      request(app)
        .post(`/api/v1/payments/${cod.payment.id}/refund`)
        .send({ amount: cod.order.totalAmount }),
    );
    expect(codRefundHttp.status).toBe(409);
    expect(codRefundHttp.body.code).toBe('COD_REFUND_WORKFLOW_REQUIRED');

    // Trusted PAYMENT_REFUND on COD must also be blocked
    await expect(
      paymentService.applyTrustedPaymentStatus(
        tenantA.id,
        cod.payment.id,
        { status: PaymentStatus.REFUNDED, refundAmount: cod.order.totalAmount },
        { kind: 'PAYMENT_REFUND' },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'COD_REFUND_WORKFLOW_REQUIRED',
    });

    // Inventory must not be restocked or altered by any rejected refund attempt
    const invAfter = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(invAfter.quantity).toBe(invBefore.quantity);
    expect(invAfter.reservedQuantity).toBe(invBefore.reservedQuantity);
  });

  it('17. H-04A: Trusted partial refund validation enforces positive, sub-total, currency-precise amounts and blocks PROVIDER_VERIFICATION refunds', async () => {
    const card = await checkoutOrder(PaymentMethod.CARD, PaymentProvider.MYFATOORAH, 1);
    const invoiceId = `h04a-val-inv-${card.payment.id}`;
    await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      card.payment.id,
      { status: PaymentStatus.PAID, providerPaymentId: invoiceId },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: PaymentProvider.MYFATOORAH,
        providerPaymentId: invoiceId,
      },
    );

    const notifBefore = await testPrisma.notification.count({
      where: { tenantId: tenantA.id, data: { path: ['orderId'], equals: card.order.id } },
    });

    // PROVIDER_VERIFICATION cannot emit refund statuses
    for (const refundStatus of [
      PaymentStatus.REFUND_PENDING,
      PaymentStatus.PARTIALLY_REFUNDED,
      PaymentStatus.REFUNDED,
    ]) {
      await expect(
        paymentService.applyTrustedPaymentStatus(
          tenantA.id,
          card.payment.id,
          { status: refundStatus, refundAmount: '1.000' },
          {
            kind: 'PROVIDER_VERIFICATION',
            provider: PaymentProvider.MYFATOORAH,
            providerPaymentId: invoiceId,
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
      });
    }

    // Invalid partial refund amounts fail with 400 before any DB or notification write
    for (const badAmount of [
      undefined,
      '',
      '   ',
      '0',
      '-5.000',
      card.order.totalAmount,
      '999.000',
      '1.1234', // KWD supports max 3 decimal places
    ]) {
      await expect(
        paymentService.applyTrustedPaymentStatus(
          tenantA.id,
          card.payment.id,
          {
            status: PaymentStatus.PARTIALLY_REFUNDED,
            ...(badAmount === undefined ? {} : { refundAmount: badAmount }),
          },
          { kind: 'PAYMENT_REFUND' },
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    }

    // Over-precision refund amount on POST /api/v1/payments/:id/refund fails with 400
    const badPrecisionHttp = await asOwnerA(
      request(app)
        .post(`/api/v1/payments/${card.payment.id}/refund`)
        .send({ amount: '1.1234' }),
    );
    expect(badPrecisionHttp.status).toBe(400);

    // State and notifications remain unchanged after all invalid attempts
    expect(
      (await testPrisma.payment.findUniqueOrThrow({ where: { id: card.payment.id } })).status,
    ).toBe(PaymentStatus.PAID);
    expect(
      (await testPrisma.order.findUniqueOrThrow({ where: { id: card.order.id } })).paymentStatus,
    ).toBe(PaymentStatus.PAID);
    expect(
      await testPrisma.notification.count({
        where: { tenantId: tenantA.id, data: { path: ['orderId'], equals: card.order.id } },
      }),
    ).toBe(notifBefore);

    // Valid trusted PAYMENT_REFUND to PARTIALLY_REFUNDED with persisted ledger proof succeeds and creates exact-amount notification
    const seededPartialRefund = await testPrisma.paymentRefund.create({
      data: {
        tenantId: tenantA.id,
        paymentId: card.payment.id,
        orderId: card.order.id,
        provider: PaymentProvider.MYFATOORAH,
        method: PaymentMethod.CARD,
        amount: '2.500',
        currency: 'KWD',
        status: 'SUCCEEDED',
        idempotencyKey: `h04a-partial-${card.payment.id}`,
        requestFingerprint: `fp-h04a-${card.payment.id}`,
        providerRefundId: `ref-partial-${card.payment.id}`,
        reason: 'Authorized H-04A partial refund verification',
        requestedByUserId: ownerAId,
        submittedAt: new Date(),
        completedAt: new Date(),
      },
    });
    const partial = await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      card.payment.id,
      {
        status: PaymentStatus.PARTIALLY_REFUNDED,
        refundId: seededPartialRefund.id,
        refundAmount: '2.500',
        providerTransactionId: `ref-partial-${card.payment.id}`,
      },
      { kind: 'PAYMENT_REFUND', refundId: seededPartialRefund.id },
    );
    expect(partial.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);

    const notifs = await testPrisma.notification.findMany({
      where: { tenantId: tenantA.id, data: { path: ['orderId'], equals: card.order.id } },
      orderBy: { createdAt: 'asc' },
    });
    expect(notifs).toHaveLength(notifBefore + 1);
    expect((notifs.at(-1)!.data as Record<string, unknown>).amount).toBe('2.500');
    expect((notifs.at(-1)!.data as Record<string, unknown>).eventType).toBe(
      'PAYMENT_PARTIALLY_REFUNDED',
    );
  });
});
