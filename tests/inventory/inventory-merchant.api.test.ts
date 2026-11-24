import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';
import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { testPrisma } from '../../src/config/test-database.js';
import {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../src/generated/prisma/client.js';
import { paymentService } from '../../src/modules/payments/payment.service.instance.js';

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...original,
    env: {
      ...original.env,
      PAYMENT_PROVIDER: 'MOCK',
      MOCK_CHECKOUT_SECRET: 'inventory-fixture-only-mock-secret',
    },
  };
});

describe('Phase 2D.5B — Warehouse Inventory Management API', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const countryCode = `I${tenantA.id.slice(-7)}`.toUpperCase();

  let adminAId: string;
  let adminAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let adminBId: string;
  let adminBToken: string;
  let categoryAId: string;
  let warehouseA1Id: string;
  let warehouseA2Id: string;
  let warehouseBId: string;
  let addressAId: string;

  const asAdminA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${adminAToken}`);
  const asCustomerA = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerAToken}`);
  const asAdminB = (req: request.Test) =>
    req
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${adminBToken}`);

  beforeAll(async () => {
    await testPrisma.$connect();
    await tenantA.create();
    await tenantB.create();

    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: 'Inventory test country',
        currencyCode: 'USD',
      },
    });

    const catA = await testPrisma.category.create({
      data: {
        tenantId: tenantA.id,
        name: `Inv Cat A ${runId}`,
        slug: `inv-cat-a-${runId}`,
      },
    });
    categoryAId = catA.id;

    const [adminA, customerA, adminB] = await Promise.all([
      testPrisma.user.create({
        data: {
          email: `inv-admin-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Admin',
          lastName: 'A',
          role: 'ADMIN',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `inv-cust-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Customer',
          lastName: 'A',
          role: 'CUSTOMER',
          emailVerifiedAt: new Date(),
        },
      }),
      testPrisma.user.create({
        data: {
          email: `inv-admin-b-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Admin',
          lastName: 'B',
          role: 'ADMIN',
        },
      }),
    ]);
    adminAId = adminA.id;
    customerAId = customerA.id;
    adminBId = adminB.id;

    [adminAToken, customerAToken, adminBToken] = await Promise.all([
      createAccessToken(adminA.id),
      createAccessToken(customerA.id),
      createAccessToken(adminB.id),
    ]);

    await Promise.all([
      testPrisma.tenantMember.create({
        data: { tenantId: tenantA.id, userId: adminA.id, role: 'OWNER' },
      }),
      testPrisma.tenantMember.create({
        data: { tenantId: tenantA.id, userId: customerA.id, role: 'CUSTOMER' },
      }),
      testPrisma.tenantMember.create({
        data: { tenantId: tenantB.id, userId: adminB.id, role: 'ADMIN' },
      }),
    ]);

    const whA1 = await fixtureWarehouse(tenantA.id, {
      code: `WH-A1-${runId.slice(-6)}`,
      name: 'Primary Warehouse A',
      countryCode,
      isDefault: true,
      isActive: true,
      priority: 1,
    });
    await testPrisma.warehouse.update({
      where: { id: whA1.id },
      data: { name: 'Primary Warehouse A' },
    });
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
        code: `WH-A2-${runId.slice(-6)}`,
        name: 'Secondary Warehouse A',
        countryCode,
        city: 'Branch City',
        address: '200 Branch Rd',
        isDefault: false,
        isActive: true,
        priority: 2,
      },
    });
    warehouseA2Id = whA2.id;

    const whB = await fixtureWarehouse(tenantB.id, {
      code: `WH-B1-${runId.slice(-6)}`,
      name: 'Warehouse B',
      countryCode,
      isDefault: true,
      isActive: true,
    });
    warehouseBId = whB.id;

    // Tax & shipping profile for checkout / payment / cancellation lifecycle tests
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
        code: `inv-zone-${runId}`,
        name: 'Default Zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'standard', name: 'Standard' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 0 },
    });

    const address = await testPrisma.address.create({
      data: {
        userId: customerA.id,
        label: 'Home',
        firstName: 'Customer',
        lastName: 'A',
        phone: '+12025550101',
        addressLine1: '100 Main St',
        city: 'City',
        countryCode,
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
    addressAId = address.id;
  });

  afterAll(async () => {
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: tenantA.id } },
    });
    await testPrisma.order.deleteMany({ where: { tenantId: tenantA.id } });
    await testPrisma.cart.deleteMany({ where: { tenantId: tenantA.id } });
    await testPrisma.taxProfile.deleteMany({ where: { tenantId: tenantA.id } });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: tenantA.id } },
    });
    await testPrisma.taxCategory.deleteMany({
      where: { tenantId: tenantA.id },
    });
    await testPrisma.address.deleteMany({ where: { id: addressAId } });
    await tenantA.cleanup();
    await tenantB.cleanup();
    await testPrisma.user.deleteMany({
      where: { id: { in: [adminAId, customerAId, adminBId].filter(Boolean) } },
    });
    await testPrisma.country.deleteMany({ where: { code: countryCode } });
    await testPrisma.$disconnect();
  });

  it('supports DRAFT/INACTIVE init with atomic opening ledger, blocks ARCHIVED/inactive variants, enforces idempotency, overflow, concurrency, and tenant isolation', async () => {
    // Create DRAFT product with active default SKU
    const draftProduct = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Artisan Ceramic Mug',
          slug: `artisan-mug-${runId}`,
          categoryId: categoryAId,
          basePrice: '24.00',
        }),
    ).expect(201);
    const draftProductId = draftProduct.body.data.id as string;

    const draftVariant = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({
          productId: draftProductId,
          sku: `MUG-DRAFT-${runId}`,
          isActive: true,
        }),
    ).expect(201);
    const draftVariantId = draftVariant.body.data.id as string;

    // Customer role denied
    await asCustomerA(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseA1Id,
        variantId: draftVariantId,
        quantity: 5,
      }),
    ).expect(403);

    // Cross-tenant warehouse rejected (Tenant A cannot target Tenant B's warehouse)
    await asAdminA(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseBId,
        variantId: draftVariantId,
        quantity: 5,
      }),
    ).expect(409);

    // Cross-tenant variant rejected (Tenant B cannot initialize Tenant A's variant)
    await asAdminB(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseBId,
        variantId: draftVariantId,
        quantity: 5,
      }),
    ).expect(404);

    // Decision 1 & 2: DRAFT product with active variant initializes cleanly with opening STOCK_IN ledger
    const initRes = await asAdminA(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseA1Id,
        variantId: draftVariantId,
        quantity: 12,
      }),
    ).expect(201);
    const invId = initRes.body.data.id as string;
    expect(initRes.body.data).toMatchObject({
      id: invId,
      warehouseId: warehouseA1Id,
      warehouse: {
        id: warehouseA1Id,
        name: 'Primary Warehouse A',
        isActive: true,
        isDefault: true,
      },
      quantity: 12,
      reservedQuantity: 0,
      availableQuantity: 12,
    });

    // Opening ledger entry exists with referenceId init:<inventoryId>
    const openingTx = await asAdminA(
      request(app).get(`/api/v1/inventory/${invId}/transactions`),
    ).expect(200);
    expect(openingTx.body.data.items).toHaveLength(1);
    expect(openingTx.body.data.items[0]).toMatchObject({
      type: 'STOCK_IN',
      quantity: 12,
      referenceId: `init:${invId}`,
      reason: 'Initial stock',
    });

    // Initializing with quantity 0 on second warehouse writes no opening transaction
    const initZero = await asAdminA(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseA2Id,
        variantId: draftVariantId,
        quantity: 0,
      }),
    ).expect(201);
    const inv2Id = initZero.body.data.id as string;
    const zeroTx = await asAdminA(
      request(app).get(`/api/v1/inventory/${inv2Id}/transactions`),
    ).expect(200);
    expect(zeroTx.body.data.items).toHaveLength(0);

    // Inactive variant is rejected (409 VARIANT_INACTIVE)
    const inactiveProd = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Inactive Var Prod',
          slug: `inact-var-${runId}`,
          categoryId: categoryAId,
          basePrice: '10.00',
        }),
    ).expect(201);
    const inactiveVar = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({
          productId: inactiveProd.body.data.id,
          sku: `INACT-SKU-${runId}`,
          isActive: false,
        }),
    ).expect(201);
    const inactInit = await asAdminA(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseA1Id,
        variantId: inactiveVar.body.data.id,
        quantity: 5,
      }),
    ).expect(409);
    expect(inactInit.body.code).toBe('VARIANT_INACTIVE');

    // Archived product is rejected (409 PRODUCT_ARCHIVED)
    const archivedProd = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Archived Prod',
          slug: `arch-prod-${runId}`,
          categoryId: categoryAId,
          basePrice: '10.00',
        }),
    ).expect(201);
    const archVar = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({
          productId: archivedProd.body.data.id,
          sku: `ARCH-SKU-${runId}`,
          isActive: true,
        }),
    ).expect(201);
    await asAdminA(
      request(app)
        .patch(`/api/v1/products/${archivedProd.body.data.id}/status`)
        .send({ status: 'ARCHIVED' }),
    ).expect(200);
    const archInit = await asAdminA(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseA1Id,
        variantId: archVar.body.data.id,
        quantity: 5,
      }),
    ).expect(409);
    expect(archInit.body.code).toBe('PRODUCT_ARCHIVED');

    // Simultaneous duplicate STOCK_IN with identical referenceId applies EXACTLY ONCE
    const dupRef = `mov-dup-in-${runId}`;
    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        asAdminA(
          request(app).post(`/api/v1/inventory/${invId}/stock-in`).send({
            quantity: 8,
            reason: 'Supplier batch',
            referenceId: dupRef,
          }),
        ),
      ),
    );
    for (const res of burst) {
      expect(res.status).toBe(200);
      expect(res.body.data.quantity).toBe(20);
    }

    // Conflicting reuse of same referenceId (different quantity, reason, or type) -> 409 IDEMPOTENCY_KEY_REUSED
    const conflictQty = await asAdminA(
      request(app).post(`/api/v1/inventory/${invId}/stock-in`).send({
        quantity: 9,
        reason: 'Supplier batch',
        referenceId: dupRef,
      }),
    ).expect(409);
    expect(conflictQty.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const conflictReason = await asAdminA(
      request(app).post(`/api/v1/inventory/${invId}/stock-in`).send({
        quantity: 8,
        reason: 'Different reason',
        referenceId: dupRef,
      }),
    ).expect(409);
    expect(conflictReason.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const conflictType = await asAdminA(
      request(app).post(`/api/v1/inventory/${invId}/stock-out`).send({
        quantity: 8,
        reason: 'Supplier batch',
        referenceId: dupRef,
      }),
    ).expect(409);
    expect(conflictType.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Concurrent stock-out burst: 20 on-hand, 8 parallel requests each for 6 units -> at most 3 succeed (18), 2 left!
    const stockOutBurst = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        asAdminA(
          request(app).post(`/api/v1/inventory/${invId}/stock-out`).send({
            quantity: 6,
            reason: `Batch pick ${idx}`,
            referenceId: `mov-burst-out-${runId}-${idx}`,
          }),
        ),
      ),
    );
    const succeededOut = stockOutBurst.filter((r) => r.status === 200);
    const rejectedOut = stockOutBurst.filter((r) => r.status === 409);
    expect(succeededOut).toHaveLength(3);
    expect(rejectedOut).toHaveLength(5);
    for (const r of rejectedOut) {
      expect(r.body.code).toBe('INSUFFICIENT_INVENTORY');
    }

    const afterBurst = await asAdminA(
      request(app).get(`/api/v1/inventory/${invId}`),
    ).expect(200);
    expect(afterBurst.body.data.quantity).toBe(2);
    expect(afterBurst.body.data.availableQuantity).toBe(2);

    // Negative stock prevented via adjustment
    const negAdj = await asAdminA(
      request(app).post(`/api/v1/inventory/${invId}/adjust`).send({
        quantity: -5,
        reason: 'Over-deduct test',
        referenceId: `mov-neg-${runId}`,
      }),
    ).expect(409);
    expect(negAdj.body.code).toBe('INVALID_INVENTORY_ADJUSTMENT');

    // Integer overflow protection (INT4 max = 2,147,483,647)
    await asAdminA(
      request(app).post(`/api/v1/inventory/${inv2Id}/stock-in`).send({
        quantity: 1_000_000_000,
        reason: 'Overflow setup 1',
        referenceId: `mov-ovf-1-${runId}`,
      }),
    ).expect(200);
    await asAdminA(
      request(app).post(`/api/v1/inventory/${inv2Id}/stock-in`).send({
        quantity: 1_000_000_000,
        reason: 'Overflow setup 2',
        referenceId: `mov-ovf-2-${runId}`,
      }),
    ).expect(200);
    const ovf = await asAdminA(
      request(app).post(`/api/v1/inventory/${inv2Id}/stock-in`).send({
        quantity: 200_000_000,
        reason: 'Overflow attempt',
        referenceId: `mov-ovf-3-${runId}`,
      }),
    ).expect(409);
    expect(ovf.body.code).toBe('INVENTORY_QUANTITY_OVERFLOW');

    // Server-side search by product name and SKU + warehouse filtering + tenant isolation
    const searchByName = await asAdminA(
      request(app).get(
        `/api/v1/inventory?warehouseId=${warehouseA1Id}&search=artisan`,
      ),
    ).expect(200);
    expect(searchByName.body.data.items).toHaveLength(1);
    expect(searchByName.body.data.items[0].id).toBe(invId);

    const searchBySku = await asAdminA(
      request(app).get(
        `/api/v1/inventory?search=${encodeURIComponent(`MUG-DRAFT-${runId}`)}&lowStock=5`,
      ),
    ).expect(200);
    expect(searchBySku.body.data.items).toHaveLength(1);
    expect(searchBySku.body.data.items[0].id).toBe(invId);

    // Tenant B cannot see or mutate Tenant A's inventory
    await asAdminB(request(app).get(`/api/v1/inventory/${invId}`)).expect(404);
    await asAdminB(
      request(app).get(`/api/v1/inventory/${invId}/transactions`),
    ).expect(404);
    await asAdminB(
      request(app).post(`/api/v1/inventory/${invId}/stock-in`).send({
        quantity: 1,
        referenceId: `mov-cross-${runId}`,
      }),
    ).expect(404);
  });

  it('preserves reserved stock protection, checkout reservation, order cancellation RELEASE, payment PAID SALE, and Flutter storefront DTO compatibility', async () => {
    // Create product, default SKU, initialize stock in DRAFT, then publish ACTIVE
    const prodRes = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Espresso Kettle',
          slug: `espresso-kettle-${runId}`,
          categoryId: categoryAId,
          basePrice: '75.00',
        }),
    ).expect(201);
    const productId = prodRes.body.data.id as string;

    const varRes = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({
          productId,
          sku: `KETTLE-${runId}`,
          isActive: true,
        }),
    ).expect(201);
    const variantId = varRes.body.data.id as string;

    const invRes = await asAdminA(
      request(app).post('/api/v1/inventory').send({
        warehouseId: warehouseA1Id,
        variantId,
        quantity: 10,
      }),
    ).expect(201);
    const invId = invRes.body.data.id as string;

    // DRAFT product still cannot be added to customer cart
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 1 }),
    ).expect(409);

    // Publish product ACTIVE
    await asAdminA(
      request(app)
        .patch(`/api/v1/products/${productId}/status`)
        .send({ status: 'ACTIVE' }),
    ).expect(200);

    // Flutter storefront detail reflects stock cleanly
    const storefrontBefore = await request(app)
      .get(`/api/v1/products/${productId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    expect(storefrontBefore.body.data.variants[0].inventory).toMatchObject({
      quantity: 10,
      reservedQuantity: 0,
      availableQuantity: 10,
    });

    // Customer adds 4 units & checks out -> reserves 4 units
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 4 }),
    ).expect(200);

    const checkout1 = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `chk-1-${runId}`)
        .send({
          shippingAddressId: addressAId,
          paymentMethod: PaymentMethod.CARD,
        }),
    ).expect(201);
    const order1Id = checkout1.body.data.order.id as string;

    const reservedState = await asAdminA(
      request(app).get(`/api/v1/inventory/${invId}`),
    ).expect(200);
    expect(reservedState.body.data).toMatchObject({
      quantity: 10,
      reservedQuantity: 4,
      availableQuantity: 6,
    });

    // Stock-out and negative adjustment cannot touch reserved units
    const blockedOut = await asAdminA(
      request(app).post(`/api/v1/inventory/${invId}/stock-out`).send({
        quantity: 7,
        referenceId: `mov-res-out-${runId}`,
      }),
    ).expect(409);
    expect(blockedOut.body.code).toBe('INSUFFICIENT_INVENTORY');

    const blockedAdj = await asAdminA(
      request(app).post(`/api/v1/inventory/${invId}/adjust`).send({
        quantity: -7,
        reason: 'Below reserved test',
        referenceId: `mov-res-adj-${runId}`,
      }),
    ).expect(409);
    expect(blockedAdj.body.code).toBe('INVALID_INVENTORY_ADJUSTMENT');

    // Cancel unpaid order -> RELEASE restores available to 10
    await asAdminA(
      request(app)
        .patch(`/api/v1/orders/${order1Id}/status`)
        .send({ status: 'CANCELLED' }),
    ).expect(200);

    const releasedState = await asAdminA(
      request(app).get(`/api/v1/inventory/${invId}`),
    ).expect(200);
    expect(releasedState.body.data).toMatchObject({
      quantity: 10,
      reservedQuantity: 0,
      availableQuantity: 10,
    });

    // Second checkout (3 units) + payment PAID -> SALE commits both quantity and reserved
    await asCustomerA(
      request(app).post('/api/v1/cart/items').send({ variantId, quantity: 3 }),
    ).expect(200);

    const checkout2 = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `chk-2-${runId}`)
        .send({
          shippingAddressId: addressAId,
          paymentMethod: PaymentMethod.CARD,
        }),
    ).expect(201);
    const payment2Id = checkout2.body.data.payment.id as string;

    await expect(
      asAdminA(
        request(app)
          .patch(`/api/v1/payments/${payment2Id}/status`)
          .send({ status: 'PAID' }),
      ).expect(409),
    ).resolves.toBeDefined();

    await testPrisma.payment.update({
      where: { id: payment2Id },
      data: {
        providerPaymentId: `mock-inv-${payment2Id}`,
      },
    });

    await paymentService.applyTrustedPaymentStatus(
      tenantA.id,
      payment2Id,
      {
        status: PaymentStatus.PAID,
        providerPaymentId: `mock-inv-${payment2Id}`,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: PaymentProvider.MYFATOORAH,
        providerPaymentId: `mock-inv-${payment2Id}`,
      },
    );

    const soldState = await asAdminA(
      request(app).get(`/api/v1/inventory/${invId}`),
    ).expect(200);
    expect(soldState.body.data).toMatchObject({
      quantity: 7,
      reservedQuantity: 0,
      availableQuantity: 7,
    });

    // Audit trail contains opening STOCK_IN(10), RESERVATION(4), RELEASE(4), RESERVATION(3), SALE(3)
    const txRes = await asAdminA(
      request(app).get(`/api/v1/inventory/${invId}/transactions?limit=50`),
    ).expect(200);
    const types = (txRes.body.data.items as Array<{ type: string }>).map(
      (item) => item.type,
    );
    expect(types).toContain('STOCK_IN');
    expect(types).toContain('RESERVATION');
    expect(types).toContain('RELEASE');
    expect(types).toContain('SALE');
  });
});
