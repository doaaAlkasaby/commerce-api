import type { PrismaClient } from '../../generated/prisma/client.js';

export class CheckoutRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ) {
    return this.prisma.checkoutRequest.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey,
        },
      },
      include: {
        order: {
          include: {
            items: true,
            payments: true,
          },
        },
      },
    });
  }

  async createRequest(
    userId: string,
    idempotencyKey: string,
    orderId: string,
  ) {
    return this.prisma.checkoutRequest.create({
      data: {
        userId,
        idempotencyKey,
        orderId,
      },
    });
  }

  async updateOrderId(
    id: string,
    orderId: string,
  ) {
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