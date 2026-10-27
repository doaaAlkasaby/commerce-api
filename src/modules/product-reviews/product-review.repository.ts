import type {
  Prisma,
  PrismaClient,
  ProductReview,
} from '../../generated/prisma/client.js';

export interface ProductRatingSummaryData {
  count: number;
  totalRating: number;
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

export class ProductReviewRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(tenantId: string, reviewId: string): Promise<ProductReview | null> {
    return this.prisma.productReview.findFirst({
      where: { id: reviewId, product: { tenantId } },
    });
  }

  async findByIdWithUser(tenantId: string, reviewId: string) {
    return this.prisma.productReview.findFirst({
      where: { id: reviewId, product: { tenantId } },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async findUserReview(
    tenantId: string,
    productId: string,
    userId: string,
  ): Promise<ProductReview | null> {
    return this.prisma.productReview.findFirst({
      where: { productId, userId, product: { tenantId } },
    });
  }

  async hasPurchasedProduct(
    tenantId: string,
    productId: string,
    userId: string,
  ): Promise<boolean> {
    const orderItem = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: {
          tenantId,
          userId,
          status: {
            in: ['PROCESSING', 'SHIPPED', 'DELIVERED'],
          },
        },
      },
      select: {
        id: true,
      },
    });

    return orderItem !== null;
  }

  async create(
    tenantId: string,
    data: Prisma.ProductReviewUncheckedCreateInput,
  ): Promise<ProductReview> {
    const product = await this.prisma.product.findFirst({ where: { id: data.productId, tenantId }, select: { id: true } });
    if (!product) throw new Error('Product does not belong to this tenant');
    return this.prisma.productReview.create({
      data,
    });
  }

  async update(
    tenantId: string,
    reviewId: string,
    data: Prisma.ProductReviewUpdateInput,
  ): Promise<ProductReview> {
    return this.prisma.productReview.update({
      where: {
        id: reviewId,
        product: { tenantId },
      },
      data,
    });
  }

  async delete(tenantId: string, reviewId: string): Promise<ProductReview> {
    return this.prisma.productReview.delete({
      where: {
        id: reviewId,
        product: { tenantId },
      },
    });
  }

  async findProductReviews(tenantId: string, productId: string, skip: number, take: number) {
    return this.prisma.productReview.findMany({
      where: {
        productId,
        product: { tenantId },
        isApproved: true,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'asc',
        },
      ],
      skip,
      take,
    });
  }

  async countProductReviews(tenantId: string, productId: string): Promise<number> {
    return this.prisma.productReview.count({
      where: {
        productId,
        product: { tenantId },
        isApproved: true,
      },
    });
  }

  async getRatingSummary(tenantId: string, productId: string): Promise<ProductRatingSummaryData> {
    const [aggregate, distributionRows] = await Promise.all([
      this.prisma.productReview.aggregate({
        where: {
          productId,
          product: { tenantId },
          isApproved: true,
        },
        _count: {
          _all: true,
        },
        _sum: {
          rating: true,
        },
      }),

      this.prisma.productReview.groupBy({
        by: ['rating'],
        where: {
          productId,
          product: { tenantId },
          isApproved: true,
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const distribution: ProductRatingSummaryData['distribution'] = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    for (const row of distributionRows) {
      switch (row.rating) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          distribution[row.rating] = row._count._all;
          break;
      }
    }

    return {
      count: aggregate._count._all,
      totalRating: aggregate._sum.rating ?? 0,
      distribution,
    };
  }

  async getRatingSummaries(
  tenantId: string,
  productIds: string[],
): Promise<ProductRatingSummaryItem[]> {
  if (productIds.length === 0) {
    return [];
  }

  const rows = await this.prisma.productReview.groupBy({
    by: ['productId'],
    where: {
      productId: {
        in: productIds,
      },
      product: { tenantId },
      isApproved: true,
    },
    _count: {
      _all: true,
    },
    _avg: {
      rating: true,
    },
  });

  return rows.map((row) => ({
    productId: row.productId,
    count: row._count._all,
    average: row._avg.rating ?? 0,
  }));
}
  
}


export interface ProductRatingSummaryItem {
  productId: string;
  count: number;
  average: number;
}
