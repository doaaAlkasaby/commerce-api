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
    orderId: string,
  ) {
    return this.prisma.order.findUnique({
      where: {
        id: orderId,
      },

      include:
        this.includeRelations,
    });
  }

  async findByIdForUser(
    orderId: string,
    userId: string,
  ) {
    return this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },

      include:
        this.includeRelations,
    });
  }

  async findManyByUserId(
    userId: string,
    page: number,
    limit: number,
    status?: OrderStatus,
    paymentStatus?: PaymentStatus,
  ) {
    const where = {
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
    page: number,
    limit: number,
    status?: OrderStatus,
    paymentStatus?: PaymentStatus,
  ) {
    const where = {
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
    orderId: string,
    status: OrderStatus,
  ) {
    return this.prisma.order.update({
      where: {
        id: orderId,
      },

      data: {
        status,
      },

      include:
        this.includeRelations,
    });
  }
}