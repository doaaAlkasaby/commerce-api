import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { testPrisma } from '../../src/config/test-database.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { catalogTenantFixture } from '../helpers/catalog.js';

const reviewCases = [
  { method: 'get', suffix: '' },
  { method: 'get', suffix: '/summary' },
  { method: 'post', suffix: '' },
  { method: 'patch', suffix: `/${randomUUID()}` },
  { method: 'delete', suffix: `/${randomUUID()}` },
] satisfies Array<{
  method: 'get' | 'post' | 'patch' | 'delete';
  suffix: string;
}>;

describe('Review middleware route scoping and personal address ownership', () => {
  const tenant = catalogTenantFixture();
  const countryCode = `R${tenant.id}`.toUpperCase();
  const ownerId = randomUUID();
  const otherId = randomUUID();
  let productId: string;
  let addressId: string;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    await tenant.create();
    await testPrisma.country.create({
      data: { code: countryCode, name: 'Routing test', currencyCode: 'USD' },
    });
    const category = await testPrisma.category.create({
      data: { tenantId: tenant.id, name: 'Routing', slug: 'routing' },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        name: 'Routing',
        slug: 'routing',
        basePrice: '10',
        status: 'ACTIVE',
      },
    });
    productId = product.id;
    await testPrisma.user.createMany({
      data: [ownerId, otherId].map((id) => ({
        id,
        email: `${id}@example.test`,
        firstName: 'Routing',
        lastName: 'Test',
        passwordHash: 'unused',
      })),
    });
    const address = await testPrisma.address.create({
      data: {
        userId: ownerId,
        firstName: 'Owner',
        lastName: 'Test',
        addressLine1: '1 Test Street',
        city: 'Test',
        countryCode,
      },
    });
    addressId = address.id;
    ownerToken = await createAccessToken(ownerId);
    otherToken = await createAccessToken(otherId);
  });
  afterAll(async () => {
    await tenant.cleanup();
    await testPrisma.user.deleteMany({
      where: { id: { in: [ownerId, otherId] } },
    });
    await testPrisma.country.deleteMany({ where: { code: countryCode } });
    await testPrisma.$disconnect();
  });

  it.each(reviewCases)(
    'still requires a tenant for review $method $suffix',
    async ({ method, suffix }) => {
      const client = request(app);
      const response = await client[method](
        `/api/v1/products/${productId}/reviews${suffix}`,
      ).set('X-Country-Code', countryCode);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        message: 'Tenant context is required',
        code: 'UNAUTHORIZED',
        data: null,
      });
    },
  );
  it.each(reviewCases.filter(({ method }) => method !== 'get'))(
    'still authenticates protected review $method',
    async ({ method, suffix }) => {
      const client = request(app);
      const response = await client[method](
        `/api/v1/products/${productId}/reviews${suffix}`,
      )
        .set('X-Country-Code', countryCode)
        .set('X-Tenant-Slug', tenant.slug);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        message: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        data: null,
      });
    },
  );
  it.each(['', '/summary'])(
    'keeps public review reads working: %s',
    async (suffix) => {
      const response = await request(app)
        .get(`/api/v1/products/${productId}/reviews${suffix}`)
        .set('X-Country-Code', countryCode)
        .set('X-Tenant-Slug', tenant.slug);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: suffix
          ? { average: 0, count: 0 }
          : { items: [], total: 0, page: 1, limit: 20 },
      });
    },
  );
  it('retains review tenant isolation after route scoping', async () => {
    const otherTenant = catalogTenantFixture();
    try {
      await otherTenant.create();
      const response = await request(app)
        .get(`/api/v1/products/${productId}/reviews`)
        .set('X-Country-Code', countryCode)
        .set('X-Tenant-Slug', otherTenant.slug);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        success: false,
        code: 'PRODUCT_NOT_FOUND',
        data: null,
      });
    } finally {
      await otherTenant.cleanup();
    }
  });
  it('keeps personal addresses authenticated without an unrelated tenant requirement', async () => {
    const unauthenticated = await request(app).get(
      `/api/v1/addresses/${addressId}`,
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe('AUTHENTICATION_REQUIRED');
    const owner = await request(app)
      .get(`/api/v1/addresses/${addressId}`)
      .auth(ownerToken, { type: 'bearer' });
    expect(owner.status).toBe(200);
    expect(owner.body.data).toMatchObject({
      id: addressId,
      country: countryCode,
    });
    const stranger = await request(app)
      .get(`/api/v1/addresses/${addressId}`)
      .auth(otherToken, { type: 'bearer' });
    expect(stranger.status).toBe(404);
    expect(stranger.body).toMatchObject({
      success: false,
      code: 'ADDRESS_NOT_FOUND',
      data: null,
    });
    const list = await request(app)
      .get('/api/v1/addresses')
      .auth(otherToken, { type: 'bearer' });
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });
});
