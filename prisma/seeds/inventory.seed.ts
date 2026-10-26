
import {
  PrismaClient,
} from '../../src/generated/prisma/client.js';



// ============================================================
// Inventory
// ============================================================

export  async function seedInventory(prisma: PrismaClient,) {
  console.log('📦 Seeding inventory...');

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
    },
  });

  for (const variant of variants) {
    await prisma.inventory.upsert({
      where: {
        variantId: variant.id,
      },
      update: {
        quantity: 100,
        reservedQuantity: 0,
      },
      create: {
        variantId: variant.id,
        quantity: 100,
        reservedQuantity: 0,
      },
    });
  }

  console.log(`   ✓ ${variants.length} inventory records`);

  return variants;
}