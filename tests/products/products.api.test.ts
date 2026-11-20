import { catalogTenantFixture } from '../helpers/catalog.js';
import request from 'supertest';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProductStatus } from '../../src/generated/prisma/client.js';

import app from '../../src/app.js';

import { createAccessToken } from '../../src/common/security/jwt.js';

import { testPrisma } from '../../src/config/test-database.js';

describe('Products API public visibility', () => {
  const tenant = catalogTenantFixture();
  const countryCode = `P${tenant.id}`.toUpperCase();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const productIds: string[] = [];

  let categoryId: string;
  let adminId: string;
  let adminToken: string;
  const productsByStatus: Record<ProductStatus, string> = {
    DRAFT: '',
    ACTIVE: '',
    INACTIVE: '',
    ARCHIVED: '',
  };

  beforeAll(async () => {
    await testPrisma.$connect();
    await tenant.create();
    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: 'Product test country',
        currencyCode: 'USD',
      },
    });

    const category = await testPrisma.category.create({
      data: {
        tenantId: tenant.id,
        name: `API Product Category ${runId}`,
        slug: `api-product-category-${runId}`,
      },
    });
    categoryId = category.id;

    const admin = await testPrisma.user.create({
      data: {
        email: `product-api-admin-${runId}@example.com`,
        passwordHash: 'test-password-hash',
        firstName: 'Product',
        lastName: 'Admin',
        role: 'ADMIN',
      },
    });
    adminId = admin.id;
    adminToken = await createAccessToken(admin.id);

    await testPrisma.tenantMember.create({
      data: { tenantId: tenant.id, userId: admin.id, role: 'ADMIN' },
    });

    for (const status of Object.values(ProductStatus)) {
      const product = await testPrisma.product.create({
        data: {
          tenantId: tenant.id,
          name: `${status} visibility product`,
          slug: `product-${status.toLowerCase()}-${runId}`,
          basePrice: '12.50',
          categoryId,
          status,
        },
      });
      await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `SKU-${status}-${runId}`,
          combinationKey: '',
          isActive: true,
          isDefault: true,
        },
      });
      productsByStatus[status] = product.id;
      productIds.push(product.id);
    }
  });

  afterAll(async () => {
    await tenant.cleanup();
    if (adminId) await testPrisma.user.deleteMany({ where: { id: adminId } });
    await testPrisma.country.deleteMany({ where: { code: countryCode } });
    await testPrisma.$disconnect();
  });

  it('lists and retrieves all statuses through the protected merchant routes', async () => {
    const merchant = (path: string) =>
      request(app)
        .get('/api/v1/merchant/products' + path)
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`);
    await request(app)
      .get('/api/v1/merchant/products')
      .set('X-Tenant-Slug', tenant.slug)
      .expect(401);
    const list = await merchant('').expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.body.data.pagination.total).toBe(4);
    expect(
      list.body.data.items.map((row: { id: string }) => row.id).sort(),
    ).toEqual([...productIds].sort());
    for (const status of Object.values(ProductStatus)) {
      const filtered = await merchant('')
        .query({ status, categoryId, search: `SKU-${status}` })
        .expect(200);
      expect(filtered.body.data.items[0].id).toBe(productsByStatus[status]);
      const detail = await merchant('/' + productsByStatus[status]).expect(200);
      expect(detail.body.data).toMatchObject({
        id: productsByStatus[status],
        status,
        variantCount: 1,
        activeVariantCount: 1,
        variants: [{ isDefault: true, isActive: true }],
      });
    }
    await merchant('')
      .query({ sortBy: 'bad', page: 0, tenantId: tenant.id })
      .expect(400);
    const first = await merchant('')
      .query({ limit: 2, sortBy: 'basePrice', sortOrder: 'asc' })
      .expect(200);
    const second = await merchant('')
      .query({ page: 2, limit: 2, sortBy: 'basePrice', sortOrder: 'asc' })
      .expect(200);
    expect(
      [...first.body.data.items, ...second.body.data.items].map(
        ({ id }: { id: string }) => id,
      ),
    ).toEqual([...productIds].sort());
  });

  it('keeps list totals and product IDs scoped to the verified tenant', async () => {
    const other = catalogTenantFixture();
    await other.create();
    const send = (path: string) =>
      request(app)
        .get('/api/v1/merchant/products' + path)
        .set('X-Tenant-Slug', other.slug)
        .set('Authorization', `Bearer ${adminToken}`);
    try {
      await send('').expect(401);
      await testPrisma.tenantMember.create({
        data: { tenantId: other.id, userId: adminId, role: 'MANAGER' },
      });
      const empty = await send('').query({ limit: 1 }).expect(200);
      expect(empty.body.data.pagination.total).toBe(0);
      await send('/' + productsByStatus.ACTIVE).expect(404);
      await testPrisma.tenantMember.update({
        where: { tenantId_userId: { tenantId: other.id, userId: adminId } },
        data: { role: 'CUSTOMER' },
      });
      await send('').expect(403);
    } finally {
      await other.cleanup();
    }
  });

  it.each([
    ProductStatus.DRAFT,
    ProductStatus.INACTIVE,
    ProductStatus.ARCHIVED,
  ])('does not expose %s products by ID publicly', async (status) => {
    const response = await request(app)
      .get(`/api/v1/products/${productsByStatus[status]}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('X-Country-Code', countryCode);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('exposes an active product by ID publicly', async () => {
    const response = await request(app)
      .get(`/api/v1/products/${productsByStatus[ProductStatus.ACTIVE]}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('X-Country-Code', countryCode);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(productsByStatus[ProductStatus.ACTIVE]);
    expect(response.body.data.status).toBe(ProductStatus.ACTIVE);
  });

  it('lists only active products publicly', async () => {
    const response = await request(app)
      .get('/api/v1/products')
      .set('X-Tenant-Slug', tenant.slug)
      .set('X-Country-Code', countryCode)
      .query({
        categoryId,
      });
    const responseIds = response.body.data.items.map(
      (product: { id: string }) => product.id,
    );

    expect(response.status).toBe(200);
    expect(responseIds).toContain(productsByStatus[ProductStatus.ACTIVE]);
    expect(responseIds).not.toContain(productsByStatus[ProductStatus.DRAFT]);
    expect(responseIds).not.toContain(productsByStatus[ProductStatus.INACTIVE]);
    expect(responseIds).not.toContain(productsByStatus[ProductStatus.ARCHIVED]);
    expect(response.body.data.pagination.total).toBe(1);
  });

  it('allows a tenant admin to update a non-public product', async () => {
    const id = productsByStatus.DRAFT;
    const response = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('X-Country-Code', countryCode)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated draft' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Product updated successfully',
      data: { id, name: 'Updated draft', status: 'DRAFT' },
    });
    const publicRead = await request(app)
      .get(`/api/v1/products/${id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('X-Country-Code', countryCode);
    expect(publicRead.status).toBe(404);
    expect(publicRead.body.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('allows a tenant admin to activate a draft with an active variant', async () => {
    const id = productsByStatus.DRAFT;
    const response = await request(app)
      .patch(`/api/v1/products/${id}/status`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('X-Country-Code', countryCode)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id, status: 'ACTIVE' });
    const publicRead = await request(app)
      .get(`/api/v1/products/${id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('X-Country-Code', countryCode);
    expect(publicRead.status).toBe(200);
    expect(publicRead.body.data).toMatchObject({ id, status: 'ACTIVE' });
  });

  it('creates a draft, clears nullable fields, enforces tenant ownership, and rejects missing-variant activation without storefront regression', async () => {
    const other = catalogTenantFixture();
    await other.create();
    const foreignCategory = await testPrisma.category.create({
      data: {
        tenantId: other.id,
        name: `Foreign Cat ${runId}`,
        slug: `foreign-cat-${runId}`,
      },
    });
    const ownBrand = await testPrisma.brand.create({
      data: {
        tenantId: tenant.id,
        name: `Own Brand ${runId}`,
        slug: `own-brand-${runId}`,
      },
    });
    const foreignBrand = await testPrisma.brand.create({
      data: {
        tenantId: other.id,
        name: `Foreign Brand ${runId}`,
        slug: `foreign-brand-${runId}`,
      },
    });

    try {
      const authed = (req: request.Test) =>
        req
          .set('X-Tenant-Slug', tenant.slug)
          .set('Authorization', `Bearer ${adminToken}`);

      // Foreign category and foreign brand rejected
      const badCat = await authed(
        request(app)
          .post('/api/v1/products')
          .send({
            name: 'Bad Cat Product',
            slug: `bad-cat-${runId}`,
            categoryId: foreignCategory.id,
            basePrice: '20.00',
          }),
      );
      expect(badCat.status).toBe(404);
      expect(badCat.body.code).toBe('CATEGORY_NOT_FOUND');

      const badBrand = await authed(
        request(app)
          .post('/api/v1/products')
          .send({
            name: 'Bad Brand Product',
            slug: `bad-brand-${runId}`,
            categoryId,
            brandId: foreignBrand.id,
            basePrice: '20.00',
          }),
      );
      expect(badBrand.status).toBe(404);
      expect(badBrand.body.code).toBe('BRAND_NOT_FOUND');

      // Create draft with discount, description, and brand
      const created = await authed(
        request(app)
          .post('/api/v1/products')
          .send({
            name: 'Phase 2D.3 Draft',
            slug: `phase-2d3-draft-${runId}`,
            description: 'Initial copy',
            categoryId,
            brandId: ownBrand.id,
            basePrice: '55.00',
            discount: { type: 'PERCENTAGE', value: '15' },
          }),
      ).expect(201);
      const draftId = created.body.data.id as string;
      expect(created.body.data.status).toBe('DRAFT');

      // Draft is hidden from public storefront
      await request(app)
        .get(`/api/v1/products/${draftId}`)
        .set('X-Tenant-Slug', tenant.slug)
        .set('X-Country-Code', countryCode)
        .expect(404);

      // Duplicate slug rejected
      const dup = await authed(
        request(app)
          .post('/api/v1/products')
          .send({
            name: 'Duplicate',
            slug: `phase-2d3-draft-${runId}`,
            categoryId,
            basePrice: '55.00',
          }),
      );
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('PRODUCT_SLUG_ALREADY_EXISTS');

      // Clear nullable fields while omitting name/slug/basePrice
      const cleared = await authed(
        request(app).patch(`/api/v1/products/${draftId}`).send({
          description: null,
          brandId: null,
          discount: null,
        }),
      ).expect(200);
      expect(cleared.body.data).toMatchObject({
        id: draftId,
        name: 'Phase 2D.3 Draft',
        description: null,
        brandId: null,
        discountType: null,
        discountValue: null,
      });

      // Missing active variant blocks activation and preserves DRAFT
      const noVariant = await authed(
        request(app)
          .patch(`/api/v1/products/${draftId}/status`)
          .send({ status: 'ACTIVE' }),
      );
      expect(noVariant.status).toBe(409);
      expect(noVariant.body.code).toBe('PRODUCT_REQUIRES_ACTIVE_VARIANT');

      // Archive DRAFT -> ARCHIVED, then verify ARCHIVED has no outgoing transitions
      await authed(
        request(app)
          .patch(`/api/v1/products/${draftId}/status`)
          .send({ status: 'ARCHIVED' }),
      ).expect(200);
      const fromArchived = await authed(
        request(app)
          .patch(`/api/v1/products/${draftId}/status`)
          .send({ status: 'DRAFT' }),
      );
      expect(fromArchived.status).toBe(409);
      expect(fromArchived.body.code).toBe('INVALID_PRODUCT_STATUS_TRANSITION');
    } finally {
      await other.cleanup();
    }
  });
});
