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
