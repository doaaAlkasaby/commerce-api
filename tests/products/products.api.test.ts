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
});
