import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import {
  globalRateLimiter,
  sensitiveRateLimiter,
} from '../../src/config/rate-limit.js';
import { testPrisma } from '../../src/config/test-database.js';
import {
  DiscountType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentRefundStatus,
  PaymentStatus,
  ProductStatus,
} from '../../src/generated/prisma/client.js';
import { productRecommendationRepository } from '../../src/modules/products/product-recommendation.repository.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createInventoryFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

const FORBIDDEN_DTO_KEYS = new Set([
  'storagekey',
  'imagestoragekey',
  'warehouseid',
  'quantity',
  'reservedquantity',
  'availablequantity',
  'passwordhash',
  'suppliercost',
  'coordercount',
  'matchedsourcecount',
  'distinctcoordercount',
  'confidence',
  'lastcopurchasedat',
  'orderid',
]);

function findForbiddenKeys(value: unknown, currentPath = '$'): string[] {
  if (value === null || value === undefined || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findForbiddenKeys(entry, `${currentPath}[${index}]`),
    );
  }
  const findings: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${currentPath}.${key}`;
    if (FORBIDDEN_DTO_KEYS.has(key.toLowerCase())) {
      findings.push(nextPath);
    }
    findings.push(...findForbiddenKeys(nested, nextPath));
  }
  return findings;
}

const DAY_MS = 86_400_000;

describe('PR.3A — Cart Complementary Products & Limit Expansion Integration Tests', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createdUserIds: string[] = [];
  let ownerAId: string;
  let ownerAToken: string;
  let adminAToken: string;
  let managerAToken: string;
  let customerA1Id: string;
  let customerA1Token: string;
  let customerA2Id: string;
  let customerA2Token: string;
  let customerB1Id: string;
  let customerB1Token: string;
  let nonMemberToken: string;

  let activeWarehouseAId: string;
  let inactiveWarehouseAId: string;
  let activeWarehouseBId: string;

  const createUser = async (
    label: string,
    tenantId: string | null,
    role?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER',
  ) => {
    const user = await testPrisma.user.create({
      data: {
        email: `pr3a-${label}-${runId}@example.test`,
        passwordHash: 'test-hash',
        firstName: label,
        lastName: 'Tester',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    if (tenantId && role) {
      await testPrisma.tenantMember.create({
        data: {
          tenantId,
          userId: user.id,
          role,
          status: 'ACTIVE',
        },
      });
    }
    const token = await createAccessToken(user.id);
    return { id: user.id, token };
  };

  const createCategory = async (
    tenantId: string,
    name: string,
    opts?: { parentId?: string | null; isActive?: boolean },
  ) => {
    const suffix = randomUUID().slice(0, 8);
    return testPrisma.category.create({
      data: {
        tenantId,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
        parentId: opts?.parentId ?? null,
        isActive: opts?.isActive ?? true,
      },
    });
  };

  const createProduct = async (
    tenantId: string,
    warehouseId: string,
    categoryId: string,
    name: string,
    opts?: {
      status?: ProductStatus;
      basePrice?: string;
      stockQuantity?: number;
      reservedQuantity?: number;
      createdAt?: Date;
      withAttribute?: boolean;
      extraVariant?: boolean;
      variantIsActive?: boolean;
      discountType?: DiscountType;
      discountValue?: string;
      discountStartsAt?: Date | null;
      discountEndsAt?: Date | null;
    },
  ) => {
    const suffix = randomUUID().slice(0, 8);
    const product = await testPrisma.product.create({
      data: {
        tenantId,
        categoryId,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
        status: opts?.status ?? ProductStatus.ACTIVE,
        basePrice: opts?.basePrice ?? '25.00',
        ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
        ...(opts?.discountType
          ? {
              discountType: opts.discountType,
              discountValue: opts.discountValue ?? '5.00',
              discountStartsAt: opts.discountStartsAt ?? null,
              discountEndsAt: opts.discountEndsAt ?? null,
            }
          : {}),
      },
    });

    if (opts?.withAttribute) {
      await testPrisma.productAttribute.create({
        data: {
          productId: product.id,
          name: 'Size',
          sortOrder: 0,
        },
      });
    }

    const defaultVariant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `PR3A-${suffix}-DEF`,
        combinationKey: 'default',
        price: opts?.basePrice ?? '25.00',
        isActive: opts?.variantIsActive ?? true,
        isDefault: true,
      },
    });

    const qty = opts?.stockQuantity ?? 20;
    if (qty >= 0) {
      await createInventoryFixture({
        data: {
          tenantId,
          variantId: defaultVariant.id,
          warehouseId,
          quantity: qty,
          reservedQuantity: opts?.reservedQuantity ?? 0,
        },
      });
    }

    let extraVariantRecord = null;
    if (opts?.extraVariant) {
      extraVariantRecord = await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `PR3A-${suffix}-ALT`,
          combinationKey: 'alt',
          price: opts?.basePrice ?? '25.00',
          isActive: true,
          isDefault: false,
        },
      });
      await createInventoryFixture({
        data: {
          tenantId,
          variantId: extraVariantRecord.id,
          warehouseId,
          quantity: qty,
          reservedQuantity: opts?.reservedQuantity ?? 0,
        },
      });
    }

    return { product, defaultVariant, extraVariant: extraVariantRecord };
  };

  const createHistoricalOrder = async (
    tenantId: string,
    userId: string,
    items: Array<{ productId: string; variantId: string; quantity?: number }>,
    opts?: {
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      paymentMethod?: PaymentMethod;
      paymentProvider?: PaymentProvider;
      paymentRecordStatus?: PaymentStatus;
      reconciliationRequired?: boolean;
      refundStatus?: PaymentRefundStatus;
      createdAt?: Date;
    },
  ) => {
    const orderStatus = opts?.status ?? OrderStatus.DELIVERED;
    const orderPaymentStatus = opts?.paymentStatus ?? PaymentStatus.PAID;
    const createdAt = opts?.createdAt ?? new Date(Date.now() - 2 * DAY_MS);
    const suffix = randomUUID().slice(0, 10);

    const order = await testPrisma.order.create({
      data: {
        tenantId,
        userId,
        orderNumber: `PR3A-${suffix}`,
        status: orderStatus,
        paymentStatus: orderPaymentStatus,
        subtotal: '100.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        shippingAmount: '0.00',
        totalAmount: '100.00',
        currency: 'USD',
        shippingAddress: { city: 'Austin', country: 'US' },
        billingAddress: { city: 'Austin', country: 'US' },
        createdAt,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            productName: 'Snapshot',
            sku: `SKU-${item.variantId.slice(0, 6)}`,
            unitPrice: '25.00',
            itemDiscountAmount: '0.00',
            finalUnitPrice: '25.00',
            quantity: item.quantity ?? 1,
            totalPrice: '25.00',
            taxableAmount: '25.00',
            taxAmount: '0.00',
            variantSnapshot: {},
          })),
        },
      },
    });

    const payment = await testPrisma.payment.create({
      data: {
        orderId: order.id,
        provider: opts?.paymentProvider ?? PaymentProvider.NONE,
        method: opts?.paymentMethod ?? PaymentMethod.CASH_ON_DELIVERY,
        status: opts?.paymentRecordStatus ?? orderPaymentStatus,
        amount: '100.00',
        currency: 'USD',
        reconciliationRequired: opts?.reconciliationRequired ?? false,
      },
    });

    if (opts?.refundStatus) {
      await testPrisma.paymentRefund.create({
        data: {
          tenantId,
          orderId: order.id,
          paymentId: payment.id,
          provider: payment.provider,
          method: payment.method,
          amount: '100.00',
          currency: 'USD',
          status: opts.refundStatus,
          idempotencyKey: `pr3a-ref-${suffix}`,
          requestFingerprint: `pr3a-fp-${suffix}`,
          reason: 'Customer requested refund',
          requestedByUserId: ownerAId,
        },
      });
    }

    return order;
  };

  const setCartItems = async (
    tenantId: string,
    userId: string,
    items: Array<{ variantId: string; quantity?: number }>,
  ) => {
    const cart = await testPrisma.cart.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { tenantId, userId },
      update: {},
    });
    await testPrisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    if (items.length > 0) {
      await testPrisma.cartItem.createMany({
        data: items.map((item) => ({
          cartId: cart.id,
          variantId: item.variantId,
          quantity: item.quantity ?? 1,
        })),
      });
    }
    return cart;
  };

  const resetRateLimiters = () => {
    globalRateLimiter.resetKey('::ffff:127.0.0.1');
    globalRateLimiter.resetKey('127.0.0.1');
    sensitiveRateLimiter.resetKey('::ffff:127.0.0.1');
    sensitiveRateLimiter.resetKey('127.0.0.1');
  };

  beforeAll(async () => {
    await tenantA.create();
    await tenantB.create();

    const whA = await fixtureWarehouse(tenantA.id);
    activeWarehouseAId = whA.id;
    const whAInactive = await testPrisma.warehouse.create({
      data: {
        tenantId: tenantA.id,
        code: `PR3A-WHA-OFF-${runId}`,
        name: 'Inactive WH',
        countryCode: whA.countryCode,
        city: 'Austin',
        address: '200 Main St',
        isActive: false,
      },
    });
    inactiveWarehouseAId = whAInactive.id;
    const whB = await fixtureWarehouse(tenantB.id);
    activeWarehouseBId = whB.id;

    const ownerA = await createUser('owner-a', tenantA.id, 'OWNER');
    ownerAId = ownerA.id;
    ownerAToken = ownerA.token;
    adminAToken = (await createUser('admin-a', tenantA.id, 'ADMIN')).token;
    managerAToken = (await createUser('manager-a', tenantA.id, 'MANAGER')).token;

    const custA1 = await createUser('cust-a1', tenantA.id, 'CUSTOMER');
    customerA1Id = custA1.id;
    customerA1Token = custA1.token;
    const custA2 = await createUser('cust-a2', tenantA.id, 'CUSTOMER');
    customerA2Id = custA2.id;
    customerA2Token = custA2.token;

    const custB1 = await createUser('cust-b1', tenantB.id, 'CUSTOMER');
    customerB1Id = custB1.id;
    customerB1Token = custB1.token;

    nonMemberToken = (await createUser('non-member', null)).token;
  });

  afterAll(async () => {
    await testPrisma.wishlistItem.deleteMany({
      where: { wishlist: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.wishlist.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.cartItem.deleteMany({
      where: { cart: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.cart.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await tenantA.cleanup();
    await tenantB.cleanup();
    if (createdUserIds.length > 0) {
      await testPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  });

  beforeEach(async () => {
    resetRateLimiters();
    await testPrisma.appSetting.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.wishlist.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.cartItem.deleteMany({
      where: { cart: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.cart.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.categoryComplementaryRelation.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.product.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.category.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
  });

  it('1. Expands Product Details complementaryLimit to max 15 while preserving default 6, Similar max 8, legacy contract, and deduplication backfill', async () => {
    const srcCat = await createCategory(tenantA.id, 'Dresses');
    const tgtCat = await createCategory(tenantA.id, 'Accessories');

    const src = await createProduct(tenantA.id, activeWarehouseAId, srcCat.id, 'Source Dress');
    // 10 similar products in same category
    const similars = [];
    for (let i = 1; i <= 10; i++) {
      similars.push(
        await createProduct(tenantA.id, activeWarehouseAId, srcCat.id, `Similar Dress ${i}`),
      );
    }
    // 16 genuinely eligible complementary products in target category
    const compProducts = [];
    for (let i = 1; i <= 16; i++) {
      compProducts.push(
        await createProduct(
          tenantA.id,
          activeWarehouseAId,
          tgtCat.id,
          `Accessory ${i}`,
          { createdAt: new Date(Date.now() - i * 60_000) },
        ),
      );
    }

    await testPrisma.categoryComplementaryRelation.create({
      data: {
        tenantId: tenantA.id,
        sourceCategoryId: srcCat.id,
        targetCategoryId: tgtCat.id,
        sortOrder: 0,
      },
    });

    // Legacy request without opt-in -> no complementary key, max 8 similar
    const legacy = await request(app)
      .get(`/api/v1/products/${src.product.id}/recommendations`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    expect(legacy.body.data.enabled).toBe(true);
    expect(legacy.body.data.items).toHaveLength(8);
    expect(legacy.body.data.complementary).toBeUndefined();

    // Default complementaryLimit = 6 when omitted
    const defaultComp = await request(app)
      .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    expect(defaultComp.body.data.complementary.enabled).toBe(true);
    expect(defaultComp.body.data.complementary.items).toHaveLength(6);

    // Explicit complementaryLimit = 15 returns all 15 unique eligible products
    const maxComp = await request(app)
      .get(`/api/v1/products/${src.product.id}/recommendations?limit=8&includeComplementary=true&complementaryLimit=15`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    expect(maxComp.body.data.items).toHaveLength(8);
    expect(maxComp.body.data.complementary.items).toHaveLength(15);
    const compIds = new Set(
      maxComp.body.data.complementary.items.map((x: { id: string }) => x.id),
    );
    expect(compIds.size).toBe(15);
    for (const sim of maxComp.body.data.items as Array<{ id: string }>) {
      expect(compIds.has(sim.id)).toBe(false);
    }

    // Invalid limits rejected (400): Similar > 8 and Complementary > 15
    for (const url of [
      `/api/v1/products/${src.product.id}/recommendations?limit=9`,
      `/api/v1/products/${src.product.id}/recommendations?limit=0`,
      `/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=16`,
      `/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=0`,
      `/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=-2`,
      `/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=abc`,
    ]) {
      await request(app).get(url).set('X-Tenant-Slug', tenantA.slug).expect(400);
    }
  });

  it('2. Handles missing cart (no auto-creation), empty cart, invalid limits, and read-only GET invariants', async () => {
    const cartsBefore = await testPrisma.cart.count({ where: { tenantId: tenantA.id } });
    expect(cartsBefore).toBe(0);

    // Customer without cart -> enabled: true, items: [], ZERO cart created!
    const noCartRes = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(noCartRes.body).toEqual({
      success: true,
      message: null,
      data: { enabled: true, items: [] },
    });
    const cartsAfterNoCart = await testPrisma.cart.count({
      where: { tenantId: tenantA.id },
    });
    expect(cartsAfterNoCart).toBe(0);

    // Empty cart -> enabled: true, items: []
    await setCartItems(tenantA.id, customerA1Id, []);
    const emptyCartRes = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(emptyCartRes.body.data).toEqual({ enabled: true, items: [] });

    // Invalid limit values -> 400
    for (const bad of ['0', '16', '-1', '1.5', 'abc']) {
      await request(app)
        .get(`/api/v1/cart/recommendations?limit=${bad}`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .expect(400);
    }
  });

  it('3. Enforces per-source eligibility before aggregation, distinct order counting across overlapping sources, and deterministic cart history ranking', async () => {
    const cat = await createCategory(tenantA.id, 'Catalog');

    const s1 = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'Source 1', {
      extraVariant: true,
    });
    const s2 = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'Source 2');

    const tOld = new Date(Date.now() - 40 * DAY_MS);
    const tMid = new Date(Date.now() - 20 * DAY_MS);
    const tNew = new Date(Date.now() - 5 * DAY_MS);

    // Candidates:
    // cTop: matched by BOTH s1 and s2 across 3 distinct qualifying orders (O1, O2, O3)
    const cTop = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'C Top', {
      createdAt: tOld,
    });
    // cOverlap: matched by BOTH s1 and s2 ONLY in the SAME 2 shared orders (O1, O2)
    // -> matchedSourceCount=2, distinctCoOrderCount=2 (NOT 4!)
    const cOverlap = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'C Overlap', {
      createdAt: tOld,
    });
    // cOneSourceHighOrders: matched by ONLY s1 across 4 orders (O1, O2, O3, O4)
    // -> matchedSourceCount=1, distinctCoOrderCount=4 -> MUST rank BELOW cOverlap (2 > 1)!
    const cOneSourceHighOrders = await createProduct(
      tenantA.id,
      activeWarehouseAId,
      cat.id,
      'C One Source High Orders',
      { createdAt: tNew },
    );
    // cIneligibleCombined: 1 order with s1 (O1) + 1 order with s2 (O5) -> NEITHER pair reaches >= 2!
    // MUST BE EXCLUDED (independent eligibility before aggregation!)
    const cIneligibleCombined = await createProduct(
      tenantA.id,
      activeWarehouseAId,
      cat.id,
      'C Ineligible Combined',
    );
    // cTieOlder vs cTieNewer: both matched by s1 only, 2 distinct orders, same lastCoPurchasedAt -> createdAt DESC breaks tie
    const cTieOlder = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'C Tie Older', {
      createdAt: tOld,
    });
    const cTieNewer = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'C Tie Newer', {
      createdAt: tNew,
    });

    // O1 (tMid): s1 + s2 + cTop + cOverlap
    await createHistoricalOrder(
      tenantA.id,
      customerA2Id,
      [
        { productId: s1.product.id, variantId: s1.defaultVariant.id },
        { productId: s2.product.id, variantId: s2.defaultVariant.id },
        { productId: cTop.product.id, variantId: cTop.defaultVariant.id },
        { productId: cOverlap.product.id, variantId: cOverlap.defaultVariant.id },
      ],
      { createdAt: tMid },
    );
    // O2 (tMid): s1 + s2 + cTop + cOverlap
    await createHistoricalOrder(
      tenantA.id,
      customerA2Id,
      [
        { productId: s1.product.id, variantId: s1.defaultVariant.id },
        { productId: s2.product.id, variantId: s2.defaultVariant.id },
        { productId: cTop.product.id, variantId: cTop.defaultVariant.id },
        { productId: cOverlap.product.id, variantId: cOverlap.defaultVariant.id },
      ],
      { createdAt: tMid },
    );
    // O3 (tNew): s1 + cTop + cOneSourceHighOrders + cIneligibleCombined (only 1 order with s1)
    await createHistoricalOrder(
      tenantA.id,
      customerA2Id,
      [
        { productId: s1.product.id, variantId: s1.defaultVariant.id },
        { productId: cTop.product.id, variantId: cTop.defaultVariant.id },
        { productId: cOneSourceHighOrders.product.id, variantId: cOneSourceHighOrders.defaultVariant.id },
        { productId: cIneligibleCombined.product.id, variantId: cIneligibleCombined.defaultVariant.id },
      ],
      { createdAt: tNew },
    );
    // O4 (tOld): s1 + cOneSourceHighOrders + cTieOlder + cTieNewer
    await createHistoricalOrder(
      tenantA.id,
      customerA2Id,
      [
        { productId: s1.product.id, variantId: s1.defaultVariant.id },
        { productId: cOneSourceHighOrders.product.id, variantId: cOneSourceHighOrders.defaultVariant.id },
        { productId: cTieOlder.product.id, variantId: cTieOlder.defaultVariant.id },
        { productId: cTieNewer.product.id, variantId: cTieNewer.defaultVariant.id },
      ],
      { createdAt: tOld },
    );
    // O5 (tMid): s1 + cOneSourceHighOrders + cTieOlder + cTieNewer
    await createHistoricalOrder(
      tenantA.id,
      customerA2Id,
      [
        { productId: s1.product.id, variantId: s1.defaultVariant.id },
        { productId: cOneSourceHighOrders.product.id, variantId: cOneSourceHighOrders.defaultVariant.id },
        { productId: cTieOlder.product.id, variantId: cTieOlder.defaultVariant.id },
        { productId: cTieNewer.product.id, variantId: cTieNewer.defaultVariant.id },
      ],
      { createdAt: tMid },
    );
    // O6 (tOld): s1 + cOneSourceHighOrders
    await createHistoricalOrder(
      tenantA.id,
      customerA2Id,
      [
        { productId: s1.product.id, variantId: s1.defaultVariant.id },
        { productId: cOneSourceHighOrders.product.id, variantId: cOneSourceHighOrders.defaultVariant.id },
      ],
      { createdAt: tOld },
    );
    // O7 (tNew): s2 + cIneligibleCombined (gives s2 its 3rd eligible source order, and cIneligibleCombined only 1 order with s2)
    await createHistoricalOrder(
      tenantA.id,
      customerA2Id,
      [
        { productId: s2.product.id, variantId: s2.defaultVariant.id },
        { productId: cIneligibleCombined.product.id, variantId: cIneligibleCombined.defaultVariant.id },
      ],
      { createdAt: tNew },
    );

    // Put BOTH variants of s1 (different quantities!) + s2 in customerA1's cart
    await setCartItems(tenantA.id, customerA1Id, [
      { variantId: s1.defaultVariant.id, quantity: 5 },
      { variantId: s1.extraVariant!.id, quantity: 3 },
      { variantId: s2.defaultVariant.id, quantity: 1 },
    ]);

    const res = await request(app)
      .get('/api/v1/cart/recommendations?limit=15')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);

    const returnedIds = res.body.data.items.map((item: { id: string }) => item.id);
    expect(returnedIds).toEqual([
      cTop.product.id,
      cOverlap.product.id,
      cOneSourceHighOrders.product.id,
      cTieNewer.product.id,
      cTieOlder.product.id,
    ]);
    // cIneligibleCombined excluded; cart products s1 and s2 excluded
    expect(returnedIds).not.toContain(cIneligibleCombined.product.id);
    expect(returnedIds).not.toContain(s1.product.id);
    expect(returnedIds).not.toContain(s2.product.id);

    // Quantity independence: changing s2 quantity from 1 to 10 must produce identical ranking
    await setCartItems(tenantA.id, customerA1Id, [
      { variantId: s1.defaultVariant.id, quantity: 1 },
      { variantId: s2.defaultVariant.id, quantity: 10 },
    ]);
    const qtyRes = await request(app)
      .get('/api/v1/cart/recommendations?limit=15')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(qtyRes.body.data.items.map((item: { id: string }) => item.id)).toEqual(
      returnedIds,
    );
  });

  it('4. Enforces order status, COD paid/unpaid, refund, reconciliation, 180-day window, confidence, and per-source maxSourceOrders cap', async () => {
    const cat = await createCategory(tenantA.id, 'Eligibility');
    const src = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'Src');
    const goodCod = await createProduct(tenantA.id, activeWarehouseAId, cat.id, 'Good COD');
    const badOrdersCandidate = await createProduct(
      tenantA.id,
      activeWarehouseAId,
      cat.id,
      'Bad Orders Candidate',
    );
    const lowConfCandidate = await createProduct(
      tenantA.id,
      activeWarehouseAId,
      cat.id,
      'Low Conf',
    );

    // 3 eligible collected COD orders (DELIVERED/COMPLETED + PAID) with goodCod
    for (let i = 0; i < 3; i++) {
      await createHistoricalOrder(
        tenantA.id,
        customerA2Id,
        [
          { productId: src.product.id, variantId: src.defaultVariant.id },
          { productId: goodCod.product.id, variantId: goodCod.defaultVariant.id },
        ],
        {
          status: i === 0 ? OrderStatus.COMPLETED : OrderStatus.DELIVERED,
          paymentStatus: PaymentStatus.PAID,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
          paymentRecordStatus: PaymentStatus.PAID,
          createdAt: new Date(Date.now() - (i + 1) * DAY_MS),
        },
      );
    }

    // Ineligible orders with badOrdersCandidate:
    // unpaid COD, CONFIRMED+PAID, CANCELLED, reconciliationRequired, refund SUCCEEDED, >180 days old, future-dated
    const ineligibleConfigs = [
      { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PENDING },
      { status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID },
      { status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.PAID },
      { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PAID, reconciliationRequired: true },
      { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PAID, paymentRecordStatus: PaymentStatus.PENDING },
      { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PAID, refundStatus: PaymentRefundStatus.SUCCEEDED },
      { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PAID, createdAt: new Date(Date.now() - 181 * DAY_MS) },
      { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PAID, createdAt: new Date(Date.now() + 2 * DAY_MS) },
    ];
    for (const cfg of ineligibleConfigs) {
      await createHistoricalOrder(
        tenantA.id,
        customerA2Id,
        [
          { productId: src.product.id, variantId: src.defaultVariant.id },
          { productId: badOrdersCandidate.product.id, variantId: badOrdersCandidate.defaultVariant.id },
        ],
        cfg,
      );
    }

    await setCartItems(tenantA.id, customerA1Id, [{ variantId: src.defaultVariant.id }]);

    const res = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(res.body.data.items.map((x: { id: string }) => x.id)).toEqual([goodCod.product.id]);

    // Verify per-source cap directly via repository (maxSourceOrders = 3 drops older 4th/5th orders)
    for (let i = 0; i < 2; i++) {
      await createHistoricalOrder(
        tenantA.id,
        customerA2Id,
        [
          { productId: src.product.id, variantId: src.defaultVariant.id },
          { productId: lowConfCandidate.product.id, variantId: lowConfCandidate.defaultVariant.id },
        ],
        { createdAt: new Date(Date.now() - (50 + i) * DAY_MS) },
      );
    }
    const capped = await productRecommendationRepository.findCartComplementaryCoPurchaseCandidates({
      tenantId: tenantA.id,
      sourceProductIds: [src.product.id],
      excludedProductIds: [src.product.id],
      windowStart: new Date(Date.now() - 180 * DAY_MS),
      referenceNow: new Date(),
      maxSourceOrders: 3, // Only the 3 newest orders (all goodCod) stay inside the per-source cap!
      minSourceOrders: 3,
      minCoPurchaseOrders: 2,
      minConfidenceBps: 500,
    });
    expect(capped.map((c) => c.id)).toEqual([goodCod.product.id]);

    // Confidence threshold check: 2/5 = 40% passes 500 bps (5%), fails 5000 bps (50%)
    const strictConf = await productRecommendationRepository.findCartComplementaryCoPurchaseCandidates({
      tenantId: tenantA.id,
      sourceProductIds: [src.product.id],
      excludedProductIds: [src.product.id],
      windowStart: new Date(Date.now() - 180 * DAY_MS),
      referenceNow: new Date(),
      maxSourceOrders: 10,
      minSourceOrders: 3,
      minCoPurchaseOrders: 2,
      minConfidenceBps: 5000,
    });
    expect(strictConf.map((c) => c.id)).toEqual([goodCod.product.id]);
  });

  it('5. Implements global hybrid priority (7 history + 8 mapping = 15), skips fallback when history fills 15, merges & orders target categories deterministically, and Round Robins without per-category cap', async () => {
    const srcCatA = await createCategory(tenantA.id, 'Source Cat A');
    const srcCatB = await createCategory(tenantA.id, 'Source Cat B');
    const tgtShared = await createCategory(tenantA.id, 'Target Shared');
    const tgtSecond = await createCategory(tenantA.id, 'Target Second');
    const tgtSingleOnly = await createCategory(tenantA.id, 'Target Single');
    const inactiveParent = await createCategory(tenantA.id, 'Inactive Parent', { isActive: false });
    const childUnderInactive = await createCategory(tenantA.id, 'Child Under Inactive', {
      parentId: inactiveParent.id,
      isActive: true,
    });

    const srcA = await createProduct(tenantA.id, activeWarehouseAId, srcCatA.id, 'Source A');
    const srcB = await createProduct(tenantA.id, activeWarehouseAId, srcCatB.id, 'Source B');
    // Inactive source product in cart -> must NOT generate recommendations, AND must still be excluded if it appeared
    const inactiveCartSource = await createProduct(
      tenantA.id,
      activeWarehouseAId,
      tgtSingleOnly.id,
      'Inactive In Cart',
      { status: ProductStatus.INACTIVE },
    );

    // 7 eligible history candidates for srcA
    const histProducts = [];
    for (let i = 1; i <= 7; i++) {
      histProducts.push(
        await createProduct(tenantA.id, activeWarehouseAId, srcCatA.id, `Hist ${i}`, {
          createdAt: new Date(Date.now() - i * 60_000),
        }),
      );
    }
    for (let o = 0; o < 3; o++) {
      await createHistoricalOrder(tenantA.id, customerA2Id, [
        { productId: srcA.product.id, variantId: srcA.defaultVariant.id },
        ...histProducts.map((h) => ({ productId: h.product.id, variantId: h.defaultVariant.id })),
      ]);
    }

    // Target categories:
    // srcCatA -> tgtSecond (sort 0), tgtShared (sort 1), childUnderInactive (sort 2)
    // srcCatB -> tgtShared (sort 0)
    // Merged target order:
    // 1) tgtShared (matchedSources=2 [srcA, srcB], minSortOrder=0)
    // 2) tgtSecond (matchedSources=1 [srcA], minSortOrder=0)
    // childUnderInactive excluded due to inactive ancestor!
    await testPrisma.categoryComplementaryRelation.createMany({
      data: [
        { tenantId: tenantA.id, sourceCategoryId: srcCatA.id, targetCategoryId: tgtSecond.id, sortOrder: 0 },
        { tenantId: tenantA.id, sourceCategoryId: srcCatA.id, targetCategoryId: tgtShared.id, sortOrder: 1 },
        { tenantId: tenantA.id, sourceCategoryId: srcCatA.id, targetCategoryId: childUnderInactive.id, sortOrder: 2 },
        { tenantId: tenantA.id, sourceCategoryId: srcCatB.id, targetCategoryId: tgtShared.id, sortOrder: 0 },
      ],
    });

    // 2 products in tgtShared (exhausts after 2 rounds!), 10 products in tgtSecond (must backfill all remaining slots!)
    const shared1 = await createProduct(tenantA.id, activeWarehouseAId, tgtShared.id, 'Shared 1', {
      createdAt: new Date(Date.now() - 1_000),
    });
    const shared2 = await createProduct(tenantA.id, activeWarehouseAId, tgtShared.id, 'Shared 2', {
      createdAt: new Date(Date.now() - 2_000),
    });
    // Out-of-stock & inactive-warehouse products in tgtShared -> must be excluded
    await createProduct(tenantA.id, activeWarehouseAId, tgtShared.id, 'Out Of Stock', {
      stockQuantity: 5,
      reservedQuantity: 5,
    });
    await createProduct(tenantA.id, inactiveWarehouseAId, tgtShared.id, 'Inactive WH', {
      stockQuantity: 10,
    });
    await createProduct(tenantA.id, activeWarehouseAId, childUnderInactive.id, 'Bad Ancestor Prod');

    const secondProds = [];
    for (let i = 1; i <= 10; i++) {
      secondProds.push(
        await createProduct(tenantA.id, activeWarehouseAId, tgtSecond.id, `Second ${i}`, {
          createdAt: new Date(Date.now() - i * 1_000),
        }),
      );
    }

    await setCartItems(tenantA.id, customerA1Id, [
      { variantId: srcA.defaultVariant.id },
      { variantId: srcB.defaultVariant.id },
      { variantId: inactiveCartSource.defaultVariant.id },
    ]);

    const res = await request(app)
      .get('/api/v1/cart/recommendations?limit=15')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);

    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.items).toHaveLength(15);

    const ids: string[] = res.body.data.items.map((x: { id: string }) => x.id);
    // First 7 are ALL 7 purchase history items (global history priority!)
    expect(new Set(ids.slice(0, 7))).toEqual(new Set(histProducts.map((h) => h.product.id)));
    // Remaining 8 are Round Robin: [shared1, second1, shared2, second2, second3, second4, second5, second6]
    expect(ids.slice(7)).toEqual([
      shared1.product.id,
      secondProds[0]!.product.id,
      shared2.product.id,
      secondProds[1]!.product.id,
      secondProds[2]!.product.id,
      secondProds[3]!.product.id,
      secondProds[4]!.product.id,
      secondProds[5]!.product.id,
    ]);

    // When history fills requested limit (limit=7), category mapping query is NOT executed!
    const fallbackSpy = vi.spyOn(
      productRecommendationRepository,
      'findActiveComplementaryTargetRelationsForSources',
    );
    const histFullRes = await request(app)
      .get('/api/v1/cart/recommendations?limit=7')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(histFullRes.body.data.items).toHaveLength(7);
    expect(fallbackSpy).not.toHaveBeenCalled();
    fallbackSpy.mockRestore();
  });

  it('6. Preserves Product Card pricing, active/expired offers, Quick Add, customer wishlist isolation, DTO sanitization, security boundaries, and read-only failure behavior', async () => {
    const srcCat = await createCategory(tenantA.id, 'Src Sec');
    const tgtCat = await createCategory(tenantA.id, 'Tgt Sec');
    const catB = await createCategory(tenantB.id, 'Tenant B Cat');

    const srcA = await createProduct(tenantA.id, activeWarehouseAId, srcCat.id, 'Src A');
    const activeOfferQuickAdd = await createProduct(
      tenantA.id,
      activeWarehouseAId,
      tgtCat.id,
      'Active Offer Quick',
      {
        basePrice: '100.00',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '20.00',
        discountStartsAt: new Date(Date.now() - DAY_MS),
        discountEndsAt: new Date(Date.now() + DAY_MS),
        createdAt: new Date(Date.now() - 1_000),
      },
    );
    const expiredOfferWithAttr = await createProduct(
      tenantA.id,
      activeWarehouseAId,
      tgtCat.id,
      'Expired Offer Attr',
      {
        basePrice: '50.00',
        withAttribute: true,
        discountType: DiscountType.FIXED_AMOUNT,
        discountValue: '10.00',
        discountStartsAt: new Date(Date.now() - 10 * DAY_MS),
        discountEndsAt: new Date(Date.now() - DAY_MS),
        createdAt: new Date(Date.now() - 2_000),
      },
    );

    // Tenant B product + mapping should never leak to Tenant A
    const prodB1 = await createProduct(tenantB.id, activeWarehouseBId, catB.id, 'Tenant B Prod 1');
    await setCartItems(tenantB.id, customerB1Id, [{ variantId: prodB1.defaultVariant.id }]);

    await testPrisma.categoryComplementaryRelation.create({
      data: {
        tenantId: tenantA.id,
        sourceCategoryId: srcCat.id,
        targetCategoryId: tgtCat.id,
        sortOrder: 0,
      },
    });

    // Wishlist isolation: customerA1 wishlists activeOfferQuickAdd; customerA2 does NOT
    await testPrisma.wishlist.create({
      data: {
        tenantId: tenantA.id,
        userId: customerA1Id,
        items: {
          create: [{ productId: activeOfferQuickAdd.product.id }],
        },
      },
    });

    await setCartItems(tenantA.id, customerA1Id, [{ variantId: srcA.defaultVariant.id }]);
    await setCartItems(tenantA.id, customerA2Id, [{ variantId: srcA.defaultVariant.id }]);

    // Unauthenticated -> 401
    await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(401);

    // Missing / invalid tenant -> 401/404
    await request(app)
      .get('/api/v1/cart/recommendations')
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(401);
    await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', 'non-existent-tenant-slug')
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(404);

    // Non-member / cross-tenant customer -> 401 UNAUTHORIZED (tenantMemberMiddleware)
    await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${nonMemberToken}`)
      .expect(401);
    await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerB1Token}`)
      .expect(401);

    // Client-supplied identifiers cannot override authenticated customer's cart
    const a1Res = await request(app)
      .get(
        `/api/v1/cart/recommendations?customerId=${customerA2Id}&cartId=00000000-0000-4000-8000-000000000000&productIds=${prodB1.product.id}`,
      )
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);

    expect(findForbiddenKeys(a1Res.body)).toEqual([]);
    expect(a1Res.body.data.items).toHaveLength(2);
    const [card1, card2] = a1Res.body.data.items;
    expect(card1.id).toBe(activeOfferQuickAdd.product.id);
    expect(card1.price).toEqual({
      original: '100.00',
      final: '80.00',
      discountPercentage: 20,
    });
    expect(card1.canQuickAdd).toBe(true);
    expect(card1.defaultVariantId).toBe(activeOfferQuickAdd.defaultVariant.id);
    expect(card1.isInWishlist).toBe(true);

    expect(card2.id).toBe(expiredOfferWithAttr.product.id);
    expect(card2.price).toEqual({
      original: '50.00',
      final: '50.00',
      discountPercentage: null,
    });
    expect(card2.canQuickAdd).toBe(false);
    expect(card2.isInWishlist).toBe(false);

    // Customer A2 sees isInWishlist: false for the exact same product
    const a2Res = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA2Token}`)
      .expect(200);
    expect(a2Res.body.data.items[0].isInWishlist).toBe(false);

    // Recommendation operational failure returns 500 without leaking internals or altering cart
    const failSpy = vi
      .spyOn(productRecommendationRepository, 'findCartSourceProducts')
      .mockRejectedValueOnce(new Error('secret-db-internal-connection-string'));
    const errRes = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(500);
    expect(JSON.stringify(errRes.body)).not.toContain('secret-db-internal');
    failSpy.mockRestore();

    const cartItemsStillIntact = await testPrisma.cartItem.count({
      where: { cart: { tenantId: tenantA.id, userId: customerA1Id } },
    });
    expect(cartItemsStillIntact).toBe(1);
  });

  it('7. Validates show_cart_recommendations strictly, verifies OWNER/ADMIN/MANAGER writes, tests all 8 feature flag combinations, and skips computation when disabled', async () => {
    const srcCat = await createCategory(tenantA.id, 'Flag Src');
    const tgtCat = await createCategory(tenantA.id, 'Flag Tgt');
    const src = await createProduct(tenantA.id, activeWarehouseAId, srcCat.id, 'Flag Src Prod');
    await createProduct(tenantA.id, activeWarehouseAId, srcCat.id, 'Flag Sim Prod');
    await createProduct(tenantA.id, activeWarehouseAId, tgtCat.id, 'Flag Comp Prod');
    await testPrisma.categoryComplementaryRelation.create({
      data: {
        tenantId: tenantA.id,
        sourceCategoryId: srcCat.id,
        targetCategoryId: tgtCat.id,
        sortOrder: 0,
      },
    });
    await setCartItems(tenantA.id, customerA1Id, [{ variantId: src.defaultVariant.id }]);

    // Missing setting defaults to enabled=true and creates ZERO rows on read
    const initialSettings = await request(app)
      .get('/api/v1/app-settings')
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    expect(initialSettings.body.data.showCartRecommendations).toBe(true);
    const sfInitial = await request(app)
      .get('/api/v1/storefront')
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    expect(sfInitial.body.data.settings.showCartRecommendations).toBe(true);
    expect(
      await testPrisma.appSetting.count({ where: { tenantId: tenantA.id } }),
    ).toBe(0);

    // Strict write validation: reject non-boolean & non-public
    for (const badBody of [
      { key: 'show_cart_recommendations', value: 'true', isPublic: true },
      { key: 'show_cart_recommendations', value: 1, isPublic: true },
      { key: 'show_cart_recommendations', value: null, isPublic: true },
      { key: 'show_cart_recommendations', value: true, isPublic: false },
    ]) {
      await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send(badBody)
        .expect(400);
    }

    // CUSTOMER forbidden (403)
    await request(app)
      .post('/api/v1/app-settings')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .send({ key: 'show_cart_recommendations', value: false, isPublic: true })
      .expect(403);

    // OWNER creates, ADMIN updates, MANAGER updates
    await request(app)
      .post('/api/v1/app-settings')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ key: 'show_cart_recommendations', value: false, isPublic: true })
      .expect(201);
    await request(app)
      .patch('/api/v1/app-settings/show_cart_recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ value: true, isPublic: true })
      .expect(200);
    await request(app)
      .patch('/api/v1/app-settings/show_cart_recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${managerAToken}`)
      .send({ value: false, isPublic: true })
      .expect(200);

    // Disabled show_cart_recommendations skips cart & recommendation queries!
    const cartSpy = vi.spyOn(productRecommendationRepository, 'findCartSourceProducts');
    const histSpy = vi.spyOn(
      productRecommendationRepository,
      'findCartComplementaryCoPurchaseCandidates',
    );
    const disabledCartRes = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(disabledCartRes.body.data).toEqual({ enabled: false, items: [] });
    expect(cartSpy).not.toHaveBeenCalled();
    expect(histSpy).not.toHaveBeenCalled();
    cartSpy.mockRestore();
    histSpy.mockRestore();

    // Malformed & non-public legacy rows fail closed (false)
    await testPrisma.appSetting.update({
      where: {
        tenantId_key: { tenantId: tenantA.id, key: 'show_cart_recommendations' },
      },
      data: { value: 'true', isPublic: true },
    });
    const malformedRes = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(malformedRes.body.data).toEqual({ enabled: false, items: [] });

    await testPrisma.appSetting.update({
      where: {
        tenantId_key: { tenantId: tenantA.id, key: 'show_cart_recommendations' },
      },
      data: { value: true, isPublic: false },
    });
    const nonPublicRes = await request(app)
      .get('/api/v1/cart/recommendations')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${customerA1Token}`)
      .expect(200);
    expect(nonPublicRes.body.data).toEqual({ enabled: false, items: [] });

    // Test ALL 8 combinations of (showSimilarProducts, showComplementaryProducts, showCartRecommendations)
    const upsertFlag = async (key: string, value: boolean) =>
      testPrisma.appSetting.upsert({
        where: { tenantId_key: { tenantId: tenantA.id, key } },
        create: { tenantId: tenantA.id, key, value, isPublic: true },
        update: { value, isPublic: true },
      });

    for (const sim of [false, true]) {
      for (const comp of [false, true]) {
        for (const cart of [false, true]) {
          await upsertFlag('show_similar_products', sim);
          await upsertFlag('show_complementary_products', comp);
          await upsertFlag('show_cart_recommendations', cart);

          const [pubSettings, sf, prodRec, cartRec] = await Promise.all([
            request(app).get('/api/v1/app-settings').set('X-Tenant-Slug', tenantA.slug).expect(200),
            request(app).get('/api/v1/storefront').set('X-Tenant-Slug', tenantA.slug).expect(200),
            request(app)
              .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
              .set('X-Tenant-Slug', tenantA.slug)
              .expect(200),
            request(app)
              .get('/api/v1/cart/recommendations')
              .set('X-Tenant-Slug', tenantA.slug)
              .set('Authorization', `Bearer ${customerA1Token}`)
              .expect(200),
          ]);

          expect(pubSettings.body.data.showSimilarProducts).toBe(sim);
          expect(pubSettings.body.data.showComplementaryProducts).toBe(comp);
          expect(pubSettings.body.data.showCartRecommendations).toBe(cart);

          expect(sf.body.data.settings.showSimilarProducts).toBe(sim);
          expect(sf.body.data.settings.showComplementaryProducts).toBe(comp);
          expect(sf.body.data.settings.showCartRecommendations).toBe(cart);

          expect(prodRec.body.data.enabled).toBe(sim);
          expect(prodRec.body.data.items.length > 0).toBe(sim);
          expect(prodRec.body.data.complementary.enabled).toBe(comp);
          expect(prodRec.body.data.complementary.items.length > 0).toBe(comp);

          expect(cartRec.body.data.enabled).toBe(cart);
          expect(cartRec.body.data.items.length > 0).toBe(cart);
        }
      }
    }
  });
});
