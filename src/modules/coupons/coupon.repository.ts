import type {
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';

import type {
  CreateCouponInput,
  UpdateCouponInput,
} from './coupon.types.js';

type PrismaTransaction =
  Prisma.TransactionClient;

export class CouponRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async transaction<T>(
    callback: (
      tx: PrismaTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => callback(tx),
    );
  }

  async create(
    tenantId: string,
    data: CreateCouponInput,
  ) {
    return this.prisma.coupon.create({
      data: {
        tenantId,
        code: data.code,

        discountType:
          data.discountType,

        discountValue:
          data.discountValue,

        minimumOrderAmount:
          data.minimumOrderAmount ?? null,

        maximumDiscountAmount:
          data.maximumDiscountAmount ?? null,

        startsAt:
          data.startsAt ?? null,

        endsAt:
          data.endsAt ?? null,

        usageLimit:
          data.usageLimit ?? null,

        perUserLimit:
          data.perUserLimit ?? null,

        isActive:
          data.isActive ?? true,
      },
    });
  }

  async findById(tenantId: string, id: string) {
    return this.prisma.coupon.findUnique({
      where: { id, tenantId },
    });
  }

  async findByCode(tenantId: string, code: string) {
    return this.prisma.coupon.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.coupon.findMany({
      where: { tenantId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateCouponInput,
  ) {
    return this.prisma.coupon.update({
      where: { id, tenantId },
      data,
    });
  }

  async delete(tenantId: string, id: string) {
    return this.prisma.coupon.deleteMany({
      where: { id, tenantId },
    });
  }

  async countUserUsage(
    tenantId: string,
    couponId: string,
    userId: string,
  ): Promise<number> {
    return this.prisma.couponUsage.count({
      where: {
        couponId,
        userId,
        coupon: { tenantId },
      },
    });
  }

  async createUsage(
    tx: PrismaTransaction,
    data: {
      couponId: string;
      userId: string;
      orderId: string;
    },
  ) {
    return tx.couponUsage.create({
      data,
    });
  }

  async incrementUsageCount(
    tx: PrismaTransaction,
    tenantId: string,
    couponId: string,
  ) {
    return tx.coupon.update({
      where: {
        id: couponId,
        tenantId,
      },
      data: {
        usageCount: {
          increment: 1,
        },
      },
    });
  }
}
