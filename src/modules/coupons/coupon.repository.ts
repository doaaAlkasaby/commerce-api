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
    data: CreateCouponInput,
  ) {
    return this.prisma.coupon.create({
      data: {
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

  async findById(id: string) {
    return this.prisma.coupon.findUnique({
      where: { id },
    });
  }

  async findByCode(code: string) {
    return this.prisma.coupon.findUnique({
      where: { code },
    });
  }

  async findAll() {
    return this.prisma.coupon.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async update(
    id: string,
    data: UpdateCouponInput,
  ) {
    return this.prisma.coupon.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.coupon.delete({
      where: { id },
    });
  }

  async countUserUsage(
    couponId: string,
    userId: string,
  ): Promise<number> {
    return this.prisma.couponUsage.count({
      where: {
        couponId,
        userId,
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
    couponId: string,
  ) {
    return tx.coupon.update({
      where: {
        id: couponId,
      },
      data: {
        usageCount: {
          increment: 1,
        },
      },
    });
  }
}