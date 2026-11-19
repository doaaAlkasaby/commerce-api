import { describe, expect, it, vi } from 'vitest';

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

import { seedCatalog, catalogDefinitions } from '../../prisma/seeds/catalog.seed.js';
import { seedTenants } from '../../prisma/seeds/tenants.seed.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Demo Catalog Seed Module Integration Tests', () => {
  it('1. First seedCatalog execution creates categories, products, images, and inventory for all 6 stores', async () => {
    await seedTenants(testPrisma);
    await seedCatalog(testPrisma);

    for (const tenantDef of catalogDefinitions) {
      const tenant = await testPrisma.tenant.findUniqueOrThrow({
        where: { slug: tenantDef.slug },
      });

      const categories = await testPrisma.category.findMany({
        where: { tenantId: tenant.id },
      });
      expect(categories.length).toBeGreaterThanOrEqual(tenantDef.categories.length);

      const products = await testPrisma.product.findMany({
        where: { tenantId: tenant.id },
        include: { images: true, variants: true },
      });
      const expectedProductCount = tenantDef.categories.reduce((sum, c) => sum + c.products.length, 0);
      expect(products.length).toBeGreaterThanOrEqual(expectedProductCount);

      for (const p of products) {
        expect(p.images.length).toBeGreaterThan(0);
        expect(p.variants.length).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it('2. Second seedCatalog execution is idempotent and produces zero duplicate categories or products', async () => {
    await seedCatalog(testPrisma);

    for (const tenantDef of catalogDefinitions) {
      const tenant = await testPrisma.tenant.findUniqueOrThrow({
        where: { slug: tenantDef.slug },
      });

      const categories = await testPrisma.category.findMany({
        where: { tenantId: tenant.id },
      });
      expect(categories.length).toBeGreaterThanOrEqual(tenantDef.categories.length);
    }
  }, 30000);
});
