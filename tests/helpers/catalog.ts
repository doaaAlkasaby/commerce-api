import { deleteFixtureTenants } from './warehouse.js';
import { randomUUID } from 'node:crypto';
import { testPrisma } from '../../src/config/test-database.js';

export function catalogTenantFixture() {
  const id = randomUUID();
  const slug = `catalog-${id}`;
  return {
    id,
    slug,
    async create() {
      return testPrisma.tenant.create({
        data: {
          id,
          name: 'Catalog test',
          slug,
          code: `CAT_${id}`,
          defaultCurrency: 'USD',
        },
      });
    },
    async cleanup() {
      // Parent relations use RESTRICT, so remove children before their tenant.
      await testPrisma.product.deleteMany({ where: { tenantId: id } });
      await testPrisma.category.deleteMany({ where: { tenantId: id } });
      await testPrisma.brand.deleteMany({ where: { tenantId: id } });
      await deleteFixtureTenants({ where: { id } });
    },
  };
}

// The legacy catalog seeds use fixed tenant IDs. Only remove tenants that did
// not exist before this suite took ownership of the seed fixtures.
export function guardCatalogSeedFixtures(tenantIds: string[]) {
  let createdTenantIds: string[] = [];
  return {
    async capture() {
      const existing = await testPrisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map(({ id }) => id));
      createdTenantIds = tenantIds.filter((id) => !existingIds.has(id));
    },
    async cleanup() {
      if (createdTenantIds.length === 0) return;
      const tenantId = { in: createdTenantIds };
      await testPrisma.product.deleteMany({ where: { tenantId } });
      await deleteFixtureTenants({ where: { id: tenantId } });
    },
  };
}
