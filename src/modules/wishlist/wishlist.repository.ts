import type { PrismaClient } from '../../generated/prisma/client.js';

export class WishlistRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findByUserId(tenantId: string, userId: string) {
    return this.prisma.wishlist.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
    });
  }

  async createForUser(tenantId: string, userId: string) {
    return this.prisma.wishlist.create({
      data: {
        tenantId,
        userId,
      },
    });
  }

  async findOrCreateForUser(tenantId: string, userId: string) {
    return this.prisma.wishlist.upsert({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      create: {
        tenantId,
        userId,
      },
      update: {},
    });
  }

  async findItems(tenantId: string, wishlistId: string) {
    return this.prisma.wishlistItem.findMany({
      where: {
        wishlistId,
        wishlist: { tenantId },
        product: { tenantId },
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
    tenantId: string,
    wishlistId: string,
    productId: string,
  ) {
    return this.prisma.wishlistItem.findFirst({
      where: { wishlistId, productId, wishlist: { tenantId }, product: { tenantId } },
    });
  }

  async addItem(
    tenantId: string,
    wishlistId: string,
    productId: string,
  ) {
    const [wishlist, product] = await Promise.all([
      this.prisma.wishlist.findFirst({ where: { id: wishlistId, tenantId }, select: { id: true } }),
      this.prisma.product.findFirst({ where: { id: productId, tenantId }, select: { id: true } }),
    ]);
    if (!wishlist || !product) throw new Error('Wishlist or product does not belong to this tenant');
    return this.prisma.wishlistItem.create({
      data: {
        wishlistId,
        productId,
      },
    });
  }

  async removeItem(
    tenantId: string,
    wishlistId: string,
    productId: string,
  ) {
    return this.prisma.wishlistItem.deleteMany({
      where: { wishlistId, productId, wishlist: { tenantId }, product: { tenantId } },
    });
  }

  async findProduct(tenantId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
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
  tenantId: string,
  userId: string,
  productIds: string[],
): Promise<string[]> {
  if (productIds.length === 0) {
    return [];
  }

  const items = await this.prisma.wishlistItem.findMany({
    where: {
      wishlist: {
        tenantId,
        userId,
      },
      product: { tenantId },
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
