import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { ipKeyGenerator } from 'express-rate-limit';
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
  deleteFixtureTenants,
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

describe('PR.2A — Automatic Complementary Products Integration Tests', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const tenantKwd = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createdUserIds: string[] = [];
  let ownerAId: string;
  let ownerAToken: string;
  let adminAToken: string;
  let managerAToken: string;
  let customerA1Id: string;
  let customerA1Token: string;
  let nonMemberToken: string;
  let ownerKwdToken: string;

  let activeWarehouseAId: string;
  let activeWarehouseBId: string;
  let activeWarehouseKwdId: string;

  const createUser = async (
    label: string,
    tenantId: string | null,
    role?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER',
  ) => {
    const user = await testPrisma.user.create({
      data: {
        email: `pr2a-${label}-${runId}@example.test`,
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
    const uid = randomUUID().slice(0, 8);
    return testPrisma.category.create({
      data: {
        tenantId,
        name,
        slug: `cat-${uid}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        parentId: opts?.parentId ?? null,
        isActive: opts?.isActive ?? true,
      },
    });
  };

  interface SeedProductOptions {
    id?: string;
    tenantId: string;
    categoryId: string;
    name: string;
    basePrice: string;
    status?: ProductStatus;
    createdAt?: Date;
    discountType?: DiscountType | null;
    discountValue?: string | null;
    discountStartsAt?: Date | null;
    discountEndsAt?: Date | null;
    imageUrl?: string;
    warehouseId?: string;
    stockQuantity?: number;
    reservedQuantity?: number;
    variants?: Array<{
      price?: string | null;
      isDefault?: boolean;
      isActive?: boolean;
      discountType?: DiscountType | null;
      discountValue?: string | null;
      discountStartsAt?: Date | null;
      discountEndsAt?: Date | null;
      quantity?: number;
      reservedQuantity?: number;
      warehouseId?: string;
    }>;
    attributeNames?: string[];
  }

  const seedProduct = async (opts: SeedProductOptions) => {
    const uid = randomUUID().slice(0, 8);
    const defaultWhId =
      opts.warehouseId ??
      (opts.tenantId === tenantA.id
        ? activeWarehouseAId
        : opts.tenantId === tenantB.id
          ? activeWarehouseBId
          : activeWarehouseKwdId);

    const product = await testPrisma.product.create({
      data: {
        ...(opts.id ? { id: opts.id } : {}),
        tenantId: opts.tenantId,
        categoryId: opts.categoryId,
        name: opts.name,
        slug: `prod-${uid}-${opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        basePrice: opts.basePrice,
        status: opts.status ?? ProductStatus.ACTIVE,
        discountType: opts.discountType ?? null,
        discountValue: opts.discountValue ?? null,
        discountStartsAt: opts.discountStartsAt ?? null,
        discountEndsAt: opts.discountEndsAt ?? null,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });

    await testPrisma.productImage.create({
      data: {
        productId: product.id,
        storageKey: `products/${uid}.jpg`,
        url: opts.imageUrl ?? `/uploads/products/${uid}.jpg`,
        isPrimary: true,
        sortOrder: 0,
      },
    });

    if (opts.attributeNames?.length) {
      for (let i = 0; i < opts.attributeNames.length; i += 1) {
        await testPrisma.productAttribute.create({
          data: {
            productId: product.id,
            name: opts.attributeNames[i]!,
            sortOrder: i,
          },
        });
      }
    }

    const variantSpecs = opts.variants ?? [
      {
        isDefault: true,
        isActive: true,
        quantity: opts.stockQuantity ?? 10,
        reservedQuantity: opts.reservedQuantity ?? 0,
        warehouseId: defaultWhId,
      },
    ];

    const variants = [];
    for (let i = 0; i < variantSpecs.length; i += 1) {
      const spec = variantSpecs[i]!;
      const variant = await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `SKU-${uid}-${i}`,
          combinationKey: `comb-${uid}-${i}`,
          price: spec.price ?? null,
          isDefault: spec.isDefault ?? false,
          isActive: spec.isActive ?? true,
          discountType: spec.discountType ?? null,
          discountValue: spec.discountValue ?? null,
          discountStartsAt: spec.discountStartsAt ?? null,
          discountEndsAt: spec.discountEndsAt ?? null,
        },
      });
      variants.push(variant);

      const qty = spec.quantity ?? 10;
      const resQty = spec.reservedQuantity ?? 0;
      await createInventoryFixture({
        data: {
          tenantId: opts.tenantId,
          variantId: variant.id,
          quantity: qty,
          reservedQuantity: resQty,
          warehouseId: spec.warehouseId ?? defaultWhId,
        },
      });
    }

    return { product, variants };
  };

  interface SeedOrderOptions {
    id?: string;
    tenantId: string;
    userId?: string;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    paymentMethod?: PaymentMethod;
    paymentProvider?: PaymentProvider;
    paymentRowStatus?: PaymentStatus;
    reconciliationRequired?: boolean;
    refundStatus?: PaymentRefundStatus;
    createdAt?: Date;
    items: Array<{
      productId: string;
      variantId: string;
      quantity?: number;
      unitPrice?: string;
    }>;
  }

  const seedOrder = async (opts: SeedOrderOptions) => {
    const uid = randomUUID().slice(0, 8);
    const orderStatus = opts.status ?? OrderStatus.DELIVERED;
    const orderPaymentStatus = opts.paymentStatus ?? PaymentStatus.PAID;
    const paymentRowStatus = opts.paymentRowStatus ?? orderPaymentStatus;
    const userId = opts.userId ?? customerA1Id;
    const currency = opts.tenantId === tenantKwd.id ? 'KWD' : 'USD';

    const order = await testPrisma.order.create({
      data: {
        ...(opts.id ? { id: opts.id } : {}),
        tenantId: opts.tenantId,
        userId,
        orderNumber: `ORD-${uid}-${randomUUID().slice(0, 4)}`,
        status: orderStatus,
        paymentStatus: orderPaymentStatus,
        currency,
        subtotal: '100.00',
        discountAmount: '0.00',
        shippingAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '100.00',
        shippingAddress: { city: 'Test', country: 'US' },
        billingAddress: { city: 'Test', country: 'US' },
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        items: {
          create: opts.items.map((item, idx) => ({
            productId: item.productId,
            variantId: item.variantId,
            productName: `Item ${idx}`,
            sku: `ORD-SKU-${uid}-${idx}`,
            quantity: item.quantity ?? 1,
            unitPrice: item.unitPrice ?? '50.00',
            itemDiscountAmount: '0.00',
            finalUnitPrice: item.unitPrice ?? '50.00',
            totalPrice: item.unitPrice ?? '50.00',
            taxableAmount: item.unitPrice ?? '50.00',
            taxAmount: '0.00',
            variantSnapshot: {},
          })),
        },
      },
    });

    const payment = await testPrisma.payment.create({
      data: {
        orderId: order.id,
        provider: opts.paymentProvider ?? PaymentProvider.NONE,
        method: opts.paymentMethod ?? PaymentMethod.CARD,
        status: paymentRowStatus,
        amount: '100.00',
        currency,
        reconciliationRequired: opts.reconciliationRequired ?? false,
      },
    });

    if (opts.refundStatus) {
      await testPrisma.paymentRefund.create({
        data: {
          tenantId: opts.tenantId,
          orderId: order.id,
          paymentId: payment.id,
          provider: payment.provider,
          method: payment.method,
          amount: '10.00',
          currency,
          status: opts.refundStatus,
          idempotencyKey: `ref-${uid}`,
          requestFingerprint: `fp-${uid}`,
          reason: 'Test refund',
          requestedByUserId: ownerAId,
        },
      });
    }

    return order;
  };

  beforeAll(async () => {
    await testPrisma.country.upsert({
      where: { code: 'US' },
      update: {},
      create: { code: 'US', name: 'United States', currencyCode: 'USD' },
    });
    await testPrisma.country.upsert({
      where: { code: 'KW' },
      update: {},
      create: { code: 'KW', name: 'Kuwait', currencyCode: 'KWD' },
    });

    await testPrisma.tenant.createMany({
      data: [
        {
          id: tenantA.id,
          name: 'PR2A Tenant A',
          slug: tenantA.slug,
          code: `PR2A_A_${runId}`,
          defaultCurrency: 'USD',
          defaultCountryCode: 'US',
          status: 'ACTIVE',
        },
        {
          id: tenantB.id,
          name: 'PR2A Tenant B',
          slug: tenantB.slug,
          code: `PR2A_B_${runId}`,
          defaultCurrency: 'USD',
          defaultCountryCode: 'US',
          status: 'ACTIVE',
        },
        {
          id: tenantKwd.id,
          name: 'PR2A Tenant KWD',
          slug: tenantKwd.slug,
          code: `PR2A_KWD_${runId}`,
          defaultCurrency: 'KWD',
          defaultCountryCode: 'KW',
          status: 'ACTIVE',
        },
      ],
    });

    activeWarehouseAId = (await fixtureWarehouse(tenantA.id)).id;
    activeWarehouseBId = (await fixtureWarehouse(tenantB.id)).id;
    activeWarehouseKwdId = (await fixtureWarehouse(tenantKwd.id)).id;

    const ownerA = await createUser('owner-a', tenantA.id, 'OWNER');
    ownerAId = ownerA.id;
    ownerAToken = ownerA.token;
    adminAToken = (await createUser('admin-a', tenantA.id, 'ADMIN')).token;
    managerAToken = (await createUser('manager-a', tenantA.id, 'MANAGER')).token;
    const cust1 = await createUser('cust-a1', tenantA.id, 'CUSTOMER');
    customerA1Id = cust1.id;
    customerA1Token = cust1.token;
    nonMemberToken = (await createUser('nonmember', null)).token;
    ownerKwdToken = (await createUser('owner-kwd', tenantKwd.id, 'OWNER')).token;
  });

  beforeEach(async () => {
    const key = ipKeyGenerator('::ffff:127.0.0.1');
    await Promise.all([
      globalRateLimiter.resetKey(key),
      sensitiveRateLimiter.resetKey(key),
    ]);
    await testPrisma.appSetting.deleteMany({
      where: {
        tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] },
        key: { in: ['show_similar_products', 'show_complementary_products'] },
      },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await testPrisma.paymentRefund.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
    });
    await testPrisma.payment.deleteMany({
      where: {
        order: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
      },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
    });
    await testPrisma.specialOrderItem.deleteMany({
      where: {
        order: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
      },
    });
    await testPrisma.specialOrder.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
    });
    await testPrisma.specialOrderRequest.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
    });
    await deleteFixtureTenants({
      where: { id: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
    });
    if (createdUserIds.length > 0) {
      await testPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  });

  // =========================================================================
  // A. PURCHASE HISTORY
  // =========================================================================
  describe('A. Purchase History Co-Purchase Rules & Deterministic Ranking', () => {
    it('enforces min 3 source orders, min 2 co-purchase orders, distinct order counting (not qty/variants), same-category inclusion, window bounds, and deterministic tie-breaking', async () => {
      const catMain = await createCategory(tenantA.id, 'Makeup');
      const catOther = await createCategory(tenantA.id, 'Tools');

      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catMain.id,
        name: 'Lipstick Source',
        basePrice: '20.00',
        variants: [
          { isDefault: false, isActive: true, quantity: 10 },
          { isDefault: false, isActive: true, quantity: 10 },
        ],
      });

      const candTop = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catOther.id,
        name: 'Brush Top',
        basePrice: '15.00',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      // Same-category complementary candidate with tied coOrderCount (2) and newer lastCoPurchasedAt
      const candSameCat = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catMain.id,
        name: 'Lip Liner SameCat',
        basePrice: '12.00',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      });
      // Candidate with tied coOrderCount (2) and same lastCoPurchasedAt as candTieOld, newer createdAt
      const candTieNew = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catOther.id,
        name: 'Tie Newer Created',
        basePrice: '14.00',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      });
      const candTieOld = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catOther.id,
        name: 'Tie Older Created',
        basePrice: '14.00',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      });
      // Candidate bought in only 1 order with quantity=15 and 2 variants -> must NOT qualify (distinct orders = 1 < 2)
      const candOneOrderMultiVar = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catOther.id,
        name: 'Single Order Noise',
        basePrice: '11.00',
        variants: [
          { isDefault: false, isActive: true, quantity: 10 },
          { isDefault: false, isActive: true, quantity: 10 },
        ],
      });
      // Candidate only bought in expired (>180d) and future (+2d) orders -> excluded
      const candOutOfWindow = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catOther.id,
        name: 'Out Of Window',
        basePrice: '11.00',
      });

      const now = Date.now();
      const d10 = new Date(now - 10 * DAY_MS);
      const d5 = new Date(now - 5 * DAY_MS);
      const d2 = new Date(now - 2 * DAY_MS);
      const d185 = new Date(now - 185 * DAY_MS);
      const dFuture = new Date(now + 2 * DAY_MS);

      // Before 3 eligible orders (only 2 orders): insufficient source evidence -> empty complementary
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: d10,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: src.product.id, variantId: src.variants[1]!.id },
          { productId: candTop.product.id, variantId: candTop.variants[0]!.id },
          { productId: candTieNew.product.id, variantId: candTieNew.variants[0]!.id },
          { productId: candTieOld.product.id, variantId: candTieOld.variants[0]!.id },
        ],
      });
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: d5,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candTop.product.id, variantId: candTop.variants[0]!.id },
          { productId: candTieNew.product.id, variantId: candTieNew.variants[0]!.id },
          { productId: candTieOld.product.id, variantId: candTieOld.variants[0]!.id },
          { productId: candSameCat.product.id, variantId: candSameCat.variants[0]!.id },
        ],
      });

      const underMinRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(underMinRes.body.data.complementary).toEqual({
        enabled: true,
        items: [],
      });

      // Add 3rd eligible order + out-of-window orders (should be ignored)
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: d2,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candTop.product.id, variantId: candTop.variants[0]!.id },
          { productId: candSameCat.product.id, variantId: candSameCat.variants[0]!.id },
          {
            productId: candOneOrderMultiVar.product.id,
            variantId: candOneOrderMultiVar.variants[0]!.id,
            quantity: 15,
          },
          {
            productId: candOneOrderMultiVar.product.id,
            variantId: candOneOrderMultiVar.variants[1]!.id,
            quantity: 10,
          },
        ],
      });
      // Expired (185d ago) and future (+2d) orders with candOutOfWindow -> must NOT qualify
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: d185,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candOutOfWindow.product.id, variantId: candOutOfWindow.variants[0]!.id },
        ],
      });
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: d185,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candOutOfWindow.product.id, variantId: candOutOfWindow.variants[0]!.id },
        ],
      });
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: dFuture,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candOutOfWindow.product.id, variantId: candOutOfWindow.variants[0]!.id },
        ],
      });
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: dFuture,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candOutOfWindow.product.id, variantId: candOutOfWindow.variants[0]!.id },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);

      const compIds = res.body.data.complementary.items.map(
        (item: { id: string }) => item.id,
      );
      // Expected ranking:
      // 1. candTop (3 orders)
      // 2. candSameCat (2 orders, lastCoPurchasedAt = d2)
      // 3. candTieNew (2 orders, lastCoPurchasedAt = d5, createdAt = 2026-06-01)
      // 4. candTieOld (2 orders, lastCoPurchasedAt = d5, createdAt = 2026-02-01)
      // Excluded: candOneOrderMultiVar (1 distinct order), candOutOfWindow (outside window)
      expect(compIds).toEqual([
        candTop.product.id,
        candSameCat.product.id,
        candTieNew.product.id,
        candTieOld.product.id,
      ]);
    });

    it('enforces exact 5% confidence boundary (2/40 passes, 2/41 fails) and source-order sample cap ordering', async () => {
      const cat = await createCategory(tenantA.id, 'ConfidenceCat');
      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Confidence Source',
        basePrice: '10.00',
      });
      const candExact = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Exact 5 Percent',
        basePrice: '10.00',
      });
      const candRecent = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Recent Sampled',
        basePrice: '10.00',
      });

      const baseTime = Date.now() - 20 * DAY_MS;
      // Create 40 eligible orders: 2 with candExact (exact 2/40 = 5%), 38 source-only
      for (let i = 0; i < 40; i += 1) {
        await seedOrder({
          tenantId: tenantA.id,
          createdAt: new Date(baseTime + i * 60_000),
          items: [
            { productId: src.product.id, variantId: src.variants[0]!.id },
            ...(i < 2
              ? [{ productId: candExact.product.id, variantId: candExact.variants[0]!.id }]
              : []),
            ...(i >= 38
              ? [{ productId: candRecent.product.id, variantId: candRecent.variants[0]!.id }]
              : []),
          ],
        });
      }

      // Exactly 2 / 40 = 5.00% -> BOTH candExact and candRecent qualify!
      const res40 = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      const ids40 = res40.body.data.complementary.items.map((x: { id: string }) => x.id);
      expect(ids40).toContain(candExact.product.id);
      expect(ids40).toContain(candRecent.product.id);

      // Verify bounded source-order cap (maxSourceOrders = 3 takes only the 3 newest orders, so candExact from oldest 2 orders is excluded while candRecent from newest 2 is included)
      const now = new Date();
      const capped = await productRecommendationRepository.findComplementaryCoPurchaseCandidates({
        tenantId: tenantA.id,
        sourceProductId: src.product.id,
        windowStart: new Date(now.getTime() - 180 * DAY_MS),
        referenceNow: now,
        maxSourceOrders: 3,
        minSourceOrders: 3,
        minCoPurchaseOrders: 2,
        minConfidenceBps: 500,
      });
      expect(capped.map((c) => c.id)).toEqual([candRecent.product.id]);

      // Add 41st order -> 2 / 41 = 4.878% < 5% -> BOTH excluded!
      await seedOrder({
        tenantId: tenantA.id,
        createdAt: new Date(baseTime + 41 * 60_000),
        items: [{ productId: src.product.id, variantId: src.variants[0]!.id }],
      });

      const res41 = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(res41.body.data.complementary.items).toEqual([]);
    });
  });

  // =========================================================================
  // B. ORDER ELIGIBILITY
  // =========================================================================
  describe('B. Historical Order Eligibility & Exclusion Matrix', () => {
    it('includes DELIVERED/COMPLETED PAID online & COD orders and excludes all ineligible, refunded, reconciliation-required, cross-tenant, SpecialOrder, and deleted-product records', async () => {
      const cat = await createCategory(tenantA.id, 'EligibilityCat');
      const catB = await createCategory(tenantB.id, 'TenantBCat');

      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Eligibility Source',
        basePrice: '30.00',
      });
      const candEligible = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Eligible Complement',
        basePrice: '15.00',
      });
      const candIneligible = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Ineligible Only Complement',
        basePrice: '15.00',
      });
      const candDeleted = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Deleted Historical Product',
        basePrice: '15.00',
      });

      const recent = new Date(Date.now() - 3 * DAY_MS);

      // 3 eligible orders: DELIVERED+PAID online, COMPLETED+PAID online, DELIVERED+PAID COD
      await seedOrder({
        tenantId: tenantA.id,
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: PaymentMethod.CARD,
        createdAt: recent,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candEligible.product.id, variantId: candEligible.variants[0]!.id },
          { productId: candDeleted.product.id, variantId: candDeleted.variants[0]!.id },
        ],
      });
      await seedOrder({
        tenantId: tenantA.id,
        status: OrderStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: PaymentMethod.CARD,
        createdAt: recent,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candEligible.product.id, variantId: candEligible.variants[0]!.id },
          { productId: candDeleted.product.id, variantId: candDeleted.variants[0]!.id },
        ],
      });
      await seedOrder({
        tenantId: tenantA.id,
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        createdAt: recent,
        items: [
          { productId: src.product.id, variantId: src.variants[0]!.id },
          { productId: candEligible.product.id, variantId: candEligible.variants[0]!.id },
          { productId: candDeleted.product.id, variantId: candDeleted.variants[0]!.id },
        ],
      });

      // Delete candDeleted from catalog (historical OrderItem rows remain!)
      await testPrisma.product.delete({ where: { id: candDeleted.product.id } });

      // Ineligible orders (every excluded status/condition) paired with candIneligible:
      const ineligibleSpecs: Array<Partial<SeedOrderOptions>> = [
        { status: OrderStatus.PENDING, paymentStatus: PaymentStatus.PENDING },
        { status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID },
        { status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID },
        { status: OrderStatus.SHIPPED, paymentStatus: PaymentStatus.PAID },
        { status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.CANCELLED },
        // Unpaid COD delivered
        {
          status: OrderStatus.DELIVERED,
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        },
        // Refused COD shipped unpaid
        {
          status: OrderStatus.SHIPPED,
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        },
        // Failed payment
        { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.FAILED },
        // Refund-pending, fully refunded, partially refunded
        { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.REFUND_PENDING },
        { status: OrderStatus.COMPLETED, paymentStatus: PaymentStatus.REFUNDED },
        { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PARTIALLY_REFUNDED },
        // Reconciliation required on payment even though order status is PAID
        {
          status: OrderStatus.DELIVERED,
          paymentStatus: PaymentStatus.PAID,
          reconciliationRequired: true,
        },
        // Contradictory active PaymentRefund row while Order.paymentStatus says PAID
        {
          status: OrderStatus.COMPLETED,
          paymentStatus: PaymentStatus.PAID,
          refundStatus: PaymentRefundStatus.SUCCEEDED,
        },
        // Contradictory Payment row status
        {
          status: OrderStatus.COMPLETED,
          paymentStatus: PaymentStatus.PAID,
          paymentRowStatus: PaymentStatus.PENDING,
        },
      ];

      for (const spec of ineligibleSpecs) {
        await seedOrder({
          tenantId: tenantA.id,
          createdAt: recent,
          ...spec,
          items: [
            { productId: src.product.id, variantId: src.variants[0]!.id },
            { productId: candIneligible.product.id, variantId: candIneligible.variants[0]!.id },
          ],
        });
      }

      // Other-tenant eligible orders referencing same IDs -> must NEVER count for tenantA
      const prodB = await seedProduct({
        tenantId: tenantB.id,
        categoryId: catB.id,
        name: 'Tenant B Prod',
        basePrice: '10.00',
      });
      for (let i = 0; i < 3; i += 1) {
        await seedOrder({
          tenantId: tenantB.id,
          status: OrderStatus.COMPLETED,
          paymentStatus: PaymentStatus.PAID,
          createdAt: recent,
          items: [
            { productId: src.product.id, variantId: src.variants[0]!.id },
            { productId: candIneligible.product.id, variantId: candIneligible.variants[0]!.id },
            { productId: prodB.product.id, variantId: prodB.variants[0]!.id },
          ],
        });
      }

      // Special Order containing src + candIneligible -> must NEVER be included
      const req1 = await testPrisma.specialOrderRequest.create({
        data: {
          tenantId: tenantA.id,
          customerId: customerA1Id,
          number: 9001,
          contactPhone: '+15550001111',
          status: 'ORDER_CREATED',
          idempotencyKey: `so-req-${runId}`,
          requestFingerprint: `so-fp-${runId}`,
        },
      });
      const quote = await testPrisma.specialOrderQuotation.create({
        data: {
          requestId: req1.id,
          tenantId: tenantA.id,
          isDraft: false,
          status: 'ACCEPTED',
          currency: 'USD',
          taxCountryCode: 'US',
          sourcingDays: 2,
          publishedAt: new Date(Date.now() - 2 * DAY_MS),
          expiresAt: new Date(Date.now() + 2 * DAY_MS),
          items: {
            create: [
              {
                type: 'AVAILABLE',
                position: 0,
                name: 'SO Src',
                productId: src.product.id,
                variantId: src.variants[0]!.id,
                offeredQuantity: 1,
                unitPrice: '30.00',
                pricesIncludeTax: false,
                tax: {},
              },
              {
                type: 'AVAILABLE',
                position: 1,
                name: 'SO Cand',
                productId: candIneligible.product.id,
                variantId: candIneligible.variants[0]!.id,
                offeredQuantity: 1,
                unitPrice: '15.00',
                pricesIncludeTax: false,
                tax: {},
              },
            ],
          },
        },
        include: { items: true },
      });
      const acc = await testPrisma.specialOrderAcceptance.create({
        data: {
          quotationId: quote.id,
          selectionKey: 'all',
          snapshot: {},
        },
      });
      await testPrisma.specialOrder.create({
        data: {
          tenantId: tenantA.id,
          customerId: customerA1Id,
          requestId: req1.id,
          acceptanceId: acc.id,
          number: 9001,
          currency: 'USD',
          state: 'DELIVERED',
          paymentStatus: PaymentStatus.PAID,
          fulfillmentMethod: 'HOME_DELIVERY',
          warehouseId: activeWarehouseAId,
          sourcingStartedAt: recent,
          readyAt: recent,
          completedAt: recent,
          customerFirstName: 'QA',
          customerLastName: 'Customer',
          customerEmail: 'qa@example.test',
          customerPhone: '+15550001111',
          deliveryAddress: { city: 'Test', country: 'US' },
          shippingMethod: { code: 'std', name: 'Standard' },
          financials: {},
          grandTotal: '45.00',
          paymentTerms: {},
          initialPayment: '45.00',
          remainingBalance: '0.00',
          commercialTerms: {},
          sourcingDays: 2,
          idempotencyKey: `so-ord-${runId}`,
          requestFingerprint: `so-ofp-${runId}`,
          items: {
            create: quote.items.map((qi, idx) => ({
              quotationItemId: qi.id,
              position: idx,
              name: qi.name,
              productId: qi.productId,
              variantId: qi.variantId,
              quantity: 1,
              unitPrice: qi.unitPrice,
              pricesIncludeTax: false,
              tax: {},
              subtotalBeforeTax: qi.unitPrice,
              taxAmount: '0.00',
              totalIncludingTax: qi.unitPrice,
              hasImage: false,
            })),
          },
        },
      });

      const res = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);

      expect(
        res.body.data.complementary.items.map((x: { id: string }) => x.id),
      ).toEqual([candEligible.product.id]);
    });
  });

  // =========================================================================
  // C. CATEGORY RELATIONSHIPS API & DIRECT DB CONSTRAINTS
  // =========================================================================
  describe('C. Category Complementary Relationship API, RBAC, Concurrency & DB Probes', () => {
    it('enforces directional CRUD, ordering, max 12, validation, inactive target policy, rollback, concurrency, cascade delete, RBAC, and raw SQL constraints', async () => {
      const catSrc = await createCategory(tenantA.id, 'Shirts');
      const catTargets = [];
      for (let i = 0; i < 13; i += 1) {
        catTargets.push(await createCategory(tenantA.id, `Target ${i}`));
      }
      const catInactiveNew = await createCategory(tenantA.id, 'Inactive New', {
        isActive: false,
      });
      const catOtherTenant = await createCategory(tenantB.id, 'Other Tenant Cat');

      // RBAC: unauthenticated -> 401; CUSTOMER -> 403; non-member -> 403
      await request(app)
        .get(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(401);
      await request(app)
        .get(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .expect(403);
      // Non-member rejected by tenantMemberMiddleware (401/403)
      const nonMemberRes = await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send({ targetCategoryIds: [catTargets[0]!.id] });
      expect([401, 403]).toContain(nonMemberRes.status);

      // OWNER, ADMIN, MANAGER all allowed; ordered replacement & directional check
      const put1 = await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catTargets[2]!.id, catTargets[0]!.id] })
        .expect(200);
      expect(put1.body.data).toEqual([
        {
          id: catTargets[2]!.id,
          name: catTargets[2]!.name,
          slug: catTargets[2]!.slug,
          isActive: true,
          sortOrder: 0,
        },
        {
          id: catTargets[0]!.id,
          name: catTargets[0]!.name,
          slug: catTargets[0]!.slug,
          isActive: true,
          sortOrder: 1,
        },
      ]);

      // Reverse direction is empty (directional!)
      const reverseGet = await request(app)
        .get(`/api/v1/categories/${catTargets[2]!.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${managerAToken}`)
        .expect(200);
      expect(reverseGet.body.data).toEqual([]);

      // Repeated identical PUT produces identical state
      const repeatPut = await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ targetCategoryIds: [catTargets[2]!.id, catTargets[0]!.id] })
        .expect(200);
      expect(repeatPut.body.data).toEqual(put1.body.data);

      // Validation rejections & rollback preservation:
      // 1) >12 targets rejected
      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: catTargets.map((c) => c.id) })
        .expect(400);
      // 2) Duplicate IDs rejected
      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catTargets[0]!.id, catTargets[0]!.id] })
        .expect(400);
      // 3) Self-relationship rejected
      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catSrc.id] })
        .expect(400);
      // 4) Missing target rejected (404)
      const missingRes = await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [randomUUID()] })
        .expect(404);
      // 5) Cross-tenant target rejected with identical 404 code (no leak!)
      const crossRes = await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catTargets[1]!.id, catOtherTenant.id] })
        .expect(404);
      expect(crossRes.body.code).toBe(missingRes.body.code);
      // 6) Newly adding inactive target rejected (400)
      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catInactiveNew.id] })
        .expect(400);

      // Confirm previous configuration remained untouched after all rejected writes
      const preserved = await request(app)
        .get(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      expect(preserved.body.data.map((x: { id: string }) => x.id)).toEqual([
        catTargets[2]!.id,
        catTargets[0]!.id,
      ]);

      // Deactivate an already-configured target -> remains visible in GET and can be retained or removed
      await testPrisma.category.update({
        where: { id: catTargets[2]!.id },
        data: { isActive: false },
      });
      const withInactive = await request(app)
        .get(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      expect(withInactive.body.data[0].isActive).toBe(false);

      // Retaining the already-configured inactive target alongside a new active target succeeds
      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catTargets[2]!.id, catTargets[1]!.id] })
        .expect(200);

      // Exactly 12 targets allowed
      const twelveActive = catTargets
        .filter((c) => c.id !== catTargets[2]!.id)
        .slice(0, 12)
        .map((c) => c.id);
      const put12 = await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: twelveActive })
        .expect(200);
      expect(put12.body.data).toHaveLength(12);

      // Concurrent PUT replacements serialize cleanly (final state equals one full list, never mixed)
      const listOne = [catTargets[0]!.id, catTargets[1]!.id];
      const listTwo = [catTargets[3]!.id, catTargets[4]!.id, catTargets[5]!.id];
      const [c1, c2] = await Promise.all([
        request(app)
          .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
          .set('X-Tenant-Slug', tenantA.slug)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ targetCategoryIds: listOne }),
        request(app)
          .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
          .set('X-Tenant-Slug', tenantA.slug)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ targetCategoryIds: listTwo }),
      ]);
      expect(c1.status).toBe(200);
      expect(c2.status).toBe(200);
      const afterConcurrent = await request(app)
        .get(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      const finalIds = afterConcurrent.body.data.map((x: { id: string }) => x.id);
      expect([listOne, listTwo]).toContainEqual(finalIds);

      // Empty array clears all relationships
      const cleared = await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [] })
        .expect(200);
      expect(cleared.body.data).toEqual([]);

      // Category deletion cascades relationships cleanly
      const catDelTarget = await createCategory(tenantA.id, 'Cascade Target');
      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catDelTarget.id] })
        .expect(200);
      await testPrisma.category.delete({ where: { id: catDelTarget.id } });
      const afterCascade = await testPrisma.categoryComplementaryRelation.findMany({
        where: { tenantId: tenantA.id, sourceCategoryId: catSrc.id },
      });
      expect(afterCascade).toHaveLength(0);

      // Direct SQL database constraint probes (bypassing application validation)
      // 1) Self-relationship CHECK constraint
      await expect(
        testPrisma.$executeRaw`
          INSERT INTO "CategoryComplementaryRelation"
            ("id", "tenantId", "sourceCategoryId", "targetCategoryId", "sortOrder", "updatedAt")
          VALUES (${randomUUID()}, ${tenantA.id}, ${catSrc.id}, ${catSrc.id}, 0, NOW())
        `,
      ).rejects.toThrow();

      // 2) Negative sortOrder CHECK constraint
      await expect(
        testPrisma.$executeRaw`
          INSERT INTO "CategoryComplementaryRelation"
            ("id", "tenantId", "sourceCategoryId", "targetCategoryId", "sortOrder", "updatedAt")
          VALUES (${randomUUID()}, ${tenantA.id}, ${catSrc.id}, ${catTargets[0]!.id}, -1, NOW())
        `,
      ).rejects.toThrow();

      // 3) Cross-tenant composite FK constraint
      await expect(
        testPrisma.$executeRaw`
          INSERT INTO "CategoryComplementaryRelation"
            ("id", "tenantId", "sourceCategoryId", "targetCategoryId", "sortOrder", "updatedAt")
          VALUES (${randomUUID()}, ${tenantA.id}, ${catSrc.id}, ${catOtherTenant.id}, 0, NOW())
        `,
      ).rejects.toThrow();

      // 4) Duplicate (tenantId, sourceCategoryId, targetCategoryId) UNIQUE constraint
      await testPrisma.$executeRaw`
        INSERT INTO "CategoryComplementaryRelation"
          ("id", "tenantId", "sourceCategoryId", "targetCategoryId", "sortOrder", "updatedAt")
        VALUES (${randomUUID()}, ${tenantA.id}, ${catSrc.id}, ${catTargets[0]!.id}, 0, NOW())
      `;
      await expect(
        testPrisma.$executeRaw`
          INSERT INTO "CategoryComplementaryRelation"
            ("id", "tenantId", "sourceCategoryId", "targetCategoryId", "sortOrder", "updatedAt")
          VALUES (${randomUUID()}, ${tenantA.id}, ${catSrc.id}, ${catTargets[0]!.id}, 1, NOW())
        `,
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // D. HYBRID PARTIAL FILL & ROUND ROBIN FALLBACK
  // =========================================================================
  describe('D. Hybrid Partial Fill, Round Robin Distribution & Fallback Skip', () => {
    it('supports pure Round Robin fallback, partial fill with purchase-history priority, exhausted pools, inactive ancestor skipping, max 6 cap, and skips fallback when co-purchase fills limit', async () => {
      const catSrc = await createCategory(tenantA.id, 'RR Source Cat');
      const catA = await createCategory(tenantA.id, 'RR Cat A');
      const catB = await createCategory(tenantA.id, 'RR Cat B');
      const catC = await createCategory(tenantA.id, 'RR Cat C');
      const inactiveParent = await createCategory(tenantA.id, 'Inactive Parent', {
        isActive: false,
      });
      const catInactiveAncestor = await createCategory(tenantA.id, 'Active Child Under Inactive', {
        parentId: inactiveParent.id,
        isActive: true,
      });

      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catSrc.id,
        name: 'RR Source Product',
        basePrice: '20.00',
      });

      // Cat A: 1 eligible product + 1 out-of-stock product
      const a1 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catA.id,
        name: 'A1',
        basePrice: '10.00',
        createdAt: new Date('2026-06-10T00:00:00Z'),
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: catA.id,
        name: 'A-OutOfStock',
        basePrice: '10.00',
        stockQuantity: 0,
        createdAt: new Date('2026-06-11T00:00:00Z'),
      });

      // Cat B: 3 eligible products
      const b1 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catB.id,
        name: 'B1',
        basePrice: '10.00',
        createdAt: new Date('2026-06-10T00:00:00Z'),
      });
      const b2 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catB.id,
        name: 'B2',
        basePrice: '10.00',
        createdAt: new Date('2026-06-09T00:00:00Z'),
      });
      const b3 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catB.id,
        name: 'B3',
        basePrice: '10.00',
        createdAt: new Date('2026-06-08T00:00:00Z'),
      });

      // Cat C: 2 eligible products
      const c1 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catC.id,
        name: 'C1',
        basePrice: '10.00',
        createdAt: new Date('2026-06-10T00:00:00Z'),
      });
      const c2 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catC.id,
        name: 'C2',
        basePrice: '10.00',
        createdAt: new Date('2026-06-09T00:00:00Z'),
      });

      // Product under active category with inactive parent -> MUST be skipped
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: catInactiveAncestor.id,
        name: 'Hidden By Inactive Parent',
        basePrice: '10.00',
      });

      // Configure relations: [catA, catInactiveAncestor, catB, catC]
      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          targetCategoryIds: [catA.id, catInactiveAncestor.id, catB.id, catC.id],
        })
        .expect(200);

      // 1) Pure category fallback (0 orders): Round Robin A1, B1, C1, B2, C2, B3 (A exhausted after round 1; inactive ancestor skipped!)
      const rrOnly = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=6`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(
        rrOnly.body.data.complementary.items.map((x: { id: string }) => x.id),
      ).toEqual([
        a1.product.id,
        b1.product.id,
        c1.product.id,
        b2.product.id,
        c2.product.id,
        b3.product.id,
      ]);

      // 2) Hybrid Partial Fill: 2 purchase-history products (one is b1 from catB to test dedup, plus histExtra) + 4 fallback
      const histExtra = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catSrc.id,
        name: 'History Extra',
        basePrice: '12.00',
      });
      const recent = new Date(Date.now() - 2 * DAY_MS);
      for (let i = 0; i < 3; i += 1) {
        await seedOrder({
          tenantId: tenantA.id,
          createdAt: new Date(recent.getTime() + i * 1000),
          items: [
            { productId: src.product.id, variantId: src.variants[0]!.id },
            { productId: histExtra.product.id, variantId: histExtra.variants[0]!.id },
            ...(i < 2 ? [{ productId: b1.product.id, variantId: b1.variants[0]!.id }] : []),
          ],
        });
      }

      const hybridRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=6`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      // Purchase history first: histExtra (3), b1 (2)
      // Fallback fills remaining 4 slots via Round Robin (b1 excluded!): A1, B2, C1, B3
      expect(
        hybridRes.body.data.complementary.items.map((x: { id: string }) => x.id),
      ).toEqual([
        histExtra.product.id,
        b1.product.id,
        a1.product.id,
        b2.product.id,
        c1.product.id,
        b3.product.id,
      ]);

      // 3) When purchase history fills complementaryLimit (e.g., complementaryLimit=2), category fallback query is NOT executed!
      const fallbackSpy = vi.spyOn(
        productRecommendationRepository,
        'findActiveComplementaryTargetCategoryIds',
      );
      const fullHistRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=2`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(
        fullHistRes.body.data.complementary.items.map((x: { id: string }) => x.id),
      ).toEqual([histExtra.product.id, b1.product.id]);
      expect(fallbackSpy).not.toHaveBeenCalled();
      fallbackSpy.mockRestore();
    });
  });

  // =========================================================================
  // E. API COMPATIBILITY, DEDUPLICATION, QUERY COUNTS & INDEPENDENT FAILURES
  // =========================================================================
  describe('E. Legacy Compatibility, Cross-Section Deduplication & Independent Section Failures', () => {
    it('preserves exact legacy contract & query count, validates params strictly, supports all 4 toggle combos, deduplicates with backfill, and isolates section-local errors', async () => {
      const cat = await createCategory(tenantA.id, 'CompatCat');
      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Compat Source',
        basePrice: '50.00',
      });

      // 4 similar candidates in same category at prices 51, 52, 53, 54
      const sim1 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Sim 1 (also co-purchased)',
        basePrice: '51.00',
      });
      const sim2 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Sim 2',
        basePrice: '52.00',
      });
      const sim3 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Sim 3',
        basePrice: '53.00',
      });
      const sim4 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Sim 4',
        basePrice: '54.00',
      });

      // Make sim1 a reliable co-purchase complement
      const recent = new Date(Date.now() - 2 * DAY_MS);
      for (let i = 0; i < 3; i += 1) {
        await seedOrder({
          tenantId: tenantA.id,
          createdAt: recent,
          items: [
            { productId: src.product.id, variantId: src.variants[0]!.id },
            { productId: sim1.product.id, variantId: sim1.variants[0]!.id },
          ],
        });
      }

      // 1) Legacy request (no includeComplementary) & explicit includeComplementary=false
      const coPurchaseSpy = vi.spyOn(
        productRecommendationRepository,
        'findComplementaryCoPurchaseCandidates',
      );
      const legacyRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(Object.keys(legacyRes.body.data).sort()).toEqual(['enabled', 'items']);
      expect(legacyRes.body.data.enabled).toBe(true);
      expect(legacyRes.body.data.items.map((x: { id: string }) => x.id)).toEqual([
        sim1.product.id,
        sim2.product.id,
        sim3.product.id,
      ]);

      const explicitFalseRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3&includeComplementary=false`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(explicitFalseRes.body.data).toEqual(legacyRes.body.data);
      expect(coPurchaseSpy).not.toHaveBeenCalled();
      coPurchaseSpy.mockRestore();

      // 2) Invalid booleans and invalid limits rejected (400)
      for (const bad of ['yes', '1', '0', 'TRUE', 'invalid', '']) {
        await request(app)
          .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=${bad}`)
          .set('X-Tenant-Slug', tenantA.slug)
          .expect(400);
      }
      for (const badLimit of ['0', '16', '-1', 'abc']) {
        await request(app)
          .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true&complementaryLimit=${badLimit}`)
          .set('X-Tenant-Slug', tenantA.slug)
          .expect(400);
      }

      // 3) Opt-in (Both enabled): Complementary claims sim1; Similar backfills to [sim2, sim3, sim4] (still 3 items!)
      const bothRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3&includeComplementary=true&complementaryLimit=6`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(bothRes.body.data.enabled).toBe(true);
      expect(bothRes.body.data.complementary.enabled).toBe(true);
      expect(
        bothRes.body.data.complementary.items.map((x: { id: string }) => x.id),
      ).toEqual([sim1.product.id]);
      expect(bothRes.body.data.items.map((x: { id: string }) => x.id)).toEqual([
        sim2.product.id,
        sim3.product.id,
        sim4.product.id,
      ]);

      // 4) Toggle combo: Similar=true, Complementary=false -> sim1 stays in Similar!
      await testPrisma.appSetting.create({
        data: {
          tenantId: tenantA.id,
          key: 'show_complementary_products',
          value: false,
          isPublic: true,
        },
      });
      const simOnlyRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3&includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(simOnlyRes.body.data.enabled).toBe(true);
      expect(simOnlyRes.body.data.items.map((x: { id: string }) => x.id)).toEqual([
        sim1.product.id,
        sim2.product.id,
        sim3.product.id,
      ]);
      expect(simOnlyRes.body.data.complementary).toEqual({
        enabled: false,
        items: [],
      });

      // 5) Toggle combo: Similar=false, Complementary=true
      await testPrisma.appSetting.update({
        where: {
          tenantId_key: {
            tenantId: tenantA.id,
            key: 'show_complementary_products',
          },
        },
        data: { value: true },
      });
      await testPrisma.appSetting.create({
        data: {
          tenantId: tenantA.id,
          key: 'show_similar_products',
          value: false,
          isPublic: true,
        },
      });
      const compOnlyRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3&includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(compOnlyRes.body.data.enabled).toBe(false);
      expect(compOnlyRes.body.data.items).toEqual([]);
      expect(compOnlyRes.body.data.complementary.enabled).toBe(true);
      expect(
        compOnlyRes.body.data.complementary.items.map((x: { id: string }) => x.id),
      ).toEqual([sim1.product.id]);

      // 6) Toggle combo: Both disabled -> 404 still enforced for nonexistent product; valid product returns both disabled
      await testPrisma.appSetting.update({
        where: {
          tenantId_key: {
            tenantId: tenantA.id,
            key: 'show_complementary_products',
          },
        },
        data: { value: false },
      });
      const bothDisabledRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(bothDisabledRes.body.data).toEqual({
        enabled: false,
        items: [],
        complementary: { enabled: false, items: [] },
      });
      await request(app)
        .get(`/api/v1/products/${randomUUID()}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(404);

      // Re-enable both for independent failure tests
      await testPrisma.appSetting.deleteMany({
        where: {
          tenantId: tenantA.id,
          key: { in: ['show_similar_products', 'show_complementary_products'] },
        },
      });

      // 7) Independent failure: complementary query throws -> Similar still returns [sim1, sim2, sim3] (nothing removed!)
      const failCompSpy = vi
        .spyOn(
          productRecommendationRepository,
          'findComplementaryCoPurchaseCandidates',
        )
        .mockRejectedValueOnce(new Error('Simulated co-purchase DB failure'));
      const compFailRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3&includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(compFailRes.body.data.enabled).toBe(true);
      expect(compFailRes.body.data.items.map((x: { id: string }) => x.id)).toEqual([
        sim1.product.id,
        sim2.product.id,
        sim3.product.id,
      ]);
      expect(compFailRes.body.data.complementary).toEqual({
        enabled: true,
        items: [],
      });
      failCompSpy.mockRestore();

      // 8) Independent failure: similar query throws -> Complementary still returns [sim1]!
      const failSimSpy = vi
        .spyOn(productRecommendationRepository, 'findEligibleCandidateIds')
        .mockRejectedValueOnce(new Error('Simulated similar DB failure'));
      const simFailRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3&includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(simFailRes.body.data.enabled).toBe(true);
      expect(simFailRes.body.data.items).toEqual([]);
      expect(
        simFailRes.body.data.complementary.items.map((x: { id: string }) => x.id),
      ).toEqual([sim1.product.id]);
      failSimSpy.mockRestore();

      // 9) Both section queries fail -> propagates 500 error (not masked as empty 200)
      const failBothComp = vi
        .spyOn(
          productRecommendationRepository,
          'findComplementaryCoPurchaseCandidates',
        )
        .mockRejectedValueOnce(new Error('DB down comp'));
      const failBothSim = vi
        .spyOn(productRecommendationRepository, 'findEligibleCandidateIds')
        .mockRejectedValueOnce(new Error('DB down sim'));
      await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3&includeComplementary=true`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(500);
      failBothComp.mockRestore();
      failBothSim.mockRestore();
    });
  });

  // =========================================================================
  // F. PRODUCTCARD DTO, KWD PRECISION, WISHLIST & QUICK ADD
  // =========================================================================
  describe('F. ProductCard Contract, KWD Precision, Wishlist Isolation & Quick Add Option B', () => {
    it('returns complete ProductCard DTO with KWD 3-decimal pricing, offers, per-user wishlist isolation, Quick Add rules, and zero internal data leakage', async () => {
      const catSrc = await createCategory(tenantKwd.id, 'KWD Source');
      const catTarget = await createCategory(tenantKwd.id, 'KWD Complements');

      const kwdCust1 = await createUser('kwd-c1', tenantKwd.id, 'CUSTOMER');
      const kwdCust2 = await createUser('kwd-c2', tenantKwd.id, 'CUSTOMER');

      const src = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: catSrc.id,
        name: 'KWD Source',
        basePrice: '10.000',
      });
      // Active 20% offer, simple Quick Add eligible
      const simpleOffer = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: catTarget.id,
        name: 'Simple Discounted KWD',
        basePrice: '12.500',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '20',
        discountStartsAt: new Date(Date.now() - DAY_MS),
        discountEndsAt: new Date(Date.now() + DAY_MS),
        createdAt: new Date('2026-06-10T00:00:00Z'),
      });
      // Expired offer, variant-required (has attributes + selectable variants -> canQuickAdd: false)
      const variantReq = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: catTarget.id,
        name: 'Variant Required Expired Offer',
        basePrice: '8.250',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '50',
        discountStartsAt: new Date(Date.now() - 10 * DAY_MS),
        discountEndsAt: new Date(Date.now() - DAY_MS),
        attributeNames: ['Size'],
        variants: [
          { isDefault: false, isActive: true, price: '8.250', quantity: 5 },
          { isDefault: false, isActive: true, price: '9.000', quantity: 5 },
        ],
        createdAt: new Date('2026-06-09T00:00:00Z'),
      });

      await request(app)
        .put(`/api/v1/categories/${catSrc.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantKwd.slug)
        .set('Authorization', `Bearer ${ownerKwdToken}`)
        .send({ targetCategoryIds: [catTarget.id] })
        .expect(200);

      // Add simpleOffer to kwdCust1's wishlist ONLY
      const wl = await testPrisma.wishlist.create({
        data: { tenantId: tenantKwd.id, userId: kwdCust1.id },
      });
      await testPrisma.wishlistItem.create({
        data: { wishlistId: wl.id, productId: simpleOffer.product.id },
      });

      // Guest request -> isInWishlist false for all
      const guestRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantKwd.slug)
        .expect(200);
      expect(findForbiddenKeys(guestRes.body)).toEqual([]);
      const guestItems = guestRes.body.data.complementary.items;
      expect(guestItems).toHaveLength(2);
      expect(guestItems[0]).toMatchObject({
        id: simpleOffer.product.id,
        isInWishlist: false,
        price: { original: '12.500', final: '10.000', discountPercentage: 20 },
        hasVariants: false,
        defaultVariantId: simpleOffer.variants[0]!.id,
        canQuickAdd: true,
      });
      expect(guestItems[1]).toMatchObject({
        id: variantReq.product.id,
        isInWishlist: false,
        price: { original: '8.250', final: '8.250', discountPercentage: null },
        hasVariants: true,
        defaultVariantId: null,
        canQuickAdd: false,
      });

      // Authenticated Customer 1 sees isInWishlist=true on simpleOffer; Customer 2 sees false!
      const c1Res = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantKwd.slug)
        .set('Authorization', `Bearer ${kwdCust1.token}`)
        .expect(200);
      expect(c1Res.body.data.complementary.items[0].isInWishlist).toBe(true);
      expect(c1Res.body.data.complementary.items[1].isInWishlist).toBe(false);

      const c2Res = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?includeComplementary=true`)
        .set('X-Tenant-Slug', tenantKwd.slug)
        .set('Authorization', `Bearer ${kwdCust2.token}`)
        .expect(200);
      expect(c2Res.body.data.complementary.items[0].isInWishlist).toBe(false);
    });
  });

  // =========================================================================
  // G. STORE SETTINGS (show_complementary_products)
  // =========================================================================
  describe('G. Store Setting (show_complementary_products) Validation & Exposure', () => {
    it('defaults to true, enforces strict boolean & public validation, fails closed on malformed/non-public legacy rows, stays independent of showSimilarProducts, and exposes via /app-settings and /storefront', async () => {
      // Absent -> defaults to true on both /app-settings and /storefront
      const pubDefault = await request(app)
        .get('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(pubDefault.body.data.showComplementaryProducts).toBe(true);
      expect(pubDefault.body.data.showSimilarProducts).toBe(true);

      const sfDefault = await request(app)
        .get('/api/v1/storefront')
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(sfDefault.body.data.settings.showComplementaryProducts).toBe(true);

      // Reject invalid writes: string "true", string "false", isPublic: false
      for (const badPayload of [
        { key: 'show_complementary_products', value: 'true', isPublic: true },
        { key: 'show_complementary_products', value: 'false', isPublic: true },
        { key: 'show_complementary_products', value: true, isPublic: false },
      ]) {
        await request(app)
          .post('/api/v1/app-settings')
          .set('X-Tenant-Slug', tenantA.slug)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send(badPayload)
          .expect(400);
      }

      // Valid create false -> only showComplementaryProducts flips; showSimilarProducts untouched
      await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          key: 'show_complementary_products',
          value: false,
          isPublic: true,
        })
        .expect(201);

      const sfOff = await request(app)
        .get('/api/v1/storefront')
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(sfOff.body.data.settings.showComplementaryProducts).toBe(false);
      expect(sfOff.body.data.settings.showSimilarProducts).toBe(true);

      // Invalid PATCH rejected
      await request(app)
        .patch('/api/v1/app-settings/show_complementary_products')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ value: 'true' })
        .expect(400);
      await request(app)
        .patch('/api/v1/app-settings/show_complementary_products')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ isPublic: false })
        .expect(400);

      // Valid PATCH true
      await request(app)
        .patch('/api/v1/app-settings/show_complementary_products')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ value: true })
        .expect(200);
      const sfOn = await request(app)
        .get('/api/v1/storefront')
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(sfOn.body.data.settings.showComplementaryProducts).toBe(true);

      // Non-public legacy row fails closed to false
      await testPrisma.appSetting.update({
        where: {
          tenantId_key: {
            tenantId: tenantA.id,
            key: 'show_complementary_products',
          },
        },
        data: { isPublic: false, value: true },
      });
      const sfNonPublic = await request(app)
        .get('/api/v1/storefront')
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(sfNonPublic.body.data.settings.showComplementaryProducts).toBe(false);

      // Malformed legacy value fails closed to false
      await testPrisma.appSetting.update({
        where: {
          tenantId_key: {
            tenantId: tenantA.id,
            key: 'show_complementary_products',
          },
        },
        data: { isPublic: true, value: 'true' },
      });
      const sfMalformed = await request(app)
        .get('/api/v1/storefront')
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);
      expect(sfMalformed.body.data.settings.showComplementaryProducts).toBe(false);
    });
  });

  // =========================================================================
  // QUERY COUNT VERIFICATION (LEGACY vs OPT-IN)
  // =========================================================================
  describe('Query Count Preservation (Legacy vs Opt-in)', () => {
    it('preserves exact legacy query count and keeps opt-in queries bounded with single batched enrichment', async () => {
      const cat = await createCategory(tenantA.id, 'QC Cat');
      const catTarget = await createCategory(tenantA.id, 'QC Target');
      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'QC Source',
        basePrice: '20.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'QC Similar',
        basePrice: '21.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: catTarget.id,
        name: 'QC Fallback',
        basePrice: '15.00',
      });
      await request(app)
        .put(`/api/v1/categories/${cat.id}/complementary-categories`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ targetCategoryIds: [catTarget.id] })
        .expect(200);

      const countSqlQueries = async (fn: () => Promise<void>) => {
        const origQuery = pg.Client.prototype.query;
        let count = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pg.Client.prototype.query = function (...args: any[]) {
          count += 1;
          return origQuery.apply(this, args as Parameters<typeof origQuery>);
        } as typeof pg.Client.prototype.query;
        try {
          await fn();
        } finally {
          pg.Client.prototype.query = origQuery;
        }
        return count;
      };

      const legacyCount = await countSqlQueries(async () => {
        await request(app)
          .get(`/api/v1/products/${src.product.id}/recommendations?limit=8`)
          .set('X-Tenant-Slug', tenantA.slug)
          .expect(200);
      });

      const explicitFalseCount = await countSqlQueries(async () => {
        await request(app)
          .get(
            `/api/v1/products/${src.product.id}/recommendations?limit=8&includeComplementary=false`,
          )
          .set('X-Tenant-Slug', tenantA.slug)
          .expect(200);
      });

      const optInCount = await countSqlQueries(async () => {
        await request(app)
          .get(`/api/v1/products/${src.product.id}/recommendations?limit=8&includeComplementary=true`)
          .set('X-Tenant-Slug', tenantA.slug)
          .expect(200);
      });

      // Legacy matches exact PR.1A query count (<=16 including Prisma relation queries & tenant/rate-limit)
      expect(legacyCount).toBeLessThanOrEqual(16);
      expect(explicitFalseCount).toBe(legacyCount);
      expect(optInCount).toBeLessThanOrEqual(24);
    });
  });
});
