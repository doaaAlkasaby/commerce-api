import type {
  PrismaClient,
  OrderStatus,
  PaymentStatus,
} from '../../generated/prisma/client.js';

export class OrderRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  private readonly includeRelations = {
    items: {
      orderBy: {
        createdAt: 'asc' as const,
      },
    },

    payments: {
      orderBy: {
        createdAt: 'asc' as const,
      },
    },
  };

  async findById(
    tenantId: string,
    orderId: string,
  ) {
    return this.prisma.order.findUnique({
      where: {
        id: orderId,
        tenantId,
      },

      include:
        this.includeRelations,
    });
  }

  async findByIdForUser(
    tenantId: string,
    orderId: string,
    userId: string,
  ) {
    return this.prisma.order.findFirst({
      where: {
        id: orderId,
        tenantId,
        userId,
      },

      include:
        this.includeRelations,
    });
  }

  async findManyByUserId(
    tenantId: string,
    userId: string,
    page: number,
    limit: number,
    status?: OrderStatus,
    paymentStatus?: PaymentStatus,
  ) {
    const where = {
      tenantId,
      userId,

      ...(status
        ? {
            status,
          }
        : {}),

      ...(paymentStatus
        ? {
            paymentStatus,
          }
        : {}),
    };

    const skip =
      (page - 1) * limit;

    const [orders, totalItems] =
      await Promise.all([
        this.prisma.order.findMany({
          where,

          skip,
          take: limit,

          orderBy: {
            createdAt: 'desc',
          },

          include:
            this.includeRelations,
        }),

        this.prisma.order.count({
          where,
        }),
      ]);

    return {
      orders,
      totalItems,
    };
  }

  async findMany(
    tenantId: string,
    page: number,
    limit: number,
    status?: OrderStatus,
    paymentStatus?: PaymentStatus,
  ) {
    const where = {
      tenantId,
      ...(status
        ? {
            status,
          }
        : {}),

      ...(paymentStatus
        ? {
            paymentStatus,
          }
        : {}),
    };

    const skip =
      (page - 1) * limit;

    const [orders, totalItems] =
      await Promise.all([
        this.prisma.order.findMany({
          where,

          skip,
          take: limit,

          orderBy: {
            createdAt: 'desc',
          },

          include:
            this.includeRelations,
        }),

        this.prisma.order.count({
          where,
        }),
      ]);

    return {
      orders,
      totalItems,
    };
  }

  async updateStatus(
    tenantId: string,
    orderId: string,
    status: OrderStatus,
  ) {
    return this.prisma.order.update({
      where: {
        id: orderId,
        tenantId,
      },

      data: {
        status,
      },

      include:
        this.includeRelations,
    });
  }
}
