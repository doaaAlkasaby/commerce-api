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
  ProductStatus,
} from '../../src/generated/prisma/client.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import { createInventoryFixture, fixtureWarehouse } from '../helpers/warehouse.js';

const FORBIDDEN_DTO_KEYS = new Set([
  'storagekey',
  'imagestoragekey',
  'warehouseid',
  'quantity',
  'reservedquantity',
  'availablequantity',
  'passwordhash',
  'suppliercost',
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

describe('PR.1A — Automatic Similar Products Integration Tests', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const tenantKwd = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createdUserIds: string[] = [];
  let ownerAToken: string;
  let customerA1Id: string;
  let customerA1Token: string;
  let customerA2Token: string;
  let ownerBToken: string;

  let activeWarehouseAId: string;
  let inactiveWarehouseAId: string;
  let activeWarehouseBId: string;
  let activeWarehouseKwdId: string;

  const createUser = async (
    label: string,
    tenantId: string,
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER',
  ) => {
    const user = await testPrisma.user.create({
      data: {
        email: `pr1a-${label}-${runId}@example.test`,
        passwordHash: 'test-hash',
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

  const createBrand = async (
    tenantId: string,
    name: string,
    isActive = true,
  ) => {
    const uid = randomUUID().slice(0, 8);
    return testPrisma.brand.create({
      data: {
        tenantId,
        name,
        slug: `brand-${uid}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        isActive,
      },
    });
  };

  interface SeedProductOptions {
    id?: string;
    tenantId: string;
    categoryId: string;
    brandId?: string | null;
    name: string;
    basePrice: string;
    status?: ProductStatus;
    createdAt?: Date;
    discountType?: DiscountType | null;
    discountValue?: string | null;
    discountStartsAt?: Date | null;
    discountEndsAt?: Date | null;
    imageUrl?: string;
    variants?: Array<{
      price?: string | null;
      isDefault?: boolean;
      isActive?: boolean;
      discountType?: DiscountType | null;
      discountValue?: string | null;
      discountStartsAt?: Date | null;
      discountEndsAt?: Date | null;
      stocks?: Array<{
        warehouseId: string;
        tenantId?: string;
        quantity: number;
        reservedQuantity?: number;
      }>;
    }>;
    attributeNames?: string[];
  }

  const seedProduct = async (opts: SeedProductOptions) => {
    const uid = randomUUID().slice(0, 8);
    const product = await testPrisma.product.create({
      data: {
        ...(opts.id ? { id: opts.id } : {}),
        tenantId: opts.tenantId,
        categoryId: opts.categoryId,
        brandId: opts.brandId ?? null,
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

    if (opts.imageUrl) {
      await testPrisma.productImage.create({
        data: {
          productId: product.id,
          storageKey: `private/products/${product.id}.webp`,
          url: opts.imageUrl,
          isPrimary: true,
          sortOrder: 0,
        },
      });
    }

    if (opts.attributeNames?.length) {
      for (let i = 0; i < opts.attributeNames.length; i++) {
        await testPrisma.productAttribute.create({
          data: {
            productId: product.id,
            name: opts.attributeNames[i]!,
            sortOrder: i,
          },
        });
      }
    }

    const defaultWarehouseId =
      opts.tenantId === tenantA.id
        ? activeWarehouseAId
        : opts.tenantId === tenantB.id
          ? activeWarehouseBId
          : activeWarehouseKwdId;

    const variantDefs =
      opts.variants ??
      [
        {
          isDefault: true,
          isActive: true,
          stocks: [{ warehouseId: defaultWarehouseId, quantity: 10 }],
        },
      ];

    const createdVariants = [];
    for (let idx = 0; idx < variantDefs.length; idx++) {
      const v = variantDefs[idx]!;
      const variant = await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `SKU-${uid}-${idx}-${randomUUID().slice(0, 4)}`,
          combinationKey: `combo-${uid}-${idx}-${randomUUID().slice(0, 4)}`,
          price: v.price ?? null,
          isDefault: v.isDefault ?? false,
          isActive: v.isActive ?? true,
          discountType: v.discountType ?? null,
          discountValue: v.discountValue ?? null,
          discountStartsAt: v.discountStartsAt ?? null,
          discountEndsAt: v.discountEndsAt ?? null,
        },
      });
      createdVariants.push(variant);

      for (const stock of v.stocks ?? []) {
        await createInventoryFixture({
          data: {
            variantId: variant.id,
            warehouseId: stock.warehouseId,
            quantity: stock.quantity,
            reservedQuantity: stock.reservedQuantity ?? 0,
          },
        });
      }
    }

    return { product, variants: createdVariants };
  };

  const countSqlQueries = async <T>(fn: () => Promise<T>) => {
    const queries: string[] = [];
    const clientProto = pg.Client.prototype as unknown as {
      query: (...args: unknown[]) => unknown;
    };
    const origClientQuery = clientProto.query;
    const spy = vi
      .spyOn(clientProto, 'query')
      .mockImplementation(function (this: unknown, ...args: unknown[]) {
        const first = args[0];
        const sql =
          typeof first === 'string'
            ? first
            : typeof first === 'object' &&
                first !== null &&
                'text' in first &&
                typeof (first as { text?: unknown }).text === 'string'
              ? (first as { text: string }).text
              : 'UNKNOWN';
        queries.push(sql);
        return origClientQuery.apply(this, args);
      });
    try {
      const result = await fn();
      return { result, count: queries.length, queries };
    } finally {
      spy.mockRestore();
    }
  };

  beforeAll(async () => {
    await tenantA.create();
    await tenantB.create();
    await testPrisma.tenant.create({
      data: {
        id: tenantKwd.id,
        name: 'Kuwait Store',
        slug: tenantKwd.slug,
        code: `KWD_${tenantKwd.id}`,
        defaultCurrency: 'KWD',
      },
    });

    const whA = await fixtureWarehouse(tenantA.id);
    activeWarehouseAId = whA.id;
    const inactiveWhA = await testPrisma.warehouse.create({
      data: {
        tenantId: tenantA.id,
        code: `inactive-wh-${runId}`,
        name: 'Inactive Warehouse A',
        countryCode: whA.countryCode,
        city: 'City',
        address: 'Address',
        isActive: false,
      },
    });
    inactiveWarehouseAId = inactiveWhA.id;

    activeWarehouseBId = (await fixtureWarehouse(tenantB.id)).id;
    activeWarehouseKwdId = (await fixtureWarehouse(tenantKwd.id)).id;

    ownerAToken = (await createUser('ownerA', tenantA.id, 'OWNER')).token;
    const c1 = await createUser('custA1', tenantA.id, 'CUSTOMER');
    customerA1Id = c1.id;
    customerA1Token = c1.token;
    const c2 = await createUser('custA2', tenantA.id, 'CUSTOMER');
    customerA2Token = c2.token;
    ownerBToken = (await createUser('ownerB', tenantB.id, 'OWNER')).token;
  });

  beforeEach(async () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      globalRateLimiter.resetKey(ipKeyGenerator(ip));
      sensitiveRateLimiter.resetKey(ipKeyGenerator(ip));
    }
    await testPrisma.appSetting.deleteMany({
      where: {
        tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] },
        key: 'show_similar_products',
      },
    });
  });

  afterAll(async () => {
    await testPrisma.wishlistItem.deleteMany({
      where: { wishlist: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } } },
    });
    await testPrisma.wishlist.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
    });
    await testPrisma.productReview.deleteMany({
      where: { product: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } } },
    });
    await testPrisma.appSetting.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id, tenantKwd.id] } },
    });
    await tenantA.cleanup();
    await tenantB.cleanup();
    await tenantKwd.cleanup();
    if (createdUserIds.length > 0) {
      await testPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  });

  // ========================================================================
  // 1. SELECTION, PRIORITY GROUPS, RANKING & LIMITS
  // ========================================================================
  describe('Selection, Priority Groups, Pricing & Ranking', () => {
    it('enforces Group 1 (same category + same active brand) > Group 2 (same category + other brands) > Group 3 (active sibling category), price proximity, and deterministic tie-breaking', async () => {
      const parent = await createCategory(tenantA.id, 'Footwear');
      const directCat = await createCategory(tenantA.id, 'Running Shoes', {
        parentId: parent.id,
      });
      const siblingCat = await createCategory(tenantA.id, 'Trail Shoes', {
        parentId: parent.id,
      });
      const unrelatedRoot = await createCategory(tenantA.id, 'Electronics');
      const unrelatedChild = await createCategory(tenantA.id, 'Headphones', {
        parentId: unrelatedRoot.id,
      });

      const brandAlpha = await createBrand(tenantA.id, 'Alpha');
      const brandBeta = await createBrand(tenantA.id, 'Beta');

      const source = await seedProduct({
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: brandAlpha.id,
        name: 'Source Runner',
        basePrice: '100.00',
      });

      const t1 = new Date('2026-01-01T10:00:00.000Z');
      const t2 = new Date('2026-01-02T10:00:00.000Z');

      // Group 1 (same brand): one closer (105), one farther (130), two tied at 110 with different createdAt, two tied at 120 with same createdAt
      const g1Close = await seedProduct({
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: brandAlpha.id,
        name: 'G1 Close',
        basePrice: '105.00',
        createdAt: t1,
      });
      const g1TieNewer = await seedProduct({
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: brandAlpha.id,
        name: 'G1 Tie Newer',
        basePrice: '110.00',
        createdAt: t2,
      });
      const g1TieOlder = await seedProduct({
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: brandAlpha.id,
        name: 'G1 Tie Older',
        basePrice: '110.00',
        createdAt: t1,
      });
      const idLow = '00000000-0000-4000-8000-000000000001';
      const idHigh = '00000000-0000-4000-8000-000000000002';
      const g1IdTieHigh = await seedProduct({
        id: idHigh,
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: brandAlpha.id,
        name: 'G1 ID Tie High',
        basePrice: '120.00',
        createdAt: t1,
      });
      const g1IdTieLow = await seedProduct({
        id: idLow,
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: brandAlpha.id,
        name: 'G1 ID Tie Low',
        basePrice: '120.00',
        createdAt: t1,
      });

      // Group 2 (other brand, exact same price 100.00 — MUST still rank after Group 1!)
      const g2OtherBrand = await seedProduct({
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: brandBeta.id,
        name: 'G2 Other Brand Exact Price',
        basePrice: '100.00',
      });
      // Group 2 (no brand)
      const g2NoBrand = await seedProduct({
        tenantId: tenantA.id,
        categoryId: directCat.id,
        brandId: null,
        name: 'G2 No Brand',
        basePrice: '102.00',
      });

      // Group 3 (sibling category — needed for slot #8 since direct has 7 candidates)
      const g3Sibling = await seedProduct({
        tenantId: tenantA.id,
        categoryId: siblingCat.id,
        brandId: brandAlpha.id,
        name: 'G3 Sibling',
        basePrice: '100.00',
      });

      // Unrelated category — MUST NEVER appear
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: unrelatedChild.id,
        brandId: brandAlpha.id,
        name: 'Unrelated Product',
        basePrice: '100.00',
      });

      const res = await request(app)
        .get(`/api/v1/products/${source.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeNull();
      expect(res.body.data.enabled).toBe(true);

      const ids = res.body.data.items.map((item: { id: string }) => item.id);
      expect(ids).toEqual([
        g1Close.product.id,
        g1TieNewer.product.id,
        g1TieOlder.product.id,
        g1IdTieLow.product.id,
        g1IdTieHigh.product.id,
        g2OtherBrand.product.id,
        g2NoBrand.product.id,
        g3Sibling.product.id,
      ]);
      // Current product excluded & zero duplicates
      expect(ids).not.toContain(source.product.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('skips Group 1 when source has NULL brand or inactive brand, never treating NULL == NULL as same-brand', async () => {
      const cat = await createCategory(tenantA.id, 'NoBrandCat');
      const activeBrand = await createBrand(tenantA.id, 'ActiveB', true);
      const inactiveBrand = await createBrand(tenantA.id, 'InactiveB', false);

      // Source with NULL brand at 50.00
      const nullBrandSource = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: null,
        name: 'Null Source',
        basePrice: '50.00',
      });
      // Candidate with NULL brand far away in price (90.00)
      const nullBrandFar = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: null,
        name: 'Null Far',
        basePrice: '90.00',
      });
      // Candidate with ActiveB very close in price (51.00) — MUST rank ahead of Null Far!
      const brandedClose = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: activeBrand.id,
        name: 'Branded Close',
        basePrice: '51.00',
      });

      const resNull = await request(app)
        .get(`/api/v1/products/${nullBrandSource.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);

      expect(resNull.status).toBe(200);
      expect(
        resNull.body.data.items.map((i: { id: string }) => i.id),
      ).toEqual([brandedClose.product.id, nullBrandFar.product.id]);

      // Inactive source brand: another product with same inactiveBrand at 95.00 must NOT beat closer activeBrand at 51.00
      const inactiveSource = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: inactiveBrand.id,
        name: 'Inactive Brand Source',
        basePrice: '50.00',
      });
      const sameInactiveFar = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: inactiveBrand.id,
        name: 'Same Inactive Far',
        basePrice: '95.00',
      });

      const resInactive = await request(app)
        .get(`/api/v1/products/${inactiveSource.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);

      expect(resInactive.status).toBe(200);
      const inactiveIds = resInactive.body.data.items.map(
        (i: { id: string }) => i.id,
      );
      expect(inactiveIds.indexOf(brandedClose.product.id)).toBeLessThan(
        inactiveIds.indexOf(sameInactiveFar.product.id),
      );
    });

    it('preserves strict same-brand priority even when 35 closer-priced other-brand candidates exist', async () => {
      const cat = await createCategory(tenantA.id, 'CrowdedCat');
      const myBrand = await createBrand(tenantA.id, 'MyBrand');
      const otherBrand = await createBrand(tenantA.id, 'OtherBrand');

      const source = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: myBrand.id,
        name: 'Source Crowded',
        basePrice: '100.00',
      });

      // 35 other-brand products at exact same price 100.00
      for (let i = 0; i < 35; i++) {
        await seedProduct({
          tenantId: tenantA.id,
          categoryId: cat.id,
          brandId: otherBrand.id,
          name: `Other ${i}`,
          basePrice: '100.00',
        });
      }

      // 2 same-brand products farther in price (250.00 & 300.00)
      const sameBrand1 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: myBrand.id,
        name: 'Same Brand 1',
        basePrice: '250.00',
      });
      const sameBrand2 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        brandId: myBrand.id,
        name: 'Same Brand 2',
        basePrice: '300.00',
      });

      const res = await request(app)
        .get(`/api/v1/products/${source.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(8);
      // Both same-brand products MUST take positions 0 and 1!
      expect(res.body.data.items[0].id).toBe(sameBrand1.product.id);
      expect(res.body.data.items[1].id).toBe(sameBrand2.product.id);
    });

    it('ranks by exact effective price including active product/variant discounts, ignores expired discounts, and handles 3-decimal KWD precision', async () => {
      const cat = await createCategory(tenantKwd.id, 'KwdPerfumes');
      const pastStart = new Date(Date.now() - 86_400_000 * 10);
      const pastEnd = new Date(Date.now() - 86_400_000 * 2);
      const futureEnd = new Date(Date.now() + 86_400_000 * 10);

      // Source at 20.000 KWD
      const source = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: cat.id,
        name: 'Source KWD',
        basePrice: '20.000',
      });

      // Candidate A: basePrice 40.000 with active 50% product discount -> effective 20.000 (diff = 0.000)
      const activeDiscountCand = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: cat.id,
        name: 'Active Discount Exact Match',
        basePrice: '40.000',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '50.00',
        discountStartsAt: pastStart,
        discountEndsAt: futureEnd,
      });

      // Candidate B: basePrice 20.005 (diff = 0.005 KWD = 5 fils)
      const kwdClose5Fils = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: cat.id,
        name: 'KWD 5 Fils Diff',
        basePrice: '20.005',
      });

      // Candidate C: basePrice 20.015 (diff = 0.015 KWD = 15 fils)
      const kwd15Fils = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: cat.id,
        name: 'KWD 15 Fils Diff',
        basePrice: '20.015',
      });

      // Candidate D: variant discount active: variant price 25.000, fixed discount 4.990 -> effective 20.010 (diff = 10 fils)
      const variantDiscountCand = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: cat.id,
        name: 'Variant Discount 10 Fils Diff',
        basePrice: '25.000',
        variants: [
          {
            isDefault: true,
            isActive: true,
            price: '25.000',
            discountType: DiscountType.FIXED_AMOUNT,
            discountValue: '4.990',
            discountStartsAt: pastStart,
            discountEndsAt: futureEnd,
            stocks: [{ warehouseId: activeWarehouseKwdId, quantity: 5 }],
          },
        ],
      });

      // Candidate E: expired discount (basePrice 35.000, expired 50% discount -> effective stays 35.000, diff = 15.000)
      const expiredDiscountCand = await seedProduct({
        tenantId: tenantKwd.id,
        categoryId: cat.id,
        name: 'Expired Discount',
        basePrice: '35.000',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '50.00',
        discountStartsAt: pastStart,
        discountEndsAt: pastEnd,
      });

      const res = await request(app)
        .get(`/api/v1/products/${source.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantKwd.slug);

      expect(res.status).toBe(200);
      expect(
        res.body.data.items.map((i: { id: string }) => i.id),
      ).toEqual([
        activeDiscountCand.product.id, // 20.000 (0 fils)
        kwdClose5Fils.product.id, // 20.005 (5 fils)
        variantDiscountCand.product.id, // 20.010 (10 fils)
        kwd15Fils.product.id, // 20.015 (15 fils)
        expiredDiscountCand.product.id, // 35.000 (15000 fils)
      ]);
      expect(res.body.data.items[0].price.final).toBe('20.000');
      expect(res.body.data.items[4].price.final).toBe('35.000');
    });

    it('supports custom valid limit (1..8), defaults to 8, returns fewer when sparse, and rejects invalid limits', async () => {
      const cat = await createCategory(tenantA.id, 'LimitCat');
      const source = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Limit Source',
        basePrice: '10.00',
      });
      for (let i = 0; i < 10; i++) {
        await seedProduct({
          tenantId: tenantA.id,
          categoryId: cat.id,
          name: `Limit Item ${i}`,
          basePrice: `${11 + i}.00`,
        });
      }

      const defaultRes = await request(app)
        .get(`/api/v1/products/${source.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.data.items).toHaveLength(8);

      const customRes = await request(app)
        .get(`/api/v1/products/${source.product.id}/recommendations?limit=3`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(customRes.status).toBe(200);
      expect(customRes.body.data.items).toHaveLength(3);

      const minRes = await request(app)
        .get(`/api/v1/products/${source.product.id}/recommendations?limit=1`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(minRes.status).toBe(200);
      expect(minRes.body.data.items).toHaveLength(1);

      for (const badLimit of ['0', '-1', '9', '1.5', 'abc', '']) {
        const badRes = await request(app)
          .get(
            `/api/v1/products/${source.product.id}/recommendations?limit=${encodeURIComponent(badLimit)}`,
          )
          .set('X-Tenant-Slug', tenantA.slug);
        expect(badRes.status).toBe(400);
      }

      // Fewer than 8 eligible
      const sparseCat = await createCategory(tenantA.id, 'SparseCat');
      const sparseSource = await seedProduct({
        tenantId: tenantA.id,
        categoryId: sparseCat.id,
        name: 'Sparse Source',
        basePrice: '10.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: sparseCat.id,
        name: 'Only Neighbor',
        basePrice: '12.00',
      });
      const sparseRes = await request(app)
        .get(`/api/v1/products/${sparseSource.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(sparseRes.status).toBe(200);
      expect(sparseRes.body.data.items).toHaveLength(1);
    });
  });

  // ========================================================================
  // 2. CATEGORY HIERARCHY, SIBLING FALLBACK & ANCESTOR VALIDATION
  // ========================================================================
  describe('Category Hierarchy & Ancestor Validation', () => {
    it('does not fall back to siblings when direct category satisfies requested limit, and never falls back between root categories', async () => {
      const root1 = await createCategory(tenantA.id, 'RootFashion');
      const root2 = await createCategory(tenantA.id, 'RootGrocery');

      const rootSource = await seedProduct({
        tenantId: tenantA.id,
        categoryId: root1.id,
        name: 'Root1 Source',
        basePrice: '20.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: root2.id,
        name: 'Root2 Product',
        basePrice: '20.00',
      });

      const rootRes = await request(app)
        .get(`/api/v1/products/${rootSource.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(rootRes.status).toBe(200);
      expect(rootRes.body.data.items).toEqual([]);

      // Direct satisfies limit=2 -> sibling must NOT be included
      const parent = await createCategory(tenantA.id, 'Apparel');
      const direct = await createCategory(tenantA.id, 'Shirts', {
        parentId: parent.id,
      });
      const sibling = await createCategory(tenantA.id, 'Jackets', {
        parentId: parent.id,
      });
      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: direct.id,
        name: 'Direct Src',
        basePrice: '50.00',
      });
      const d1 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: direct.id,
        name: 'Direct 1',
        basePrice: '55.00',
      });
      const d2 = await seedProduct({
        tenantId: tenantA.id,
        categoryId: direct.id,
        name: 'Direct 2',
        basePrice: '60.00',
      });
      const sib = await seedProduct({
        tenantId: tenantA.id,
        categoryId: sibling.id,
        name: 'Sibling 1',
        basePrice: '50.00',
      });

      const noFallbackRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=2`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(noFallbackRes.status).toBe(200);
      expect(
        noFallbackRes.body.data.items.map((i: { id: string }) => i.id),
      ).toEqual([d1.product.id, d2.product.id]);

      // Request limit=3 -> now sibling fills the 3rd slot
      const withFallbackRes = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations?limit=3`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(withFallbackRes.status).toBe(200);
      expect(
        withFallbackRes.body.data.items.map((i: { id: string }) => i.id),
      ).toEqual([d1.product.id, d2.product.id, sib.product.id]);
    });

    it('rejects inactive source category, inactive candidate sibling, inactive immediate parent, inactive grandparent, cycle, and cross-tenant parent safely', async () => {
      // 1. Inactive source category
      const inactiveCat = await createCategory(tenantA.id, 'InactiveDirect', {
        isActive: false,
      });
      const srcInactiveCat = await seedProduct({
        tenantId: tenantA.id,
        categoryId: inactiveCat.id,
        name: 'Src Inactive Cat',
        basePrice: '20.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: inactiveCat.id,
        name: 'Peer Inactive Cat',
        basePrice: '20.00',
      });
      const res1 = await request(app)
        .get(`/api/v1/products/${srcInactiveCat.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(res1.status).toBe(200);
      expect(res1.body.data).toEqual({ enabled: true, items: [] });

      // 2. Inactive candidate sibling excluded while active sibling included
      const activeParent = await createCategory(tenantA.id, 'ActiveParent');
      const directLeaf = await createCategory(tenantA.id, 'DirectLeaf', {
        parentId: activeParent.id,
      });
      const inactiveSib = await createCategory(tenantA.id, 'InactiveSib', {
        parentId: activeParent.id,
        isActive: false,
      });
      const activeSib = await createCategory(tenantA.id, 'ActiveSib', {
        parentId: activeParent.id,
        isActive: true,
      });
      const srcLeaf = await seedProduct({
        tenantId: tenantA.id,
        categoryId: directLeaf.id,
        name: 'Leaf Src',
        basePrice: '20.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: inactiveSib.id,
        name: 'Inactive Sib Prod',
        basePrice: '20.00',
      });
      const activeSibProd = await seedProduct({
        tenantId: tenantA.id,
        categoryId: activeSib.id,
        name: 'Active Sib Prod',
        basePrice: '25.00',
      });
      const res2 = await request(app)
        .get(`/api/v1/products/${srcLeaf.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(res2.status).toBe(200);
      expect(res2.body.data.items.map((i: { id: string }) => i.id)).toEqual([
        activeSibProd.product.id,
      ]);

      // 3. Inactive immediate parent -> empty recommendations
      const inactiveParent = await createCategory(tenantA.id, 'InactiveParent', {
        isActive: false,
      });
      const childOfInactive = await createCategory(
        tenantA.id,
        'ChildOfInactive',
        { parentId: inactiveParent.id, isActive: true },
      );
      const srcChildOfInactive = await seedProduct({
        tenantId: tenantA.id,
        categoryId: childOfInactive.id,
        name: 'Src Child Of Inactive',
        basePrice: '20.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: childOfInactive.id,
        name: 'Peer Child Of Inactive',
        basePrice: '21.00',
      });
      const res3 = await request(app)
        .get(`/api/v1/products/${srcChildOfInactive.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(res3.status).toBe(200);
      expect(res3.body.data).toEqual({ enabled: true, items: [] });

      // 4. Inactive higher-level ancestor (grandparent inactive)
      const inactiveGrandparent = await createCategory(
        tenantA.id,
        'InactiveGrandparent',
        { isActive: false },
      );
      const midParent = await createCategory(tenantA.id, 'MidParent', {
        parentId: inactiveGrandparent.id,
        isActive: true,
      });
      const grandChild = await createCategory(tenantA.id, 'GrandChild', {
        parentId: midParent.id,
        isActive: true,
      });
      const srcGrandChild = await seedProduct({
        tenantId: tenantA.id,
        categoryId: grandChild.id,
        name: 'Src GrandChild',
        basePrice: '30.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: grandChild.id,
        name: 'Peer GrandChild',
        basePrice: '31.00',
      });
      const res4 = await request(app)
        .get(`/api/v1/products/${srcGrandChild.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(res4.status).toBe(200);
      expect(res4.body.data).toEqual({ enabled: true, items: [] });

      // 5. Category cycle (catA -> catB -> catA)
      const cycA = await createCategory(tenantA.id, 'CycleA');
      const cycB = await createCategory(tenantA.id, 'CycleB', {
        parentId: cycA.id,
      });
      await testPrisma.category.update({
        where: { id: cycA.id },
        data: { parentId: cycB.id },
      });
      const srcCycle = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cycA.id,
        name: 'Src Cycle',
        basePrice: '15.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cycA.id,
        name: 'Peer Cycle',
        basePrice: '16.00',
      });
      const resCycle = await request(app)
        .get(`/api/v1/products/${srcCycle.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(resCycle.status).toBe(200);
      expect(resCycle.body.data).toEqual({ enabled: true, items: [] });
      // Break cycle for clean teardown
      await testPrisma.category.update({
        where: { id: cycA.id },
        data: { parentId: null },
      });

      // 6. Cross-tenant parent pointer (corrupted hierarchy pointing to Tenant B)
      const foreignParent = await createCategory(tenantB.id, 'ForeignParentB');
      const corruptedChild = await createCategory(tenantA.id, 'CorruptedChildA', {
        parentId: foreignParent.id,
      });
      const srcCorrupted = await seedProduct({
        tenantId: tenantA.id,
        categoryId: corruptedChild.id,
        name: 'Src Corrupted',
        basePrice: '15.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: corruptedChild.id,
        name: 'Peer Corrupted',
        basePrice: '16.00',
      });
      const resCrossParent = await request(app)
        .get(`/api/v1/products/${srcCorrupted.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(resCrossParent.status).toBe(200);
      expect(resCrossParent.body.data).toEqual({ enabled: true, items: [] });
      await testPrisma.category.update({
        where: { id: corruptedChild.id },
        data: { parentId: null },
      });
    });
  });

  // ========================================================================
  // 3. INVENTORY, VARIANTS & QUICK ADD ELIGIBILITY
  // ========================================================================
  describe('Inventory, Variants & Quick Add Safety', () => {
    it('enforces purchasability rules, Quick Add Option B metadata, and never mutates inventory', async () => {
      const cat = await createCategory(tenantA.id, 'InventoryCat');
      const source = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Inv Source',
        basePrice: '40.00',
      });

      // 1. Simple product: 1 active default variant with net stock 3 (qty 5, reserved 2)
      const simpleEligible = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Simple Eligible',
        basePrice: '41.00',
        imageUrl: 'https://cdn.example.test/simple.webp',
        variants: [
          {
            isDefault: true,
            isActive: true,
            stocks: [
              {
                warehouseId: activeWarehouseAId,
                quantity: 5,
                reservedQuantity: 2,
              },
            ],
          },
        ],
      });

      // 2. Selectable variants product (isDefault=false) -> eligible, hasVariants=true, defaultVariantId=null, canQuickAdd=false
      const multiVariant = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Selectable Variants',
        basePrice: '42.00',
        variants: [
          {
            isDefault: false,
            isActive: true,
            stocks: [{ warehouseId: activeWarehouseAId, quantity: 4 }],
          },
          {
            isDefault: false,
            isActive: true,
            stocks: [{ warehouseId: activeWarehouseAId, quantity: 0 }],
          },
        ],
      });

      // 3. Product with mandatory attribute + default variant -> eligible, canQuickAdd=false!
      const withAttributes = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'With Attributes',
        basePrice: '43.00',
        attributeNames: ['Size'],
        variants: [
          {
            isDefault: true,
            isActive: true,
            stocks: [{ warehouseId: activeWarehouseAId, quantity: 4 }],
          },
        ],
      });

      // 4. Ambiguous two active default variants -> eligible, canQuickAdd=false!
      const ambiguousDefaults = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Ambiguous Defaults',
        basePrice: '44.00',
        variants: [
          {
            isDefault: true,
            isActive: true,
            stocks: [{ warehouseId: activeWarehouseAId, quantity: 3 }],
          },
          {
            isDefault: true,
            isActive: true,
            stocks: [{ warehouseId: activeWarehouseAId, quantity: 3 }],
          },
        ],
      });

      // --- MUST BE EXCLUDED ---
      // 5. No variants at all
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'No Variants',
        basePrice: '40.00',
        variants: [],
      });
      // 6. Only inactive default variant
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Inactive Variant Only',
        basePrice: '40.00',
        variants: [
          {
            isDefault: true,
            isActive: false,
            stocks: [{ warehouseId: activeWarehouseAId, quantity: 10 }],
          },
        ],
      });
      // 7. Zero stock
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Zero Stock',
        basePrice: '40.00',
        variants: [
          {
            isDefault: true,
            isActive: true,
            stocks: [{ warehouseId: activeWarehouseAId, quantity: 0 }],
          },
        ],
      });
      // 8. Fully reserved stock (quantity=5, reserved=5)
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Fully Reserved',
        basePrice: '40.00',
        variants: [
          {
            isDefault: true,
            isActive: true,
            stocks: [
              {
                warehouseId: activeWarehouseAId,
                quantity: 5,
                reservedQuantity: 5,
              },
            ],
          },
        ],
      });
      // 9. Stock only in inactive warehouse
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Inactive Warehouse Stock',
        basePrice: '40.00',
        variants: [
          {
            isDefault: true,
            isActive: true,
            stocks: [{ warehouseId: inactiveWarehouseAId, quantity: 20 }],
          },
        ],
      });
      // 9b. Cross-tenant inventory/warehouse isolation:
      // Database constraints enforce tenant alignment on Inventory/Warehouse,
      // and a stocked Tenant B product in an active Tenant B warehouse is never returned for Tenant A.
      const crossTenantStockProd = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'No Local Stock Cross Tenant Attempt',
        basePrice: '40.00',
        variants: [{ isDefault: true, isActive: true, stocks: [] }],
      });
      await expect(
        testPrisma.inventory.create({
          data: {
            tenantId: tenantB.id,
            warehouseId: activeWarehouseBId,
            variantId: crossTenantStockProd.variants[0]!.id,
            quantity: 50,
            reservedQuantity: 0,
          },
        }),
      ).rejects.toThrow();

      const catBSameName = await createCategory(tenantB.id, 'InventoryCat');
      await seedProduct({
        tenantId: tenantB.id,
        categoryId: catBSameName.id,
        name: 'Tenant B Stocked Product',
        basePrice: '40.00',
        variants: [
          {
            isDefault: true,
            isActive: true,
            stocks: [{ warehouseId: activeWarehouseBId, quantity: 50 }],
          },
        ],
      });
      // 10. No inventory record
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'No Inventory',
        basePrice: '40.00',
        variants: [{ isDefault: true, isActive: true, stocks: [] }],
      });
      // 11. Non-ACTIVE product statuses
      for (const status of [
        ProductStatus.DRAFT,
        ProductStatus.INACTIVE,
        ProductStatus.ARCHIVED,
      ]) {
        await seedProduct({
          tenantId: tenantA.id,
          categoryId: cat.id,
          name: `Status ${status}`,
          basePrice: '40.00',
          status,
        });
      }

      const inventoryBefore = await testPrisma.inventory.findMany({
        where: { variantId: simpleEligible.variants[0]!.id },
        select: { quantity: true, reservedQuantity: true },
      });

      const res = await request(app)
        .get(`/api/v1/products/${source.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);

      expect(res.status).toBe(200);
      const items: Array<{
        id: string;
        hasVariants: boolean;
        defaultVariantId: string | null;
        canQuickAdd: boolean;
        image: string | null;
      }> = res.body.data.items;

      expect(items.map((i) => i.id)).toEqual([
        simpleEligible.product.id,
        multiVariant.product.id,
        withAttributes.product.id,
        ambiguousDefaults.product.id,
      ]);

      // Simple eligible: canQuickAdd = true
      expect(items[0]).toMatchObject({
        id: simpleEligible.product.id,
        hasVariants: false,
        defaultVariantId: simpleEligible.variants[0]!.id,
        canQuickAdd: true,
        image: 'https://cdn.example.test/simple.webp',
      });

      // Multi-variant: hasVariants = true, defaultVariantId = null, canQuickAdd = false
      expect(items[1]).toMatchObject({
        id: multiVariant.product.id,
        hasVariants: true,
        defaultVariantId: null,
        canQuickAdd: false,
      });

      // With attributes: canQuickAdd = false while preserving existing hasVariants/defaultVariantId semantics
      expect(items[2]).toMatchObject({
        id: withAttributes.product.id,
        hasVariants: false,
        defaultVariantId: withAttributes.variants[0]!.id,
        canQuickAdd: false,
      });

      // Ambiguous default variants: canQuickAdd = false
      expect(items[3]).toMatchObject({
        id: ambiguousDefaults.product.id,
        canQuickAdd: false,
      });

      // Public DTO safety: zero private keys
      expect(findForbiddenKeys(res.body)).toEqual([]);

      // Zero inventory mutation
      const inventoryAfter = await testPrisma.inventory.findMany({
        where: { variantId: simpleEligible.variants[0]!.id },
        select: { quantity: true, reservedQuantity: true },
      });
      expect(inventoryAfter).toEqual(inventoryBefore);
    });
  });

  // ========================================================================
  // 4. STORE SETTING PERSISTENCE, VALIDATION & EXPOSURE
  // ========================================================================
  describe('Store Setting (show_similar_products) Validation & Exposure', () => {
    it('defaults to enabled when absent, disables on explicit false (skipping candidate/enrichment queries), re-enables on true, and reflects consistently across /app-settings and /storefront', async () => {
      const cat = await createCategory(tenantA.id, 'ToggleCat');
      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Toggle Src',
        basePrice: '10.00',
      });
      const peer = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Toggle Peer',
        basePrice: '12.00',
      });

      // Missing setting -> enabled everywhere
      const [appSettingsDefault, storefrontDefault, recDefault] =
        await Promise.all([
          request(app)
            .get('/api/v1/app-settings')
            .set('X-Tenant-Slug', tenantA.slug),
          request(app)
            .get('/api/v1/storefront')
            .set('X-Tenant-Slug', tenantA.slug),
          request(app)
            .get(`/api/v1/products/${src.product.id}/recommendations`)
            .set('X-Tenant-Slug', tenantA.slug),
        ]);
      expect(appSettingsDefault.status).toBe(200);
      expect(appSettingsDefault.body.data.showSimilarProducts).toBe(true);
      expect(storefrontDefault.status).toBe(200);
      expect(storefrontDefault.body.data.settings.showSimilarProducts).toBe(true);
      expect(recDefault.status).toBe(200);
      expect(recDefault.body.data.enabled).toBe(true);
      expect(recDefault.body.data.items.map((i: { id: string }) => i.id)).toEqual([
        peer.product.id,
      ]);

      // Create explicit false via authorized OWNER
      const createFalse = await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          key: 'show_similar_products',
          value: false,
          isPublic: true,
        });
      expect(createFalse.status).toBe(201);
      expect(createFalse.body.data.value).toBe(false);

      // Verify disabled response skips candidate/enrichment queries
      const measuredDisabled = await countSqlQueries(() =>
        request(app)
          .get(`/api/v1/products/${src.product.id}/recommendations`)
          .set('X-Tenant-Slug', tenantA.slug),
      );
      expect(measuredDisabled.result.status).toBe(200);
      expect(measuredDisabled.result.body.data).toEqual({
        enabled: false,
        items: [],
      });
      expect(
        measuredDisabled.queries.some(
          (q) =>
            q.includes('WITH RECURSIVE') ||
            q.includes('"Inventory"') ||
            q.includes('"ProductReview"') ||
            q.includes('"Wishlist'),
        ),
      ).toBe(false);

      const [appSettingsOff, storefrontOff] = await Promise.all([
        request(app)
          .get('/api/v1/app-settings')
          .set('X-Tenant-Slug', tenantA.slug),
        request(app)
          .get('/api/v1/storefront')
          .set('X-Tenant-Slug', tenantA.slug),
      ]);
      expect(appSettingsOff.body.data.showSimilarProducts).toBe(false);
      expect(storefrontOff.body.data.settings.showSimilarProducts).toBe(false);

      // Cross-tenant setting isolation: Tenant B remains enabled!
      const storefrontB = await request(app)
        .get('/api/v1/storefront')
        .set('X-Tenant-Slug', tenantB.slug);
      expect(storefrontB.status).toBe(200);
      expect(storefrontB.body.data.settings.showSimilarProducts).toBe(true);

      // Re-enable via PATCH
      const patchTrue = await request(app)
        .patch('/api/v1/app-settings/show_similar_products')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ value: true });
      expect(patchTrue.status).toBe(200);
      expect(patchTrue.body.data.value).toBe(true);

      const recOn = await request(app)
        .get(`/api/v1/products/${src.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(recOn.status).toBe(200);
      expect(recOn.body.data.enabled).toBe(true);
      expect(recOn.body.data.items).toHaveLength(1);
    });

    it('rejects non-boolean and non-public writes on POST and PATCH, enforces RBAC, preserves unrelated settings, and handles malformed/non-public legacy rows consistently', async () => {
      // Non-boolean POST rejected
      for (const badValue of ['false', 'true', 1, 0, null, { enabled: true }]) {
        const res = await request(app)
          .post('/api/v1/app-settings')
          .set('X-Tenant-Slug', tenantA.slug)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({
            key: 'show_similar_products',
            value: badValue,
            isPublic: true,
          });
        expect(res.status).toBe(400);
      }

      // Non-public POST rejected
      const nonPublicPost = await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          key: 'show_similar_products',
          value: false,
          isPublic: false,
        });
      expect(nonPublicPost.status).toBe(400);

      // Unauthorized writes rejected (guest, customer, cross-tenant owner)
      const guestWrite = await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .send({ key: 'show_similar_products', value: false, isPublic: true });
      expect(guestWrite.status).toBe(401);

      const customerWrite = await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ key: 'show_similar_products', value: false, isPublic: true });
      expect(customerWrite.status).toBe(403);

      const crossTenantOwnerWrite = await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ key: 'show_similar_products', value: false, isPublic: true });
      expect(crossTenantOwnerWrite.status).toBe(401);
      expect(crossTenantOwnerWrite.body.code).toBe('UNAUTHORIZED');

      // Create valid setting, then verify PATCH rejects non-boolean & isPublic=false
      const okCreate = await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ key: 'show_similar_products', value: true, isPublic: true });
      expect(okCreate.status).toBe(201);

      const badPatchValue = await request(app)
        .patch('/api/v1/app-settings/show_similar_products')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ value: 'false' });
      expect(badPatchValue.status).toBe(400);

      const badPatchVisibility = await request(app)
        .patch('/api/v1/app-settings/show_similar_products')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ isPublic: false });
      expect(badPatchVisibility.status).toBe(400);

      // Unrelated setting still accepts strings and isPublic=false cleanly
      const unrelatedKey = `custom_note_${runId.replace(/[^a-z0-9]/gi, '')}`;
      const unrelatedCreate = await request(app)
        .post('/api/v1/app-settings')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ key: unrelatedKey, value: 'string-allowed', isPublic: false });
      expect(unrelatedCreate.status).toBe(201);

      // Simulate legacy malformed / non-public row directly in DB -> fails closed consistently across all 3 endpoints!
      const cat = await createCategory(tenantA.id, 'LegacyRowCat');
      const src = await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Legacy Src',
        basePrice: '15.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: cat.id,
        name: 'Legacy Peer',
        basePrice: '16.00',
      });

      for (const legacyCase of [
        { value: 'false', isPublic: true },
        { value: false, isPublic: false },
        { value: true, isPublic: false },
      ]) {
        await testPrisma.appSetting.update({
          where: {
            tenantId_key: { tenantId: tenantA.id, key: 'show_similar_products' },
          },
          data: legacyCase,
        });

        // PATCHing only description must not leave invalid state accepted
        const descOnlyPatch = await request(app)
          .patch('/api/v1/app-settings/show_similar_products')
          .set('X-Tenant-Slug', tenantA.slug)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ description: 'touching description only' });
        expect(descOnlyPatch.status).toBe(400);

        const [pubRes, sfRes, recRes] = await Promise.all([
          request(app)
            .get('/api/v1/app-settings')
            .set('X-Tenant-Slug', tenantA.slug),
          request(app)
            .get('/api/v1/storefront')
            .set('X-Tenant-Slug', tenantA.slug),
          request(app)
            .get(`/api/v1/products/${src.product.id}/recommendations`)
            .set('X-Tenant-Slug', tenantA.slug),
        ]);
        expect(pubRes.body.data.showSimilarProducts).toBe(false);
        expect(sfRes.body.data.settings.showSimilarProducts).toBe(false);
        expect(recRes.body.data).toEqual({ enabled: false, items: [] });
      }
    });
  });

  // ========================================================================
  // 5. AUTH, WISHLIST ISOLATION & TENANT SECURITY
  // ========================================================================
  describe('API Security, Guest/Auth Wishlist Isolation & Tenant Isolation', () => {
    it('isolates wishlist per user, returns 404 for cross-tenant/non-active/missing source products even when disabled, and rejects invalid UUIDs', async () => {
      const catA = await createCategory(tenantA.id, 'SecCatA');
      const catB = await createCategory(tenantB.id, 'SecCatB');

      const srcA = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catA.id,
        name: 'Sec Src A',
        basePrice: '20.00',
      });
      const peerA = await seedProduct({
        tenantId: tenantA.id,
        categoryId: catA.id,
        name: 'Sec Peer A',
        basePrice: '21.00',
      });
      const prodB = await seedProduct({
        tenantId: tenantB.id,
        categoryId: catB.id,
        name: 'Sec Prod B',
        basePrice: '21.00',
      });

      // Add peerA to customerA1 wishlist ONLY
      const wl1 = await testPrisma.wishlist.create({
        data: { tenantId: tenantA.id, userId: customerA1Id },
      });
      await testPrisma.wishlistItem.create({
        data: { wishlistId: wl1.id, productId: peerA.product.id },
      });

      // Guest -> isInWishlist: false
      const guestRes = await request(app)
        .get(`/api/v1/products/${srcA.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(guestRes.status).toBe(200);
      expect(guestRes.body.data.items).toHaveLength(1);
      expect(guestRes.body.data.items[0].id).toBe(peerA.product.id);
      expect(guestRes.body.data.items[0].isInWishlist).toBe(false);

      // customerA1 -> isInWishlist: true
      const auth1Res = await request(app)
        .get(`/api/v1/products/${srcA.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(auth1Res.status).toBe(200);
      expect(auth1Res.body.data.items[0].isInWishlist).toBe(true);

      // customerA2 -> isInWishlist: false (no cross-user wishlist leakage!)
      const auth2Res = await request(app)
        .get(`/api/v1/products/${srcA.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${customerA2Token}`);
      expect(auth2Res.status).toBe(200);
      expect(auth2Res.body.data.items[0].isInWishlist).toBe(false);

      // Invalid UUID -> 400
      const invalidIdRes = await request(app)
        .get('/api/v1/products/not-a-uuid/recommendations')
        .set('X-Tenant-Slug', tenantA.slug);
      expect(invalidIdRes.status).toBe(400);

      // Nonexistent UUID -> 404 PRODUCT_NOT_FOUND
      const missingRes = await request(app)
        .get(`/api/v1/products/${randomUUID()}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.code).toBe('PRODUCT_NOT_FOUND');

      // Cross-tenant product ID -> 404 PRODUCT_NOT_FOUND
      const crossRes = await request(app)
        .get(`/api/v1/products/${prodB.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(crossRes.status).toBe(404);
      expect(crossRes.body.code).toBe('PRODUCT_NOT_FOUND');

      // DRAFT / INACTIVE / ARCHIVED source product -> 404 PRODUCT_NOT_FOUND
      for (const status of [
        ProductStatus.DRAFT,
        ProductStatus.INACTIVE,
        ProductStatus.ARCHIVED,
      ]) {
        const nonActiveSrc = await seedProduct({
          tenantId: tenantA.id,
          categoryId: catA.id,
          name: `Src ${status}`,
          basePrice: '20.00',
          status,
        });
        const nonActiveRes = await request(app)
          .get(`/api/v1/products/${nonActiveSrc.product.id}/recommendations`)
          .set('X-Tenant-Slug', tenantA.slug);
        expect(nonActiveRes.status).toBe(404);
        expect(nonActiveRes.body.code).toBe('PRODUCT_NOT_FOUND');
      }

      // Cross-tenant source validation MUST STILL return 404 when Tenant A disables feature!
      await testPrisma.appSetting.create({
        data: {
          tenantId: tenantA.id,
          key: 'show_similar_products',
          value: false,
          isPublic: true,
        },
      });
      const disabledCrossRes = await request(app)
        .get(`/api/v1/products/${prodB.product.id}/recommendations`)
        .set('X-Tenant-Slug', tenantA.slug);
      expect(disabledCrossRes.status).toBe(404);
      expect(disabledCrossRes.body.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  // ========================================================================
  // 6. QUERY COUNT & PERFORMANCE VERIFICATION
  // ========================================================================
  describe('Query Count & Bounded Performance Verification', () => {
    it('maintains constant bounded SQL query counts across empty, direct (2 vs 8), sibling fallback, authenticated, disabled, and large synthetic category (60 items)', async () => {
      const parent = await createCategory(tenantA.id, 'PerfParent');
      const emptyCat = await createCategory(tenantA.id, 'PerfEmpty');
      const smallCat = await createCategory(tenantA.id, 'PerfSmall', {
        parentId: parent.id,
      });
      const siblingCat = await createCategory(tenantA.id, 'PerfSibling', {
        parentId: parent.id,
      });
      const largeCat = await createCategory(tenantA.id, 'PerfLarge');

      const emptySrc = await seedProduct({
        tenantId: tenantA.id,
        categoryId: emptyCat.id,
        name: 'Perf Empty Src',
        basePrice: '50.00',
      });

      const smallSrc = await seedProduct({
        tenantId: tenantA.id,
        categoryId: smallCat.id,
        name: 'Perf Small Src',
        basePrice: '50.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: smallCat.id,
        name: 'Perf Small Peer 1',
        basePrice: '51.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: smallCat.id,
        name: 'Perf Small Peer 2',
        basePrice: '52.00',
      });
      await seedProduct({
        tenantId: tenantA.id,
        categoryId: siblingCat.id,
        name: 'Perf Sibling Peer 1',
        basePrice: '53.00',
      });

      const largeSrc = await seedProduct({
        tenantId: tenantA.id,
        categoryId: largeCat.id,
        name: 'Perf Large Src',
        basePrice: '100.00',
      });
      for (let i = 0; i < 60; i++) {
        await seedProduct({
          tenantId: tenantA.id,
          categoryId: largeCat.id,
          name: `Perf Large Item ${i}`,
          basePrice: `${70 + i}.00`,
        });
      }

      const emptyMetrics = await countSqlQueries(() =>
        request(app)
          .get(`/api/v1/products/${emptySrc.product.id}/recommendations`)
          .set('X-Tenant-Slug', tenantA.slug),
      );
      expect(emptyMetrics.result.status).toBe(200);
      expect(emptyMetrics.result.body.data.items).toHaveLength(0);

      const direct2Metrics = await countSqlQueries(() =>
        request(app)
          .get(`/api/v1/products/${largeSrc.product.id}/recommendations?limit=2`)
          .set('X-Tenant-Slug', tenantA.slug),
      );
      expect(direct2Metrics.result.status).toBe(200);
      expect(direct2Metrics.result.body.data.items).toHaveLength(2);

      const direct8Metrics = await countSqlQueries(() =>
        request(app)
          .get(`/api/v1/products/${largeSrc.product.id}/recommendations?limit=8`)
          .set('X-Tenant-Slug', tenantA.slug),
      );
      expect(direct8Metrics.result.status).toBe(200);
      expect(direct8Metrics.result.body.data.items).toHaveLength(8);

      // Query count MUST NOT grow with number of recommended items (2 vs 8)!
      expect(direct8Metrics.count).toBe(direct2Metrics.count);

      const siblingMetrics = await countSqlQueries(() =>
        request(app)
          .get(`/api/v1/products/${smallSrc.product.id}/recommendations?limit=8`)
          .set('X-Tenant-Slug', tenantA.slug),
      );
      expect(siblingMetrics.result.status).toBe(200);
      expect(siblingMetrics.result.body.data.items).toHaveLength(3);

      const authMetrics = await countSqlQueries(() =>
        request(app)
          .get(`/api/v1/products/${largeSrc.product.id}/recommendations?limit=8`)
          .set('X-Tenant-Slug', tenantA.slug)
          .set('Authorization', `Bearer ${customerA1Token}`),
      );
      expect(authMetrics.result.status).toBe(200);
      expect(authMetrics.result.body.data.items).toHaveLength(8);

      await testPrisma.appSetting.create({
        data: {
          tenantId: tenantA.id,
          key: 'show_similar_products',
          value: false,
          isPublic: true,
        },
      });
      const disabledMetrics = await countSqlQueries(() =>
        request(app)
          .get(`/api/v1/products/${largeSrc.product.id}/recommendations?limit=8`)
          .set('X-Tenant-Slug', tenantA.slug),
      );
      expect(disabledMetrics.result.status).toBe(200);
      expect(disabledMetrics.result.body.data).toEqual({
        enabled: false,
        items: [],
      });
      expect(disabledMetrics.count).toBeLessThan(emptyMetrics.count);

      // Capture EXPLAIN plan on the 60-item synthetic category candidate query
      const explainRows = await testPrisma.$queryRawUnsafe<
        Array<{ 'QUERY PLAN': string }>
      >(
        `EXPLAIN (FORMAT TEXT)
         SELECT p."id"
         FROM "Product" p
         INNER JOIN "Category" c
           ON c."id" = p."categoryId"
          AND c."tenantId" = $1
          AND c."isActive" = true
         WHERE p."tenantId" = $1
           AND p."id" <> $2
           AND p."status" = 'ACTIVE'
           AND p."categoryId" IN ($3)
           AND EXISTS (
             SELECT 1
             FROM "ProductVariant" pv
             INNER JOIN "Inventory" inv
               ON inv."variantId" = pv."id"
              AND inv."tenantId" = $1
             INNER JOIN "Warehouse" w
               ON w."id" = inv."warehouseId"
              AND w."tenantId" = $1
              AND w."isActive" = true
             WHERE pv."productId" = p."id"
               AND pv."isActive" = true
               AND (inv."quantity" - inv."reservedQuantity") > 0
           )
         ORDER BY ABS(p."basePrice" - $4::numeric) ASC, p."createdAt" DESC, p."id" ASC
         LIMIT 32`,
        tenantA.id,
        largeSrc.product.id,
        largeCat.id,
        '100.00',
      );
      expect(explainRows.length).toBeGreaterThan(0);

      // Emit exact measured counts and EXPLAIN summary for verification evidence
      console.info(
        'PR1A_QUERY_COUNTS',
        JSON.stringify({
          disabled: disabledMetrics.count,
          empty: emptyMetrics.count,
          directLimit2: direct2Metrics.count,
          directLimit8Large60: direct8Metrics.count,
          siblingFallback: siblingMetrics.count,
          authenticatedLimit8: authMetrics.count,
        }),
      );
      console.info(
        'PR1A_EXPLAIN_PLAN',
        explainRows.map((row) => row['QUERY PLAN']).join(' | '),
      );
    });
  });
});
