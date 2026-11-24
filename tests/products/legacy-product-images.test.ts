import { guardCatalogSeedFixtures } from '../helpers/catalog.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateLegacyProductImages, legacyProductImageUpdates } from '../../prisma/seeds/legacy-product-images.seed.js';
import { developmentId, seedTenants, tenantFixtures } from '../../prisma/seeds/tenants.seed.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Legacy Product Images Update Integration Tests', () => {
  const fixtures = guardCatalogSeedFixtures(
    tenantFixtures.map(({ key }) => developmentId(`tenant:${key}`)),
  );
  beforeAll(fixtures.capture);
  afterAll(fixtures.cleanup);

  it('1. updateLegacyProductImages updates all 12 target ProductImage URLs', async () => {
    await seedTenants(testPrisma);
    const categories = await Promise.all(
      ['dev81-kuwait-fashion', 'dev81-independent'].map(async (slug) => {
        const tenant = await testPrisma.tenant.findUniqueOrThrow({
          where: { slug },
        });
        return testPrisma.category.create({
          data: {
            tenantId: tenant.id,
            name: 'Legacy image fixture',
            slug: 'legacy-image-fixture',
          },
        });
      }),
    );
    for (const [index, update] of legacyProductImageUpdates.entries()) {
      const category = categories[index < 3 ? 0 : 1]!;
      await testPrisma.product.create({
        data: {
          id: update.productId,
          tenantId: category.tenantId,
          categoryId: category.id,
          name: 'Legacy product fixture',
          slug: `legacy-image-fixture-${index}`,
          basePrice: '10',
          images: {
            create: [update.primaryImageId, update.secondaryImageId].map((id) => ({
              id,
              url: `/uploads/fixture/${id}.webp`,
              storageKey: `fixture/${id}.webp`,
            })),
          },
        },
      });
    }
    await updateLegacyProductImages(testPrisma);

    for (const u of legacyProductImageUpdates) {
      const primary = await testPrisma.productImage.findUniqueOrThrow({ where: { id: u.primaryImageId } });
      const secondary = await testPrisma.productImage.findUniqueOrThrow({ where: { id: u.secondaryImageId } });

      expect(primary.url).toBe(u.newPrimaryUrl);
      expect(secondary.url).toBe(u.newSecondaryUrl);
    }
  }, 30000);
});
