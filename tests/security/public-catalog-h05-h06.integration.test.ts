import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ipKeyGenerator } from 'express-rate-limit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { env } from '../../src/config/env.js';
import {
  globalRateLimiter,
  sensitiveRateLimiter,
} from '../../src/config/rate-limit.js';
import { testPrisma } from '../../src/config/test-database.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
} from '../../src/generated/prisma/client.js';
import { catalogTenantFixture } from '../helpers/catalog.js';
import {
  createInventoryFixture,
  createShippingProfileFixture,
  fixtureWarehouse,
} from '../helpers/warehouse.js';

// Minimal valid 1x1 PNG buffer
const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

const SENSITIVE_KEY_NAMES = new Set(['storagekey', 'imagestoragekey']);

function findSensitiveKeys(value: unknown, currentPath = '$'): string[] {
  if (value === null || value === undefined || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findSensitiveKeys(entry, `${currentPath}[${index}]`),
    );
  }
  const findings: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${currentPath}.${key}`;
    if (SENSITIVE_KEY_NAMES.has(key.toLowerCase())) {
      findings.push(nextPath);
    }
    findings.push(...findSensitiveKeys(nested, nextPath));
  }
  return findings;
}

describe('Phase 2D.9 Step 3B — H-05 & H-06 Public Catalog Security Hardening', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const countryCode = `H${tenantA.id.slice(-7)}`.toUpperCase();
  const originalUploadDir = env.UPLOAD_DIR;
  let tempUploadDir = '';

  const createdUserIds: string[] = [];
  let ownerAToken: string;
  let adminAToken: string;
  let managerAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let ownerBToken: string;

  let categoryAId: string;
  let brandAId: string;
  let collectionAId: string;
  let addressAId: string;
  let shippingMethodCode: string;

  // Variable ACTIVE product with 1 active variant + 1 inactive variant
  let varProductId: string;
  let varProductImageId: string;
  let varProductImageUrl: string;
  let activeVariantId: string;
  let activeVariantSku: string;
  let activeVariantImageUrl: string;
  let inactiveVariantId: string;
  let inactiveVariantSku: string;
  let inactiveVariantImageUrl: string;
  let colorAttrId: string;
  let crimsonValId: string;
  let crimsonSwatchUrl: string;
  let obsidianValId: string;
  let editionAttrId: string;
  let vaultValId: string;

  // ACTIVE product whose sole default variant is deactivated (zero active variants)
  let zeroActiveProductId: string;
  let zeroActiveSoleVariantId: string;

  // Non-ACTIVE products with uploaded images
  let draftProductId: string;
  let draftImageId: string;
  let inactiveProductId: string;
  let archivedProductId: string;

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
        email: `h05h06-${label}-${runId}@example.test`,
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

  beforeEach(() => {
    globalRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    globalRateLimiter.resetKey(ipKeyGenerator('127.0.0.1'));
    sensitiveRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    sensitiveRateLimiter.resetKey(ipKeyGenerator('127.0.0.1'));
  });

  beforeAll(async () => {
    tempUploadDir = mkdtempSync(path.join(tmpdir(), 'commerce-h05-h06-test-'));
    (env as { UPLOAD_DIR: string }).UPLOAD_DIR = tempUploadDir;

    await testPrisma.$connect();
    await tenantA.create();
    await tenantB.create();

    await testPrisma.country.upsert({
      where: { code: countryCode },
      update: { isActive: true },
      create: {
        code: countryCode,
        name: `Catalog Country ${runId}`,
        currencyCode: 'USD',
        isActive: true,
      },
    });

    await fixtureWarehouse(tenantA.id);

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
      data: {
        tenantId: tenantA.id,
        countryCode,
        currency: 'USD',
      },
    });
    const shippingZone = await testPrisma.shippingZone.create({
      data: {
        profileId: shippingProfile.id,
        code: `h05-zone-${runId}`,
        name: 'Default Zone',
        countryCode,
      },
    });
    shippingMethodCode = `std_${runId.slice(0, 6).toLowerCase()}`;
    const shippingMethod = await testPrisma.shippingMethod.create({
      data: {
        zoneId: shippingZone.id,
        code: shippingMethodCode,
        name: 'Standard Delivery',
      },
    });
    await testPrisma.shippingRule.create({
      data: {
        methodId: shippingMethod.id,
        flatRate: 10,
      },
    });

    const [ownerA, adminA, managerA, customerA, ownerB] = await Promise.all([
      createUser('owner-a', tenantA.id, 'OWNER'),
      createUser('admin-a', tenantA.id, 'ADMIN'),
      createUser('manager-a', tenantA.id, 'MANAGER'),
      createUser('customer-a', tenantA.id, 'CUSTOMER'),
      createUser('owner-b', tenantB.id, 'OWNER'),
    ]);
    ownerAToken = ownerA.token;
    adminAToken = adminA.token;
    managerAToken = managerA.token;
    customerAId = customerA.id;
    customerAToken = customerA.token;
    ownerBToken = ownerB.token;

    const address = await testPrisma.address.create({
      data: {
        userId: customerAId,
        label: 'Home',
        firstName: 'Customer',
        lastName: 'Tester',
        phone: '+201000000001',
        countryCode,
        city: 'Cairo',
        addressLine1: '10 Catalog St',
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
    addressAId = address.id;

    // Create category & brand with uploaded images so public endpoints carry real image URLs
    const catRes = await asOwnerA(
      request(app).post('/api/v1/categories').send({
        name: `H05 Category ${runId}`,
        slug: `h05-cat-${runId}`,
      }),
    ).expect(201);
    categoryAId = catRes.body.data.id as string;

    await asOwnerA(
      request(app)
        .post(`/api/v1/categories/${categoryAId}/image`)
        .attach('image', VALID_PNG, { filename: 'cat.png', contentType: 'image/png' }),
    ).expect(200);

    const brandRes = await asOwnerA(
      request(app).post('/api/v1/brands').send({
        name: `H05 Brand ${runId}`,
        slug: `h05-brand-${runId}`,
      }),
    ).expect(201);
    brandAId = brandRes.body.data.id as string;

    await asOwnerA(
      request(app)
        .post(`/api/v1/brands/${brandAId}/image`)
        .attach('image', VALID_PNG, { filename: 'brand.png', contentType: 'image/png' }),
    ).expect(200);

    // ------------------------------------------------------------------
    // 1. Variable ACTIVE product with 1 active variant + 1 inactive variant
    // ------------------------------------------------------------------
    const varProdRes = await asOwnerA(
      request(app).post('/api/v1/products').send({
        name: `Tailored Coat ${runId}`,
        slug: `tailored-coat-${runId}`,
        description: 'Security test product with mixed active/inactive variants',
        categoryId: categoryAId,
        brandId: brandAId,
        basePrice: '100.00',
        discount: {
          type: 'PERCENTAGE',
          value: '10',
        },
      }),
    ).expect(201);
    varProductId = varProdRes.body.data.id as string;

    const pImgRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-images/upload')
        .field('productId', varProductId)
        .field('altText', 'Coat main')
        .field('isPrimary', 'true')
        .attach('image', VALID_PNG, { filename: 'coat.png', contentType: 'image/png' }),
    ).expect(201);
    varProductImageId = pImgRes.body.data.id as string;
    varProductImageUrl = pImgRes.body.data.url as string;

    // Attribute 1: Color (Crimson -> active variant, Obsidian -> inactive variant only)
    const colorAttrRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId: varProductId, name: 'Color', sortOrder: 0 }),
    ).expect(201);
    colorAttrId = colorAttrRes.body.data.id as string;

    const crimsonRes = await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/${colorAttrId}/values`)
        .send({ value: 'Crimson', sortOrder: 0 }),
    ).expect(201);
    crimsonValId = crimsonRes.body.data.id as string;

    const crimsonSwatchRes = await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/values/${crimsonValId}/image`)
        .attach('image', VALID_PNG, { filename: 'crimson.png', contentType: 'image/png' }),
    ).expect(200);
    crimsonSwatchUrl = crimsonSwatchRes.body.data.image.url as string;

    const obsidianRes = await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/${colorAttrId}/values`)
        .send({ value: 'Obsidian', sortOrder: 1 }),
    ).expect(201);
    obsidianValId = obsidianRes.body.data.id as string;

    await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/values/${obsidianValId}/image`)
        .attach('image', VALID_PNG, { filename: 'obsidian.png', contentType: 'image/png' }),
    ).expect(200);

    // Attribute 2: Edition (Vault -> inactive variant only; entire attribute must be pruned publicly)
    const editionAttrRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId: varProductId, name: 'Edition', sortOrder: 1 }),
    ).expect(201);
    editionAttrId = editionAttrRes.body.data.id as string;

    const vaultRes = await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/${editionAttrId}/values`)
        .send({ value: 'Vault', sortOrder: 0 }),
    ).expect(201);
    vaultValId = vaultRes.body.data.id as string;

    await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/values/${vaultValId}/image`)
        .attach('image', VALID_PNG, { filename: 'vault.png', contentType: 'image/png' }),
    ).expect(200);

    // Active variant (Crimson)
    activeVariantSku = `COAT-CRIMSON-${runId}`;
    const activeVarRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: varProductId,
          sku: activeVariantSku,
          price: '120.00',
          isActive: true,
          attributeValueIds: [crimsonValId],
        }),
    ).expect(201);
    activeVariantId = activeVarRes.body.data.id as string;

    const activeVarImgRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-variant-images/upload')
        .field('variantId', activeVariantId)
        .field('altText', 'Crimson view')
        .attach('image', VALID_PNG, { filename: 'v-crimson.png', contentType: 'image/png' }),
    ).expect(201);
    activeVariantImageUrl = activeVarImgRes.body.data.url as string;

    await createInventoryFixture({
      data: { variantId: activeVariantId, quantity: 10, reservedQuantity: 0 },
    });

    // Inactive variant (Obsidian + Vault) with tempting low price
    inactiveVariantSku = `COAT-OBSIDIAN-${runId}`;
    const inactiveVarRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: varProductId,
          sku: inactiveVariantSku,
          price: '45.00',
          isActive: false,
          attributeValueIds: [obsidianValId, vaultValId],
        }),
    ).expect(201);
    inactiveVariantId = inactiveVarRes.body.data.id as string;

    const inactiveVarImgRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-variant-images/upload')
        .field('variantId', inactiveVariantId)
        .field('altText', 'Hidden obsidian view')
        .attach('image', VALID_PNG, { filename: 'v-obsidian.png', contentType: 'image/png' }),
    ).expect(201);
    inactiveVariantImageUrl = inactiveVarImgRes.body.data.url as string;

    await createInventoryFixture({
      data: { variantId: inactiveVariantId, quantity: 7, reservedQuantity: 0 },
    });

    await asOwnerA(
      request(app)
        .patch(`/api/v1/products/${varProductId}/status`)
        .send({ status: ProductStatus.ACTIVE }),
    ).expect(200);

    // Seed a DELIVERED order so varProduct appears in /api/v1/products/best-sellers
    await testPrisma.order.create({
      data: {
        tenantId: tenantA.id,
        userId: customerAId,
        orderNumber: `ORD-H05-${runId}`,
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
        currency: 'USD',
        subtotal: '240.00',
        discountAmount: '0.00',
        shippingAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '240.00',
        shippingAddress: {
          firstName: 'Customer',
          lastName: 'Tester',
          countryCode,
          city: 'Cairo',
          addressLine1: '10 Catalog St',
        },
        billingAddress: {
          firstName: 'Customer',
          lastName: 'Tester',
          countryCode,
          city: 'Cairo',
          addressLine1: '10 Catalog St',
        },
        items: {
          create: {
            productId: varProductId,
            variantId: activeVariantId,
            productName: `Tailored Coat ${runId}`,
            sku: activeVariantSku,
            unitPrice: '120.00',
            itemDiscountAmount: '0.00',
            finalUnitPrice: '120.00',
            quantity: 2,
            totalPrice: '240.00',
            taxableAmount: '240.00',
            taxAmount: '0.00',
            variantSnapshot: { Color: 'Crimson' },
          },
        },
      },
    });

    // Collection containing varProduct for /collections/:id/products and /home
    const collection = await testPrisma.productCollection.create({
      data: {
        tenantId: tenantA.id,
        name: `Featured ${runId}`,
        slug: `featured-${runId}`,
        isActive: true,
        products: {
          create: {
            productId: varProductId,
            sortOrder: 0,
          },
        },
      },
    });
    collectionAId = collection.id;

    // ------------------------------------------------------------------
    // 2. ACTIVE product with sole default variant subsequently deactivated
    // ------------------------------------------------------------------
    const zeroProdRes = await asOwnerA(
      request(app).post('/api/v1/products').send({
        name: `Sold Out Lamp ${runId}`,
        slug: `sold-out-lamp-${runId}`,
        categoryId: categoryAId,
        brandId: brandAId,
        basePrice: '85.00',
        discount: {
          type: 'FIXED_AMOUNT',
          value: '5.00',
        },
      }),
    ).expect(201);
    zeroActiveProductId = zeroProdRes.body.data.id as string;

    const zeroAttrRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId: zeroActiveProductId, name: 'Finish', sortOrder: 0 }),
    ).expect(201);
    const zeroValRes = await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/${zeroAttrRes.body.data.id as string}/values`)
        .send({ value: 'Brass', sortOrder: 0 }),
    ).expect(201);

    const soleVarRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: zeroActiveProductId,
          sku: `LAMP-BRASS-${runId}`,
          price: '25.00',
          isActive: true,
          isDefault: true,
          attributeValueIds: [zeroValRes.body.data.id as string],
        }),
    ).expect(201);
    zeroActiveSoleVariantId = soleVarRes.body.data.id as string;

    await asOwnerA(
      request(app)
        .patch(`/api/v1/products/${zeroActiveProductId}/status`)
        .send({ status: ProductStatus.ACTIVE }),
    ).expect(200);

    // Deactivate sole variant while product stays ACTIVE
    await asOwnerA(
      request(app)
        .patch(`/api/v1/product-variants/${zeroActiveSoleVariantId}`)
        .send({ isActive: false }),
    ).expect(200);

    // ------------------------------------------------------------------
    // 3. Non-ACTIVE products (DRAFT, INACTIVE, ARCHIVED) with uploaded images
    // ------------------------------------------------------------------
    const draftProdRes = await asOwnerA(
      request(app).post('/api/v1/products').send({
        name: `Draft Item ${runId}`,
        slug: `draft-item-${runId}`,
        categoryId: categoryAId,
        basePrice: '50.00',
      }),
    ).expect(201);
    draftProductId = draftProdRes.body.data.id as string;

    const draftImgRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-images/upload')
        .field('productId', draftProductId)
        .attach('image', VALID_PNG, { filename: 'draft.png', contentType: 'image/png' }),
    ).expect(201);
    draftImageId = draftImgRes.body.data.id as string;

    const inactiveProd = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        name: `Inactive Item ${runId}`,
        slug: `inactive-item-${runId}`,
        categoryId: categoryAId,
        basePrice: '50.00',
        status: ProductStatus.INACTIVE,
      },
    });
    inactiveProductId = inactiveProd.id;

    const archivedProd = await testPrisma.product.create({
      data: {
        tenantId: tenantA.id,
        name: `Archived Item ${runId}`,
        slug: `archived-item-${runId}`,
        categoryId: categoryAId,
        basePrice: '50.00',
        status: ProductStatus.ARCHIVED,
      },
    });
    archivedProductId = archivedProd.id;
  });

  afterAll(async () => {
    (env as { UPLOAD_DIR: string }).UPLOAD_DIR = originalUploadDir;

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
    await testPrisma.address.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await testPrisma.productCollectionItem.deleteMany({
      where: { collection: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.productCollection.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.shippingRule.deleteMany({
      where: {
        method: {
          zone: {
            profile: { tenantId: { in: [tenantA.id, tenantB.id] } },
          },
        },
      },
    });
    await testPrisma.shippingMethod.deleteMany({
      where: {
        zone: {
          profile: { tenantId: { in: [tenantA.id, tenantB.id] } },
        },
      },
    });
    await testPrisma.shippingZone.deleteMany({
      where: { profile: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.shippingProfile.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: { in: [tenantA.id, tenantB.id] } } },
    });
    await testPrisma.taxProfile.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await testPrisma.taxCategory.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
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
    if (tempUploadDir && existsSync(tempUploadDir)) {
      rmSync(tempUploadDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // H-05: Zero storageKey / imageStorageKey exposure on public endpoints
  // =========================================================================

  it('H-05: omits storageKey and imageStorageKey across all public catalog and storefront endpoints while preserving valid URLs', async () => {
    const publicEndpoints = [
      '/api/v1/products',
      `/api/v1/products/${varProductId}`,
      `/api/v1/products/${zeroActiveProductId}`,
      '/api/v1/products/offers',
      '/api/v1/products/best-sellers',
      '/api/v1/products/new-arrivals',
      '/api/v1/home',
      `/api/v1/collections/${collectionAId}/products`,
      '/api/v1/categories',
      `/api/v1/categories/${categoryAId}`,
      '/api/v1/brands',
      `/api/v1/brands/${brandAId}`,
      `/api/v1/product-images/product/${varProductId}`,
    ];

    for (const endpoint of publicEndpoints) {
      const res = await request(app)
        .get(endpoint)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(200);

      expect(
        findSensitiveKeys(res.body),
        `Expected zero storageKey/imageStorageKey keys on ${endpoint}`,
      ).toEqual([]);
    }

    // Verify valid public URLs are preserved on product detail & public product images
    const detailRes = await request(app)
      .get(`/api/v1/products/${varProductId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);

    const detail = detailRes.body.data as {
      images: Array<{ id: string; url: string }>;
      attributes: Array<{
        id: string;
        name: string;
        values: Array<{ id: string; value: string; imageUrl: string | null }>;
      }>;
      variants: Array<{
        id: string;
        images: Array<{ id: string; url: string }>;
      }>;
    };

    expect(detail.images[0]?.url).toBe(varProductImageUrl);
    expect(detail.attributes[0]?.values[0]?.imageUrl).toBe(crimsonSwatchUrl);
    expect(detail.variants[0]?.images[0]?.url).toBe(activeVariantImageUrl);

    const productImagesRes = await request(app)
      .get(`/api/v1/product-images/product/${varProductId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);

    const publicImages = productImagesRes.body.data as Array<{
      id: string;
      productId: string;
      url: string;
    }>;
    expect(publicImages).toHaveLength(1);
    expect(publicImages[0]).toMatchObject({
      id: varProductImageId,
      productId: varProductId,
      url: varProductImageUrl,
    });
    expect(publicImages[0]).not.toHaveProperty('storageKey');
  });

  it('H-05: requires merchant role auth on GET /api/v1/product-images/:id and restricts GET /product/:productId to ACTIVE products', async () => {
    // Unauthenticated GET /:id -> 401
    await request(app)
      .get(`/api/v1/product-images/${varProductImageId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(401);

    // Customer GET /:id -> 403
    await asCustomerA(
      request(app).get(`/api/v1/product-images/${varProductImageId}`),
    ).expect(403);

    // Cross-tenant OWNER GET /:id -> 404
    await asOwnerB(
      request(app).get(`/api/v1/product-images/${varProductImageId}`),
    ).expect(404);

    // Tenant OWNER, ADMIN, MANAGER GET /:id -> 200 (preserves Merchant BFF ownership check)
    for (const helper of [asOwnerA, asAdminA, asManagerA]) {
      const res = await helper(
        request(app).get(`/api/v1/product-images/${varProductImageId}`),
      ).expect(200);
      expect(res.body.data).toMatchObject({
        id: varProductImageId,
        productId: varProductId,
        url: varProductImageUrl,
      });
    }

    // Merchant can also fetch DRAFT product image by ID (for BFF ownership checks)
    const draftImgById = await asOwnerA(
      request(app).get(`/api/v1/product-images/${draftImageId}`),
    ).expect(200);
    expect(draftImgById.body.data.productId).toBe(draftProductId);

    // Public GET /product/:productId rejects DRAFT, INACTIVE, ARCHIVED, and cross-tenant products
    for (const hiddenProductId of [
      draftProductId,
      inactiveProductId,
      archivedProductId,
    ]) {
      const res = await request(app)
        .get(`/api/v1/product-images/product/${hiddenProductId}`)
        .set('X-Tenant-Slug', tenantA.slug)
        .expect(404);
      expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
    }

    const crossTenantPublicImages = await request(app)
      .get(`/api/v1/product-images/product/${varProductId}`)
      .set('X-Tenant-Slug', tenantB.slug)
      .expect(404);
    expect(crossTenantPublicImages.body.code).toBe('PRODUCT_NOT_FOUND');
  });

  // =========================================================================
  // H-06: Inactive variants hidden publicly & unreferenced attributes pruned
  // =========================================================================

  it('H-06: hides inactive variants and prunes unreferenced attribute values and empty attributes on GET /api/v1/products/:id while preserving merchant visibility', async () => {
    const publicRes = await request(app)
      .get(`/api/v1/products/${varProductId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);

    const publicData = publicRes.body.data as {
      attributes: Array<{
        id: string;
        name: string;
        values: Array<{ id: string; value: string; imageUrl: string | null }>;
      }>;
      variants: Array<{
        id: string;
        sku: string;
        isActive: boolean;
        images: Array<{ url: string }>;
      }>;
    };

    // Only active variant appears publicly
    expect(publicData.variants).toHaveLength(1);
    expect(publicData.variants[0]).toMatchObject({
      id: activeVariantId,
      sku: activeVariantSku,
      isActive: true,
    });

    // Inactive variant ID, SKU, and image URL must not appear anywhere in public JSON
    const serialized = JSON.stringify(publicRes.body);
    expect(serialized).not.toContain(inactiveVariantId);
    expect(serialized).not.toContain(inactiveVariantSku);
    expect(serialized).not.toContain(inactiveVariantImageUrl);

    // Attributes: only Color -> [Crimson] remains; Obsidian and entire Edition attribute are pruned
    expect(publicData.attributes).toHaveLength(1);
    expect(publicData.attributes[0]?.id).toBe(colorAttrId);
    expect(publicData.attributes[0]?.name).toBe('Color');
    expect(publicData.attributes[0]?.values).toHaveLength(1);
    expect(publicData.attributes[0]?.values[0]).toMatchObject({
      id: crimsonValId,
      value: 'Crimson',
      imageUrl: crimsonSwatchUrl,
    });
    expect(publicData.attributes[0]?.values[0]).not.toHaveProperty(
      'imageStorageKey',
    );
    expect(serialized).not.toContain(obsidianValId);
    expect(serialized).not.toContain(editionAttrId);
    expect(serialized).not.toContain(vaultValId);

    // Merchant detail still sees both active & inactive variants and all attributes
    const merchantRes = await asOwnerA(
      request(app).get(`/api/v1/merchant/products/${varProductId}`),
    ).expect(200);
    const merchantData = merchantRes.body.data as {
      attributes: Array<{ id: string; values: Array<{ id: string }> }>;
      variants: Array<{ id: string; isActive: boolean }>;
    };
    expect(merchantData.variants.map((v) => v.id)).toEqual(
      expect.arrayContaining([activeVariantId, inactiveVariantId]),
    );
    expect(merchantData.attributes.map((a) => a.id)).toEqual(
      expect.arrayContaining([colorAttrId, editionAttrId]),
    );
    const merchantColorAttr = merchantData.attributes.find(
      (a) => a.id === colorAttrId,
    );
    expect(merchantColorAttr?.values.map((v) => v.id)).toEqual(
      expect.arrayContaining([crimsonValId, obsidianValId]),
    );
  });

  it('H-06: preserves HTTP 200 with variants: [], attributes: [], and product-level pricing for ACTIVE products with zero active variants', async () => {
    const detailRes = await request(app)
      .get(`/api/v1/products/${zeroActiveProductId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);

    const detail = detailRes.body.data as {
      id: string;
      status: string;
      basePrice: string;
      pricing: { basePrice: string; finalPrice: string };
      variants: unknown[];
      attributes: unknown[];
    };

    expect(detail.status).toBe('ACTIVE');
    expect(detail.variants).toEqual([]);
    expect(detail.attributes).toEqual([]);
    // Must reflect product basePrice (85.00 - 5.00 = 80.00), NOT deactivated variant price (25.00)
    expect(detail.pricing.basePrice).toBe('85.00');
    expect(detail.pricing.finalPrice).toBe('80.00');
    expect(JSON.stringify(detailRes.body)).not.toContain(zeroActiveSoleVariantId);

    // Product listing & offers/new-arrivals cards also fall back to product pricing (never inactive 25.00)
    const listRes = await request(app)
      .get('/api/v1/products')
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    const listItem = (
      listRes.body.data.items as Array<{
        id: string;
        hasVariants: boolean;
        defaultVariantId: string | null;
        displayPricing: { finalPrice: string };
      }>
    ).find((item) => item.id === zeroActiveProductId);
    expect(listItem).toBeDefined();
    expect(listItem?.hasVariants).toBe(false);
    expect(listItem?.defaultVariantId).toBeNull();
    expect(listItem?.displayPricing.finalPrice).toBe('80.00');

    const offersRes = await request(app)
      .get('/api/v1/products/offers')
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    const offerCard = (
      offersRes.body.data.items as Array<{
        id: string;
        hasVariants: boolean;
        defaultVariantId: string | null;
        price: { final: string };
      }>
    ).find((item) => item.id === zeroActiveProductId);
    expect(offerCard).toBeDefined();
    expect(offerCard?.hasVariants).toBe(false);
    expect(offerCard?.defaultVariantId).toBeNull();
    expect(offerCard?.price.final).toBe('80.00');
  });

  // =========================================================================
  // H-06: Cart & Checkout enforcement + Cross-tenant isolation
  // =========================================================================

  it('H-06: rejects inactive variants in cart add/update, checkout preview, and checkout submission, and enforces cross-tenant product isolation', async () => {
    // Cross-tenant public product detail returns 404
    const crossTenantDetail = await request(app)
      .get(`/api/v1/products/${varProductId}`)
      .set('X-Tenant-Slug', tenantB.slug)
      .expect(404);
    expect(crossTenantDetail.body.code).toBe('PRODUCT_NOT_FOUND');

    // Direct add of inactive variant to cart -> 409 VARIANT_NOT_AVAILABLE
    const addInactiveRes = await asCustomerA(
      request(app)
        .post('/api/v1/cart/items')
        .send({ variantId: inactiveVariantId, quantity: 1 }),
    ).expect(409);
    expect(addInactiveRes.body.code).toBe('VARIANT_NOT_AVAILABLE');

    // Create a dedicated variant, add to cart while active, then deactivate it mid-session
    const navyValRes = await asOwnerA(
      request(app)
        .post(`/api/v1/product-attributes/${colorAttrId}/values`)
        .send({ value: 'Navy', sortOrder: 2 }),
    ).expect(201);
    const navyValId = navyValRes.body.data.id as string;

    const transientVarRes = await asOwnerA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId: varProductId,
          sku: `COAT-TRANSIENT-${runId}`,
          price: '110.00',
          isActive: true,
          attributeValueIds: [navyValId],
        }),
    ).expect(201);
    const transientVariantId = transientVarRes.body.data.id as string;

    await createInventoryFixture({
      data: { variantId: transientVariantId, quantity: 5, reservedQuantity: 0 },
    });

    await asCustomerA(
      request(app)
        .post('/api/v1/cart/items')
        .send({ variantId: transientVariantId, quantity: 1 }),
    ).expect(200);

    // Merchant deactivates variant while it is already in customer's cart
    await asOwnerA(
      request(app)
        .patch(`/api/v1/product-variants/${transientVariantId}`)
        .send({ isActive: false }),
    ).expect(200);

    // Cart update rejects deactivated variant
    const patchCartRes = await asCustomerA(
      request(app)
        .patch(`/api/v1/cart/items/${transientVariantId}`)
        .send({ quantity: 2 }),
    ).expect(409);
    expect(patchCartRes.body.code).toBe('VARIANT_NOT_AVAILABLE');

    // Checkout preview rejects deactivated variant in cart
    const previewRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout/preview')
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
        }),
    ).expect(409);
    expect(previewRes.body.code).toBe('VARIANT_NOT_AVAILABLE');

    // Checkout submission rejects deactivated variant in cart
    const checkoutRes = await asCustomerA(
      request(app)
        .post('/api/v1/checkout')
        .set('Idempotency-Key', `h06-inactive-${randomUUID()}`)
        .send({
          shippingAddressId: addressAId,
          shippingMethodCode,
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        }),
    ).expect(409);
    expect(checkoutRes.body.code).toBe('VARIANT_NOT_AVAILABLE');

    // Clear cart cleanly
    await asCustomerA(request(app).delete('/api/v1/cart')).expect(200);
  });
});
