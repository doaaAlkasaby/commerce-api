import type { Prisma } from '../../generated/prisma/client.js';

export class AllocationRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  candidates(tenantId: string, countryCode: string, variantIds: string[]) {
    return this.db.warehouse.findMany({
      where: {
        tenantId,
        isActive: true,
        coverage: { some: { tenantId, countryCode } },
      },
      include: {
        inventory: { where: { tenantId, variantId: { in: variantIds } } },
      },
      orderBy: [{ priority: 'asc' }, { code: 'asc' }],
    });
  }
}
