import type { Prisma } from '../../generated/prisma/client.js';

export class CustomerEnrollmentRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async lockActiveTenant(tenantId: string) {
    const rows = await this.db.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} AND "status"='ACTIVE' FOR SHARE`;
    return rows.length === 1;
  }
  async lockActiveUser(userId: string) {
    const rows = await this.db.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "User" WHERE "id"=${userId} AND "isActive" FOR SHARE`;
    return rows.length === 1;
  }
  createCustomer(tenantId: string, userId: string) {
    return this.db.tenantMember.createMany({
      data: [{ tenantId, userId, role: 'CUSTOMER', status: 'ACTIVE' }],
      skipDuplicates: true,
    });
  }
  membership(tenantId: string, userId: string) {
    return this.db.tenantMember.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId } },
    });
  }
}
