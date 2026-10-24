import request from 'supertest';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  ProductStatus,
} from '../../src/generated/prisma/client.js';

import app from '../../src/app.js';

import {
  createAccessToken,
} from '../../src/common/security/jwt.js';

import {
  testPrisma,
} from '../../src/config/test-database.js';

describe('Products API public visibility', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const productIds: string[] = [];

  let categoryId: string;
  let adminId: string;
  let adminToken: string;
  let productsByStatus: Record<ProductStatus, string>;

  beforeAll(async () => {
    await testPrisma.$connect();

    const category = await testPrisma.category.create({
      data: {
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

    productsByStatus = {} as Record<ProductStatus, string>;

    for (const status of Object.values(ProductStatus)) {
      const product = await testPrisma.product.create({
        data: {
          name: `${status} visibility product`,
          slug: `product-${status.toLowerCase()}-${runId}`,
          sku: `SKU-${status}-${runId}`,
          price: '12.50',
          categoryId,
          status,
        },
      });
      productsByStatus[status] = product.id;
      productIds.push(product.id);
    }
  });

  afterAll(async () => {
    if (productIds.length > 0) {
      await testPrisma.product.deleteMany({
        where: {
          id: {
            in: productIds,
          },
        },
      });
    }
    await testPrisma.user.deleteMany({
      where: {
        id: adminId,
      },
    });
    await testPrisma.category.deleteMany({
      where: {
        id: categoryId,
      },
    });
    await testPrisma.$disconnect();
  });

  it.each([
    ProductStatus.DRAFT,
    ProductStatus.INACTIVE,
    ProductStatus.ARCHIVED,
  ])('does not expose %s products by ID publicly', async (status) => {
    const response = await request(app)
      .get(`/api/v1/products/${productsByStatus[status]}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('exposes an active product by ID publicly', async () => {
    const response = await request(app)
      .get(`/api/v1/products/${productsByStatus[ProductStatus.ACTIVE]}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(
      productsByStatus[ProductStatus.ACTIVE],
    );
    expect(response.body.data.status).toBe(ProductStatus.ACTIVE);
  });

  it('lists only active products publicly', async () => {
    const response = await request(app)
      .get('/api/v1/products')
      .query({
        categoryId,
      });
    const responseIds = response.body.data.items.map(
      (product: { id: string }) => product.id,
    );

    expect(response.status).toBe(200);
    expect(responseIds).toContain(
      productsByStatus[ProductStatus.ACTIVE],
    );
    expect(responseIds).not.toContain(
      productsByStatus[ProductStatus.DRAFT],
    );
    expect(responseIds).not.toContain(
      productsByStatus[ProductStatus.INACTIVE],
    );
    expect(responseIds).not.toContain(
      productsByStatus[ProductStatus.ARCHIVED],
    );
    expect(response.body.data.pagination.total).toBe(1);
  });

  it('allows an admin to retrieve non-public products', async () => {
    const response = await request(app)
      .get(`/api/v1/products/admin/${productsByStatus[ProductStatus.DRAFT]}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(ProductStatus.DRAFT);
  });

  it('allows an admin to list products regardless of status', async () => {
    const response = await request(app)
      .get('/api/v1/products/admin')
      .query({
        categoryId,
      })
      .set('Authorization', `Bearer ${adminToken}`);
    const responseIds = response.body.data.items.map(
      (product: { id: string }) => product.id,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.pagination.total).toBe(4);
    for (const productId of Object.values(productsByStatus)) {
      expect(responseIds).toContain(productId);
    }
  });
});
