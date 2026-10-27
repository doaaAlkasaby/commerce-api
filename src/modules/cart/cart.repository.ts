import type {
  PrismaClient,
} from '../../generated/prisma/client.js';

export class CartRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findByUserId(
    tenantId: string,
    userId: string,
  ) {
    return this.prisma.cart.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },

      include: {
        items: {
          where: { variant: { product: { tenantId } } },
          orderBy: {
            createdAt: 'asc',
          },

          include: {
            variant: {
              include: {
                product: true,

                values: {
                  include: {
                    attributeValue: {
                      include: {
                        attribute: true,
                      },
                    },
                  },
                },

                images: {
                  orderBy: [
                    {
                      isPrimary: 'desc',
                    },
                    {
                      sortOrder: 'asc',
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
  }

  async getOrCreateCart(
    tenantId: string,
    userId: string,
  ) {
    return this.prisma.cart.upsert({
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

  async findCartItem(
    tenantId: string,
    userId: string,
    variantId: string,
  ) {
    return this.prisma.cartItem.findFirst({
      where: {
        variantId,

        cart: {
          tenantId,
          userId,
        },
        variant: { product: { tenantId } },
      },

      include: {
        cart: true,
        variant: true,
      },
    });
  }

  async addItem(
    tenantId: string,
    userId: string,
    variantId: string,
    quantity: number,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, product: { tenantId } },
      select: { id: true },
    });
    if (!variant) throw new Error('Variant does not belong to this tenant');
    const cart =
      await this.getOrCreateCart(
        tenantId,
        userId,
      );

    return this.prisma.cartItem.upsert({
      where: {
        cartId_variantId: {
          cartId: cart.id,
          variantId,
        },
      },

      create: {
        cartId: cart.id,
        variantId,
        quantity,
      },

      update: {
        quantity: {
          increment: quantity,
        },
      },
    });
  }

  async updateItem(
    tenantId: string,
    userId: string,
    variantId: string,
    quantity: number,
  ) {
    return this.prisma.cartItem.updateMany(
      {
        where: {
          variantId,

          cart: {
          tenantId,
            userId,
          },
        variant: { product: { tenantId } },
        },

        data: {
          quantity,
        },
      },
    );
  }

  async removeItem(
    tenantId: string,
    userId: string,
    variantId: string,
  ) {
    return this.prisma.cartItem.deleteMany(
      {
        where: {
          variantId,

          cart: {
          tenantId,
            userId,
          },
        variant: { product: { tenantId } },
        },
      },
    );
  }

  async clearCart(
    tenantId: string,
    userId: string,
  ) {
    return this.prisma.cartItem.deleteMany(
      {
        where: {
          cart: {
            tenantId,
            userId,
          },
        },
      },
    );
  }
}
