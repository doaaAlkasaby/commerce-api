import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export class CheckoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
