import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export class CheckoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  membership(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
    return tx.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
  }

  async lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR SHARE`;
  }

  async lockWarehouse(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "Warehouse" WHERE "id"=${warehouseId} AND "tenantId"=${tenantId} AND "isActive" FOR SHARE`;
    return rows.length === 1;
  }

  ownedAddress(userId: string, id: string) {
    return this.prisma.address.findFirst({ where: { id, userId } });
  }

  async reservationDeadline(
    tx: Prisma.TransactionClient,
    ttlSeconds: number,
  ): Promise<Date> {
    const [row] = await tx.$queryRaw<Array<{ deadline: Date }>>`
      SELECT CURRENT_TIMESTAMP + ${ttlSeconds} * interval '1 second' AS deadline
    `;
    if (!row) throw new Error('Database time is unavailable');
    return row.deadline;
  }

  async tryLockRequest(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    key: string,
  ) {
    const scope = JSON.stringify([tenantId, userId, key]);
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${scope}, 0)) AS acquired
    `;
    return rows[0]?.acquired === true;
  }

  async findByIdempotencyKey(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    idempotencyKey: string,
  ) {
    return tx.checkoutRequest.findFirst({
      where: {
        userId,
        idempotencyKey,
        OR: [{ tenantId }, { tenantId: null, order: { tenantId, userId } }],
      },
      include: {
        order: {
          include: {
            items: true,
            payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          },
        },
      },
    });
  }

  async createRequest(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      requestFingerprint: string;
      userId: string;
      idempotencyKey: string;
      orderId: string;
    },
  ) {
    return tx.checkoutRequest.create({
      data: {
        tenantId: input.tenantId,
        requestFingerprint: input.requestFingerprint,
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        orderId: input.orderId,
      },
    });
  }

  async updateOrderId(id: string, orderId: string) {
    return this.prisma.checkoutRequest.update({
      where: {
        id,
      },
      data: {
        orderId,
      },
    });
  }
}
