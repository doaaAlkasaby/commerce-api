import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
export class OrderPolicyRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}
  find(tenantId: string) {
    return this.db.tenantOrderPolicy.findUnique({ where: { tenantId } });
  }
  tenant(tenantId: string) {
    return this.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultCurrency: true },
    });
  }
  async lock(tenantId: string) {
    await this.db
      .$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
  }
  save(tenantId: string, data: Prisma.TenantOrderPolicyUncheckedUpdateInput) {
    return this.db.tenantOrderPolicy
      .upsert({ where: { tenantId }, create: { tenantId }, update: {} })
      .then(() =>
        this.db.tenantOrderPolicy.update({ where: { tenantId }, data }),
      );
  }
}
