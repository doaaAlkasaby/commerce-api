import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  databaseConfigurationSchema,
  databasePoolConfig,
} from '../../src/config/database-options.js';
import {
  developmentSeedSettings,
  DevelopmentSeedError,
} from '../../src/config/development-seed-options.js';
import { developmentId, developmentStores, seedDevelopment } from './seed.js';
import {
  verifyDevelopmentAssets,
  verifyDevelopmentVisuals,
} from './visuals.js';

export async function verifyDevelopmentSeed(db: PrismaClient) {
  const stores = [];
  for (const store of developmentStores) {
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: developmentId(`tenant:${store.key}`) },
      include: {
        shippingProfiles: true,
        taxProfiles: true,
        warehouses: { include: { coverage: true, inventory: true } },
        orderPolicy: true,
      },
    });
    if (
      tenant.defaultCurrency !== store.currency ||
      tenant.shippingProfiles.some(
        (profile) => profile.currency !== store.currency || !profile.isActive,
      ) ||
      tenant.taxProfiles.some(
        (profile) => profile.currency !== store.currency || !profile.isActive,
      ) ||
      !tenant.orderPolicy ||
      tenant.warehouses.length !== (store.key === 'fashion' ? 2 : 1) ||
      tenant.warehouses.some(
        (warehouse) =>
          !warehouse.coverage.length ||
          !warehouse.inventory.length ||
          warehouse.inventory.some(
            (stock) => stock.quantity < stock.reservedQuantity,
          ),
      )
    )
      throw new DevelopmentSeedError(
        'Development fixture configuration needs review',
      );
    stores.push({
      slug: tenant.slug,
      currency: tenant.defaultCurrency,
      warehouses: tenant.warehouses.length,
      inventoryRows: tenant.warehouses.reduce(
        (sum, warehouse) => sum + warehouse.inventory.length,
        0,
      ),
    });
  }
  return { stores };
}

export async function runDevelopmentSeed(
  target: 'development' | 'test',
  verifyOnly = false,
) {
  let db: PrismaClient | undefined;
  try {
    const settings = developmentSeedSettings(process.env, target);
    await verifyDevelopmentAssets();
    const config = databaseConfigurationSchema.parse({
      ...process.env,
      DATABASE_URL: settings.url,
    });
    db = new PrismaClient({
      adapter: new PrismaPg(databasePoolConfig(settings.url, config), {
        schema: new URL(settings.url).searchParams.get('schema') ?? 'public',
      }),
    });
    const [migration] = await db.$queryRaw<
      Array<{ ready: boolean }>
    >`SELECT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name"='20261107190000_tenant_order_policy' AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS ready`;
    if (!migration?.ready)
      throw new DevelopmentSeedError(
        'Deploy the complete migration history before seeding',
      );
    if (!verifyOnly) await seedDevelopment(db, settings.password);
    console.log(
      JSON.stringify({
        operation: verifyOnly
          ? 'development-seed-verification'
          : 'development-seed',
        ...(await verifyDevelopmentSeed(db)),
        visuals: await verifyDevelopmentVisuals(db),
      }),
    );
  } catch (error) {
    console.error(
      error instanceof DevelopmentSeedError
        ? error.message
        : 'Development seed failed; check target approval, migration state and namespace ownership. Credentials are never printed.',
    );
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
