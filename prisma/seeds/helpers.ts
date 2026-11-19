import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { assertDevelopmentSeedTarget } from '../../src/config/seed-options.js';

export function assertSeedTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for development seeds');
  assertDevelopmentSeedTarget(process.env.NODE_ENV, url);
}

export async function seedTenant(prisma: PrismaClient, tenantId: string) {
  assertSeedTarget();
  if (!tenantId?.trim()) throw new Error('An explicit tenant ID is required');
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
  });
  if (!tenant.defaultCurrency)
    throw new Error('Configure the tenant currency before seeding');
  return { ...tenant, defaultCurrency: tenant.defaultCurrency };
}

export async function assertTenantProducts(
  prisma: PrismaClient,
  tenantId: string,
  products: Array<{ id: string; tenantId: string }>,
) {
  if (products.some((product) => product.tenantId !== tenantId))
    throw new Error('Seed products must belong to the selected tenant');
  const ids = [...new Set(products.map((product) => product.id))];
  const count = await prisma.product.count({
    where: { tenantId, id: { in: ids } },
  });
  if (count !== ids.length)
    throw new Error('Seed products must belong to the selected tenant');
}

export async function assertTenantCustomers(
  prisma: PrismaClient,
  tenantId: string,
  customers: Array<{ id: string }>,
) {
  const ids = [...new Set(customers.map((customer) => customer.id))];
  const count = await prisma.tenantMember.count({
    where: { tenantId, userId: { in: ids }, status: 'ACTIVE' },
  });
  if (count !== ids.length)
    throw new Error(
      'Seed customers need active membership in the selected tenant',
    );
}

export const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
export const unsplash = (
  photoId: string,
  width: number,
  height: number,
): string =>
  `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${width}&h=${height}&q=80`;
