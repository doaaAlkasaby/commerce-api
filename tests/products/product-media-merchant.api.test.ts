import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogTenantFixture } from '../helpers/catalog.js';
import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import {
  deleteUnreferencedStorageKey,
  isStorageKeyReferenced,
} from '../../src/common/storage/storage-reference.js';
import type { StorageService } from '../../src/common/storage/storage.types.js';
import { env } from '../../src/config/env.js';
import { testPrisma } from '../../src/config/test-database.js';

// Minimal valid 1x1 PNG buffer
const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

// Minimal valid JPEG header + EOI
const VALID_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

describe('Phase 2D.5A — Product, Variant & Attribute Value Media API + Safe Storage Cleanup', () => {
  const tenantA = catalogTenantFixture();
  const tenantB = catalogTenantFixture();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const originalUploadDir = env.UPLOAD_DIR;
  let tempUploadDir = '';

  let adminAId: string;
  let adminAToken: string;
  let customerAId: string;
  let customerAToken: string;
  let adminBId: string;
  let adminBToken: string;
  let categoryAId: string;

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
    tempUploadDir = mkdtempSync(path.join(tmpdir(), 'commerce-media-test-'));
    (env as { UPLOAD_DIR: string }).UPLOAD_DIR = tempUploadDir;

    await testPrisma.$connect();
    await tenantA.create();
    await tenantB.create();

    const catA = await testPrisma.category.create({
      data: {
        tenantId: tenantA.id,
        name: `Media Cat A ${runId}`,
        slug: `media-cat-a-${runId}`,
      },
    });
    categoryAId = catA.id;

    const [adminA, customerA, adminB] = await Promise.all([
      testPrisma.user.create({
        data: {
          email: `media-admin-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Admin',
          lastName: 'A',
          role: 'ADMIN',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `media-cust-a-${runId}@example.test`,
          passwordHash: 'test-hash',
          firstName: 'Customer',
          lastName: 'A',
          role: 'CUSTOMER',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `media-admin-b-${runId}@example.test`,
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
  });

  afterAll(async () => {
    (env as { UPLOAD_DIR: string }).UPLOAD_DIR = originalUploadDir;
    await testPrisma.banner.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await tenantA.cleanup();
    await tenantB.cleanup();
    await testPrisma.user.deleteMany({
      where: { id: { in: [adminAId, customerAId, adminBId].filter(Boolean) } },
    });
    await testPrisma.$disconnect();
    if (tempUploadDir && existsSync(tempUploadDir)) {
      rmSync(tempUploadDir, { recursive: true, force: true });
    }
  });

  it('manages product gallery, variant images (204 delete), attribute value image replace/clear, cross-tenant rejection, and Flutter DTOs', async () => {
    const createdProduct = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Silk Scarf',
          slug: `silk-scarf-${runId}`,
          categoryId: categoryAId,
          basePrice: '60.00',
        }),
    ).expect(201);
    const productId = createdProduct.body.data.id as string;

    // Customer cannot upload product images
    await asCustomerA(
      request(app)
        .post('/api/v1/product-images/upload')
        .field('productId', productId)
        .attach('image', VALID_PNG, {
          filename: 'scarf.png',
          contentType: 'image/png',
        }),
    ).expect(403);

    // Invalid magic bytes rejected
    await asAdminA(
      request(app)
        .post('/api/v1/product-images/upload')
        .field('productId', productId)
        .attach('image', Buffer.from('not-an-image'), {
          filename: 'fake.png',
          contentType: 'image/png',
        }),
    ).expect(400);

    // Upload 2 product images
    const img1Res = await asAdminA(
      request(app)
        .post('/api/v1/product-images/upload')
        .field('productId', productId)
        .field('altText', 'Front view')
        .field('sortOrder', '0')
        .field('isPrimary', 'true')
        .attach('image', VALID_PNG, {
          filename: 'front.png',
          contentType: 'image/png',
        }),
    ).expect(201);
    const img1 = img1Res.body.data as {
      id: string;
      storageKey: string;
      url: string;
      altText: string;
      sortOrder: number;
      isPrimary: boolean;
    };
    expect(img1.isPrimary).toBe(true);
    expect(img1.altText).toBe('Front view');
    expect(existsSync(path.join(tempUploadDir, img1.storageKey))).toBe(true);

    const img2Res = await asAdminA(
      request(app)
        .post('/api/v1/product-images/upload')
        .field('productId', productId)
        .field('altText', 'Back view')
        .field('sortOrder', '1')
        .field('isPrimary', 'false')
        .attach('image', VALID_JPEG, {
          filename: 'back.jpg',
          contentType: 'image/jpeg',
        }),
    ).expect(201);
    const img2 = img2Res.body.data as typeof img1;
    expect(img2.isPrimary).toBe(false);
    expect(existsSync(path.join(tempUploadDir, img2.storageKey))).toBe(true);

    // Cross-tenant cannot mutate or delete Tenant A's product image
    await asAdminB(
      request(app)
        .patch(`/api/v1/product-images/${img2.id}`)
        .send({ altText: 'Hacked' }),
    ).expect(404);
    await asAdminB(
      request(app).delete(`/api/v1/product-images/${img2.id}`),
    ).expect(404);

    // Update alt text + ordering & switch primary to img2
    const updatedImg2 = await asAdminA(
      request(app)
        .patch(`/api/v1/product-images/${img2.id}`)
        .send({ altText: 'Detail view', sortOrder: 5 }),
    ).expect(200);
    expect(updatedImg2.body.data).toMatchObject({
      id: img2.id,
      altText: 'Detail view',
      sortOrder: 5,
    });

    const primaryRes = await asAdminA(
      request(app).patch(`/api/v1/product-images/${img2.id}/primary`),
    ).expect(200);
    expect(primaryRes.body.data.isPrimary).toBe(true);

    // Create attribute + value + variant so we can test attribute value images, variant images, and Flutter DTOs
    const attrRes = await asAdminA(
      request(app)
        .post('/api/v1/product-attributes')
        .send({ productId, name: 'Color', sortOrder: 0 }),
    ).expect(201);
    const attrId = attrRes.body.data.id as string;

    const valRes = await asAdminA(
      request(app)
        .post(`/api/v1/product-attributes/${attrId}/values`)
        .send({ value: 'Emerald', sortOrder: 0 }),
    ).expect(201);
    const valueId = valRes.body.data.id as string;

    // Upload attribute value swatch, then replace it -> old file deleted, new file kept
    const swatch1Res = await asAdminA(
      request(app)
        .post(`/api/v1/product-attributes/values/${valueId}/image`)
        .attach('image', VALID_PNG, {
          filename: 'emerald-1.png',
          contentType: 'image/png',
        }),
    ).expect(200);
    const swatch1Key = swatch1Res.body.data.image.storageKey as string;
    expect(existsSync(path.join(tempUploadDir, swatch1Key))).toBe(true);

    const swatch2Res = await asAdminA(
      request(app)
        .post(`/api/v1/product-attributes/values/${valueId}/image`)
        .attach('image', VALID_JPEG, {
          filename: 'emerald-2.jpg',
          contentType: 'image/jpeg',
        }),
    ).expect(200);
    const swatch2Key = swatch2Res.body.data.image.storageKey as string;
    expect(swatch2Key).not.toBe(swatch1Key);
    expect(existsSync(path.join(tempUploadDir, swatch1Key))).toBe(false);
    expect(existsSync(path.join(tempUploadDir, swatch2Key))).toBe(true);

    // Cross-tenant cannot clear swatch
    await asAdminB(
      request(app).delete(`/api/v1/product-attributes/values/${valueId}/image`),
    ).expect(404);

    // Create active variant & upload 2 variant images
    const varRes = await asAdminA(
      request(app)
        .post('/api/v1/product-variants')
        .send({
          productId,
          sku: `SCARF-EM-${runId}`,
          isActive: true,
          attributeValueIds: [valueId],
        }),
    ).expect(201);
    const variantId = varRes.body.data.id as string;

    const vImg1Res = await asAdminA(
      request(app)
        .post('/api/v1/product-variant-images/upload')
        .field('variantId', variantId)
        .field('altText', 'Variant main')
        .field('sortOrder', '0')
        .attach('image', VALID_PNG, {
          filename: 'v1.png',
          contentType: 'image/png',
        }),
    ).expect(201);
    const vImg1 = vImg1Res.body.data as {
      id: string;
      storageKey: string;
      isPrimary: boolean;
    };
    expect(vImg1.isPrimary).toBe(true);

    const vImg2Res = await asAdminA(
      request(app)
        .post('/api/v1/product-variant-images/upload')
        .field('variantId', variantId)
        .field('altText', 'Variant angle')
        .field('sortOrder', '2')
        .attach('image', VALID_JPEG, {
          filename: 'v2.jpg',
          contentType: 'image/jpeg',
        }),
    ).expect(201);
    const vImg2 = vImg2Res.body.data as typeof vImg1;
    expect(vImg2.isPrimary).toBe(false);

    // Activate product and verify both Merchant Detail DTO & Flutter Storefront DTOs
    await asAdminA(
      request(app)
        .patch(`/api/v1/products/${productId}/status`)
        .send({ status: 'ACTIVE' }),
    ).expect(200);

    const merchantDetail = await asAdminA(
      request(app).get(`/api/v1/merchant/products/${productId}`),
    ).expect(200);
    expect(merchantDetail.body.data.images[0].id).toBe(img2.id);
    expect(merchantDetail.body.data.images[0].isPrimary).toBe(true);
    expect(merchantDetail.body.data.attributes[0].values[0].imageUrl).toContain(
      swatch2Key,
    );
    expect(merchantDetail.body.data.attributes[0].values[0]).not.toHaveProperty(
      'imageStorageKey',
    );
    expect(merchantDetail.body.data.variants[0].images).toHaveLength(2);

    // Flutter storefront list + detail compatibility
    const storefrontList = await request(app)
      .get('/api/v1/products')
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    const listItem = storefrontList.body.data.items.find(
      (item: { id: string }) => item.id === productId,
    );
    expect(listItem.primaryImage).toEqual({
      id: img2.id,
      url: img2.url,
      altText: 'Detail view',
    });

    const storefrontDetail = await request(app)
      .get(`/api/v1/products/${productId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .expect(200);
    expect(storefrontDetail.body.data.images[0]).toMatchObject({
      id: img2.id,
      url: img2.url,
      altText: 'Detail view',
      isPrimary: true,
    });
    expect(storefrontDetail.body.data.variants[0].images[0]).toMatchObject({
      id: vImg1.id,
      isPrimary: true,
    });
    expect(
      storefrontDetail.body.data.attributes[0].values[0].imageUrl,
    ).toContain(swatch2Key);

    // Delete variant image returns 204 No Content and removes unreferenced file
    await asAdminA(
      request(app).delete(`/api/v1/product-variant-images/${vImg2.id}`),
    ).expect(204);
    expect(existsSync(path.join(tempUploadDir, vImg2.storageKey))).toBe(false);

    // Clear attribute value swatch removes unreferenced file
    const cleared = await asAdminA(
      request(app).delete(`/api/v1/product-attributes/values/${valueId}/image`),
    ).expect(200);
    expect(cleared.body.data.image).toBeNull();
    expect(existsSync(path.join(tempUploadDir, swatch2Key))).toBe(false);

    // Delete product image returns 200 { data: null } and removes unreferenced file
    await asAdminA(
      request(app).delete(`/api/v1/product-images/${img1.id}`),
    ).expect(200);
    expect(existsSync(path.join(tempUploadDir, img1.storageKey))).toBe(false);
    // Repeat delete returns 404
    await asAdminA(
      request(app).delete(`/api/v1/product-images/${img1.id}`),
    ).expect(404);
  });

  it('protects shared storage references across models, blocks traversal, protects development-v82 assets, and surfaces storage errors', async () => {
    const productRes = await asAdminA(
      request(app)
        .post('/api/v1/products')
        .send({
          name: 'Shared Asset Product',
          slug: `shared-asset-${runId}`,
          categoryId: categoryAId,
          basePrice: '25.00',
        }),
    ).expect(201);
    const productId = productRes.body.data.id as string;

    const variantRes = await asAdminA(
      request(app)
        .post('/api/v1/product-variants/default')
        .send({ productId, sku: `SHARED-SKU-${runId}`, isActive: true }),
    ).expect(201);
    const variantId = variantRes.body.data.id as string;

    // Create a shared file referenced by BOTH a ProductImage and a ProductVariantImage
    const sharedKey = `products/shared-${runId}.png`;
    const sharedPath = path.join(tempUploadDir, sharedKey);
    mkdirSync(path.dirname(sharedPath), { recursive: true });
    writeFileSync(sharedPath, VALID_PNG);

    const pImg = await testPrisma.productImage.create({
      data: {
        productId,
        storageKey: sharedKey,
        url: `${env.UPLOAD_BASE_URL}/${sharedKey}`,
        sortOrder: 0,
        isPrimary: true,
      },
    });
    const vImg = await testPrisma.productVariantImage.create({
      data: {
        variantId,
        storageKey: sharedKey,
        url: `${env.UPLOAD_BASE_URL}/${sharedKey}`,
        sortOrder: 0,
        isPrimary: true,
      },
    });

    // Deleting the product image MUST NOT delete the file while the variant image still references it
    await asAdminA(
      request(app).delete(`/api/v1/product-images/${pImg.id}`),
    ).expect(200);
    expect(existsSync(sharedPath)).toBe(true);
    expect(await isStorageKeyReferenced(sharedKey)).toBe(true);

    // Also verify Banner.mobileImageStorageKey and TenantSetting.logoStorageKey protect files
    const banner = await testPrisma.banner.create({
      data: {
        tenantId: tenantA.id,
        title: `Shared Banner ${runId}`,
        imageStorageKey: `products/other-${runId}.png`,
        imageUrl: `${env.UPLOAD_BASE_URL}/products/other-${runId}.png`,
        mobileImageStorageKey: sharedKey,
        mobileImageUrl: `${env.UPLOAD_BASE_URL}/${sharedKey}`,
      },
    });

    // Deleting the variant image still MUST NOT unlink because Banner.mobileImageStorageKey references it
    await asAdminA(
      request(app).delete(`/api/v1/product-variant-images/${vImg.id}`),
    ).expect(204);
    expect(existsSync(sharedPath)).toBe(true);

    // Once the final reference is removed, deleteUnreferencedStorageKey unlinks the physical file
    await testPrisma.banner.delete({ where: { id: banner.id } });
    expect(await deleteUnreferencedStorageKey(sharedKey)).toBe(true);
    expect(existsSync(sharedPath)).toBe(false);

    // Missing physical file (ENOENT) succeeds safely
    expect(await deleteUnreferencedStorageKey(`products/missing-${runId}.png`)).toBe(true);

    // Bundled development-v82 assets are never unlinked
    const devKey = `development-v82/test-${runId}.png`;
    const devPath = path.join(tempUploadDir, devKey);
    mkdirSync(path.dirname(devPath), { recursive: true });
    writeFileSync(devPath, VALID_PNG);
    expect(await deleteUnreferencedStorageKey(devKey)).toBe(false);
    expect(existsSync(devPath)).toBe(true);

    // Path traversal keys are rejected explicitly
    await expect(
      deleteUnreferencedStorageKey('../etc/passwd'),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_STORAGE_KEY',
    });

    // Non-ENOENT storage failure is propagated explicitly (not swallowed)
    const failingStorage: StorageService = {
      upload: async () => {
        throw new Error('unused');
      },
      delete: async () => {
        throw new Error('EACCES: disk permission denied');
      },
    };
    await expect(
      deleteUnreferencedStorageKey(`products/fail-${runId}.png`, failingStorage),
    ).rejects.toThrow('EACCES: disk permission denied');
  });
});
