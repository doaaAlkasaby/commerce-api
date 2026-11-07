import type { Prisma } from '../../src/generated/prisma/client.js';
import { testPrisma } from '../../src/config/test-database.js';

export async function fixtureWarehouse(tenantId: string) {
  const previous = await testPrisma.warehouse.findFirst({
    where: { tenantId, isDefault: true },
  });
  if (previous) return previous;
  const country =
    (await testPrisma.country.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    })) ??
    (await testPrisma.country.upsert({
      where: { code: 'QW' },
      update: {},
      create: {
        code: 'QW',
        name: 'Warehouse fixture country',
        currencyCode: 'USD',
      },
    }));
  const warehouse = await testPrisma.warehouse.upsert({
    where: { tenantId_code: { tenantId, code: 'fixture-default' } },
    update: {},
    create: {
      tenantId,
      code: 'fixture-default',
      name: 'Fixture stock source',
      countryCode: country.code,
      city: 'Fixture city',
      address: 'Fixture address',
      isDefault: true,
    },
  });
  const destinations = await testPrisma.country.findMany({
    where: { isActive: true },
    select: { code: true },
  });
  await testPrisma.warehouseCoverage.createMany({
    data: destinations.map((destination) => ({
      tenantId,
      warehouseId: warehouse.id,
      countryCode: destination.code,
    })),
    skipDuplicates: true,
  });
  return warehouse;
}

type Stock = Omit<
  Prisma.InventoryUncheckedCreateInput,
  'tenantId' | 'warehouseId'
> & { tenantId?: string; warehouseId?: string };
export async function createInventoryFixture({ data }: { data: Stock }) {
  const variant = await testPrisma.productVariant.findUniqueOrThrow({
    where: { id: data.variantId },
    include: { product: true },
  });
  const warehouse = await fixtureWarehouse(variant.product.tenantId);
  return testPrisma.inventory.create({
    data: {
      ...data,
      tenantId: variant.product.tenantId,
      warehouseId: data.warehouseId ?? warehouse.id,
    },
  });
}

export async function deleteFixtureTenant(args: Prisma.TenantDeleteArgs) {
  await testPrisma.inventory.deleteMany({
    where: { warehouse: { tenant: args.where } },
  });
  await testPrisma.warehouse.deleteMany({ where: { tenant: args.where } });
  return testPrisma.tenant.delete(args);
}
export async function deleteFixtureTenants(args: Prisma.TenantDeleteManyArgs) {
  await testPrisma.inventory.deleteMany({
    where: { warehouse: { tenant: args.where ?? {} } },
  });
  await testPrisma.warehouse.deleteMany({
    where: { tenant: args.where ?? {} },
  });
  return testPrisma.tenant.deleteMany(args);
}

export async function createCartFixture(args: {
  data: Prisma.CartUncheckedCreateInput;
}) {
  await ensureFixtureMembership(args.data.tenantId, args.data.userId);
  return testPrisma.cart.create(args);
}

export function ensureFixtureMembership(tenantId: string, userId: string) {
  return testPrisma.tenantMember.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    update: {},
    create: { tenantId, userId, role: 'CUSTOMER' },
  });
}

export async function createShippingProfileFixture(args: {
  data: Prisma.ShippingProfileUncheckedCreateInput;
}) {
  const profile = await testPrisma.shippingProfile.create(args);
  const warehouse = await fixtureWarehouse(profile.tenantId);
  await testPrisma.warehouse.update({
    where: { id: warehouse.id },
    data: {
      latitude: profile.originLatitude,
      longitude: profile.originLongitude,
    },
  });
  await testPrisma.warehouseCoverage.upsert({
    where: {
      warehouseId_countryCode: {
        warehouseId: warehouse.id,
        countryCode: profile.countryCode,
      },
    },
    create: {
      tenantId: profile.tenantId,
      warehouseId: warehouse.id,
      countryCode: profile.countryCode,
    },
    update: {},
  });
  return profile;
}
