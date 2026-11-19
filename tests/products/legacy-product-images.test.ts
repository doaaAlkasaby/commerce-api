import { describe, expect, it } from 'vitest';
import { updateLegacyProductImages, legacyProductImageUpdates } from '../../prisma/seeds/legacy-product-images.seed.js';
import { seedTenants } from '../../prisma/seeds/tenants.seed.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Legacy Product Images Update Integration Tests', () => {
  it('1. updateLegacyProductImages updates all 12 target ProductImage URLs', async () => {
    await seedTenants(testPrisma);
    await updateLegacyProductImages(testPrisma);

    for (const u of legacyProductImageUpdates) {
      const primary = await testPrisma.productImage.findUniqueOrThrow({ where: { id: u.primaryImageId } });
      const secondary = await testPrisma.productImage.findUniqueOrThrow({ where: { id: u.secondaryImageId } });

      expect(primary.url).toBe(u.newPrimaryUrl);
      expect(secondary.url).toBe(u.newSecondaryUrl);
    }
  }, 30000);
});
