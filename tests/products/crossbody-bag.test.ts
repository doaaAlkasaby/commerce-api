import { describe, expect, it } from 'vitest';
import { seedCrossbodyBag, crossbodyVariantsDef } from '../../prisma/seeds/crossbody-bag.seed.js';
import { seedTenants } from '../../prisma/seeds/tenants.seed.js';
import { seedCatalog } from '../../prisma/seeds/catalog.seed.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Luma Crossbody Bag Multi-Variant Product Integration Tests', () => {
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
          },
        },
        images: true,
      },
    });

    expect(product.name).toBe('Luma Signature Crossbody Bag');
    expect(product.variants.length).toBe(12);
    expect(product.images.length).toBeGreaterThanOrEqual(29);

    for (const vDef of crossbodyVariantsDef) {
      const foundVar = product.variants.find((v) => v.sku === vDef.sku);
      expect(foundVar).toBeDefined();
      expect(foundVar?.price.toString()).toBe(vDef.price);
      expect(foundVar?.values.length).toBe(3);
      expect(foundVar?.inventory[0].quantity).toBe(10);
    }
  }, 30000);
});
