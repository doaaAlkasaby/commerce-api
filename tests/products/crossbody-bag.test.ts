import { guardCatalogSeedFixtures } from '../helpers/catalog.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCrossbodyBag, crossbodyVariantsDef } from '../../prisma/seeds/crossbody-bag.seed.js';
import { developmentId, seedTenants, tenantFixtures } from '../../prisma/seeds/tenants.seed.js';
import { seedCatalog } from '../../prisma/seeds/catalog.seed.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Luma Crossbody Bag Multi-Variant Product Integration Tests', () => {
  const fixtures = guardCatalogSeedFixtures(
    tenantFixtures.map(({ key }) => developmentId(`tenant:${key}`)),
  );
  beforeAll(fixtures.capture);
  afterAll(fixtures.cleanup);

  it('1. seedCrossbodyBag creates Luma Signature Crossbody Bag with 12 variants and 29 images', async () => {
    await seedTenants(testPrisma);
    await seedCatalog(testPrisma);
    await seedCrossbodyBag(testPrisma);

    const product = await testPrisma.product.findFirstOrThrow({
      where: { slug: 'luma-signature-crossbody-bag' },
      include: {
        variants: {
          include: {
            values: {
              include: {
                attributeValue: {
                  include: { attribute: true },
                },
              },
            },
            inventory: true,
            images: true,
          },
        },
        images: true,
      },
    });

    expect(product.name).toBe('Luma Signature Crossbody Bag');
    expect(product.variants.length).toBe(12);
    expect(product.images).toHaveLength(5);
    expect(product.variants.flatMap((variant) => variant.images)).toHaveLength(24);

    for (const vDef of crossbodyVariantsDef) {
      const foundVar = product.variants.find((v) => v.sku === vDef.sku);
      expect(foundVar).toBeDefined();
      expect(foundVar?.price?.toFixed(3)).toBe(vDef.price);
      expect(foundVar?.values.length).toBe(3);
      expect(foundVar?.images.map(({ url }) => url).sort()).toEqual([
        `/uploads/products/luma-crossbody-bag-${vDef.imgSuffix}-1.webp`,
        `/uploads/products/luma-crossbody-bag-${vDef.imgSuffix}-2.webp`,
      ]);
      expect(foundVar?.inventory[0].quantity).toBe(10);
    }
  }, 30000);
});
