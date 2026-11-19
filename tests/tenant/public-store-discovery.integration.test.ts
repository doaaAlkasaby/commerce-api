import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      DATABASE_URL: actual.env.TEST_DATABASE_URL,
    },
  };
});

import app from '../../src/app.js';
import { testPrisma } from '../../src/config/test-database.js';
import { deleteFixtureTenants } from '../helpers/warehouse.js';

describe('Public Store Discovery API Integration Tests (GET /api/v1/storefront/tenants)', () => {
  let publicTenantId1: string;
  let privateTenantId: string;
  let suspendedTenantId: string;
  let noCurrencyTenantId: string;
  let slug1: string;
  let privateSlug: string;

  beforeAll(async () => {
    const fixture1 = `pub-disc-1-${randomUUID()}`;
    const fixture2 = `pub-disc-2-${randomUUID()}`;
    const fixture3 = `pub-disc-3-${randomUUID()}`;
    const fixture4 = `pub-disc-4-${randomUUID()}`;

    slug1 = fixture1;
    privateSlug = fixture2;

    const t1 = await testPrisma.tenant.create({
      data: {
        name: 'Alfa Public Store',
        slug: slug1,
        code: fixture1,
        status: 'ACTIVE',
        isPubliclyListed: true,
        defaultCurrency: 'KWD',
        logoUrl: '/uploads/logos/luma.svg',
      },
    });
    publicTenantId1 = t1.id;

    const t2 = await testPrisma.tenant.create({
      data: {
        name: 'Velo Sports Private',
        slug: privateSlug,
        code: fixture2,
        status: 'ACTIVE',
        isPubliclyListed: false,
        defaultCurrency: 'KWD',
        logoUrl: '/uploads/logos/velo.svg',
      },
    });
    privateTenantId = t2.id;

    const t3 = await testPrisma.tenant.create({
      data: {
        name: 'Suspended Public Store',
        slug: fixture3,
        code: fixture3,
        status: 'SUSPENDED',
        isPubliclyListed: true,
        defaultCurrency: 'KWD',
      },
    });
    suspendedTenantId = t3.id;

    const t4 = await testPrisma.tenant.create({
      data: {
        name: 'No Currency Public Store',
        slug: fixture4,
        code: fixture4,
        status: 'ACTIVE',
        isPubliclyListed: true,
        defaultCurrency: null,
      },
    });
    noCurrencyTenantId = t4.id;
  });

  afterAll(async () => {
    const ids = [publicTenantId1, privateTenantId, suspendedTenantId, noCurrencyTenantId].filter(Boolean);
    if (ids.length > 0) {
      await deleteFixtureTenants({
        where: { id: { in: ids } },
      });
    }
  });

  it('1. GET /api/v1/storefront/tenants is public (no Authorization or X-Tenant-Slug required)', async () => {
    const res = await request(app)
      .get('/api/v1/storefront/tenants');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const store1 = res.body.data.find((s: any) => s.slug === slug1);
    expect(store1).toBeDefined();
    expect(store1.id).toBe(publicTenantId1);
    expect(store1.name).toBe('Alfa Public Store');
    expect(store1.currency).toBe('KWD');
    expect(store1.logoUrl).toBe('/uploads/logos/luma.svg');
  });

  it('2. Excludes private active stores, suspended stores, and stores without defaultCurrency', async () => {
    const res = await request(app)
      .get('/api/v1/storefront/tenants');

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: any) => s.id);
    expect(ids).contains(publicTenantId1);
    expect(ids).not.contains(privateTenantId);
    expect(ids).not.contains(suspendedTenantId);
    expect(ids).not.contains(noCurrencyTenantId);
  });

  it('3. Returned objects contain ONLY strict public DTO fields (no private settings or membership data)', async () => {
    const res = await request(app)
      .get('/api/v1/storefront/tenants');

    expect(res.status).toBe(200);
    for (const store of res.body.data) {
      expect(store.id).toBeDefined();
      expect(store.slug).toBeDefined();
      expect(store.name).toBeDefined();
      expect(store.currency).toBeDefined();
      expect(store.members).toBeUndefined();
      expect(store.settings).toBeUndefined();
      expect(store.secret).toBeUndefined();
    }
  });

  it('4. Existing GET /api/v1/storefront route is unaffected', async () => {
    const res = await request(app)
      .get('/api/v1/storefront')
      .set('X-Tenant-Slug', slug1);

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe(slug1);
    expect(res.body.data.name).toBe('Alfa Public Store');
  });

  it('5. White-label private stores (isPubliclyListed=false) remain accessible when X-Tenant-Slug is provided directly', async () => {
    const res = await request(app)
      .get('/api/v1/storefront')
      .set('X-Tenant-Slug', privateSlug);

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe(privateSlug);
    expect(res.body.data.name).toBe('Velo Sports Private');
  });
});
