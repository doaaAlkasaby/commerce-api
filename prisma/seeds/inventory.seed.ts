import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { seedTenant } from './helpers.js';

export async function seedInventory(
  prisma: PrismaClient,
  tenantId: string,
  warehouseId: string,
) {
  await seedTenant(prisma, tenantId);
  await prisma.warehouse.findFirstOrThrow({
    where: { id: warehouseId, tenantId },
  });
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, product: { tenantId } },
  });
  for (const variant of variants) {
    await prisma.inventory.upsert({
      where: { warehouseId_variantId: { warehouseId, variantId: variant.id } },
      // Rerunning fixtures must not erase reservations or replenish sold stock.
      update: {},
      create: {
        tenantId,
        warehouseId,
        variantId: variant.id,
        quantity: 100,
        reservedQuantity: 0,
      },
    });
  }
  return variants;
}
