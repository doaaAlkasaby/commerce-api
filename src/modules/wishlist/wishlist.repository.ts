import type { PrismaClient } from '../../generated/prisma/client.js';

export class WishlistRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findByUserId(userId: string) {
    return this.prisma.wishlist.findUnique({
      where: {
        userId,
      },
    });
  }

  async createForUser(userId: string) {
    return this.prisma.wishlist.create({
      data: {
        userId,
      },
    });
  }

  async findOrCreateForUser(userId: string) {
    return this.prisma.wishlist.upsert({
      where: {
        userId,
      },
      create: {
        userId,
      },
      update: {},
    });
  }

  async findItems(wishlistId: string) {
    return this.prisma.wishlistItem.findMany({
      where: {
        wishlistId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        product: {
          include: {
            images: {
              orderBy: {
                sortOrder: 'asc',
              },
            },
            category: true,
            brand: true,
          },
        },
      },
    });
  }

  async findItem(
    wishlistId: string,
    productId: string,
  ) {
    return this.prisma.wishlistItem.findUnique({
      where: {
        wishlistId_productId: {
          wishlistId,
          productId,
        },
      },
    });
  }

  async addItem(
    wishlistId: string,
    productId: string,
  ) {
    return this.prisma.wishlistItem.create({
      data: {
        wishlistId,
        productId,
      },
    });
  }

  async removeItem(
    wishlistId: string,
    productId: string,
  ) {
    return this.prisma.wishlistItem.delete({
      where: {
        wishlistId_productId: {
          wishlistId,
          productId,
        },
      },
    });
  }

  async findProduct(productId: string) {
    return this.prisma.product.findUnique({
      where: {
        id: productId,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
      },
    });
  }

  async findProductIdsByUser(
  userId: string,
  productIds: string[],
): Promise<string[]> {
  if (productIds.length === 0) {
    return [];
  }

  const items = await this.prisma.wishlistItem.findMany({
    where: {
      wishlist: {
        userId,
      },
      productId: {
        in: productIds,
      },
    },
    select: {
      productId: true,
    },
  });

  return items.map((item) => item.productId);
}

}