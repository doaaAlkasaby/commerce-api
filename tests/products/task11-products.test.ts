import { describe, expect, it } from 'vitest';
import { seedTask11Products, linenShirtVariantsDef } from '../../prisma/seeds/task11-products.seed.js';
import { seedTenants } from '../../prisma/seeds/tenants.seed.js';
import { seedCatalog } from '../../prisma/seeds/catalog.seed.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Task 11 Test Products Integration Tests', () => {
  it('1. seedTask11Products creates Product A (Linen Shirt) with 8 sparse variants and 20% discount', async () => {
    await seedTenants(testPrisma);
    await seedCatalog(testPrisma);

    const luma = await testPrisma.tenant.findUnique({ where: { slug: 'dev81-kuwait-fashion' } });
    if (luma) {
      await testPrisma.inventory.deleteMany({
        where: { tenantId: luma.id },
      });
    }

    await seedTask11Products(testPrisma);

    const shirt = await testPrisma.product.findFirstOrThrow({
      where: { slug: 'luma-premium-linen-shirt' },
      include: {
        attributes: { include: { values: true } },
        variants: {
          include: {
            values: {
              include: {
                attributeValue: { include: { attribute: true } },
              },
            },
            inventory: true,
          },
        },
        images: true,
      },
    });

    expect(shirt.name).toBe('Luma Premium Linen Shirt');
    expect(shirt.variants.length).toBe(8); // Exactly 8 sparse variants, not 24

    // Attribute relationships
    expect(shirt.attributes.length).toBe(3);
    const attrNames = shirt.attributes.map((a) => a.name).sort();
    expect(attrNames).toEqual(['Color', 'Fit', 'Size']);

    // Default variant assertion
    const defaultVariant = shirt.variants.find((v) => v.isDefault);
    expect(defaultVariant).toBeDefined();
    expect(defaultVariant?.sku).toBe('LUMA-SHIRT-WHI-M-SLM');

    // Out-of-stock variant assertion
    const outOfStockVariant = shirt.variants.find((v) => v.sku === 'LUMA-SHIRT-NAV-L-SLM');
    expect(outOfStockVariant).toBeDefined();
    expect(outOfStockVariant?.inventory[0].quantity).toBe(0);

    for (const vDef of linenShirtVariantsDef) {
      const v = shirt.variants.find((v) => v.sku === vDef.sku);
      expect(v).toBeDefined();
      expect(Number(v?.price.toString())).toBe(Number(vDef.price));
      expect(v?.discountType).toBe('PERCENTAGE');
      expect(Number(v?.discountValue?.toString())).toBe(20);
      expect(v?.inventory[0].quantity).toBe(vDef.stock);

      // Verify attribute value mapping
      const attrVals = v?.values.map((vv) => vv.attributeValue.value).sort();
      const expectedVals = [vDef.color, vDef.size, vDef.fit].sort();
      expect(attrVals).toEqual(expectedVals);
    }
  }, 30000);

  it('2. seedTask11Products creates Product B (Travel Organizer) with tax category', async () => {
    const organizer = await testPrisma.product.findFirstOrThrow({
      where: { slug: 'luma-leather-travel-organizer' },
      include: {
        variants: { include: { inventory: true } },
        taxCategory: true,
      },
    });

    expect(organizer.name).toBe('Luma Leather Travel Organizer');
    expect(Number(organizer.basePrice.toString())).toBe(30);
    expect(organizer.variants.length).toBe(1);
    expect(organizer.variants[0].inventory[0].quantity).toBe(10);
    expect(organizer.taxCategory).toBeDefined();
    expect(organizer.taxCategory?.code).toBe('STANDARD');
  }, 30000);

  it('3. seedTask11Products is idempotent and preserves modified inventory on repeat runs', async () => {
    const shirtVariant = await testPrisma.productVariant.findFirstOrThrow({
      where: { sku: 'LUMA-SHIRT-WHI-S-SLM' },
      include: { inventory: true },
    });

    const originalQty = shirtVariant.inventory[0].quantity;

    // Simulate inventory consumption / update
    await testPrisma.inventory.update({
      where: { id: shirtVariant.inventory[0].id },
      data: { quantity: 99 },
    });

    // Repeat seed run
    await seedTask11Products(testPrisma);

    const reseededVariant = await testPrisma.productVariant.findFirstOrThrow({
      where: { sku: 'LUMA-SHIRT-WHI-S-SLM' },
      include: { inventory: true },
    });

    // Inventory must remain 99 (preserved)
    expect(reseededVariant.inventory[0].quantity).toBe(99);

    // Reset stock back to original
    await testPrisma.inventory.update({
      where: { id: shirtVariant.inventory[0].id },
      data: { quantity: originalQty },
    });

    // Variant count remains 8
    const shirt = await testPrisma.product.findFirstOrThrow({
      where: { slug: 'luma-premium-linen-shirt' },
      include: { variants: true },
    });
    expect(shirt.variants.length).toBe(8);
  }, 30000);
});
