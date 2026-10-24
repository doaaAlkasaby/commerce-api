import type {
  PrismaClient,
} from '../../generated/prisma/client.js';

export class CartRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findByUserId(
    userId: string,
  ) {
    return this.prisma.cart.findUnique({
      where: {
        userId,
      },

      include: {
        items: {
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
    userId: string,
  ) {
    return this.prisma.cart.upsert({
      where: {
        userId,
      },

      create: {
        userId,
      },

      update: {},
    });
  }

  async findCartItem(
    userId: string,
    variantId: string,
  ) {
    return this.prisma.cartItem.findFirst({
      where: {
        variantId,

        cart: {
          userId,
        },
      },

      include: {
        cart: true,
        variant: true,
      },
    });
  }

  async addItem(
    userId: string,
    variantId: string,
    quantity: number,
  ) {
    const cart =
      await this.getOrCreateCart(
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
    userId: string,
    variantId: string,
    quantity: number,
  ) {
    return this.prisma.cartItem.updateMany(
      {
        where: {
          variantId,

          cart: {
            userId,
          },
        },

        data: {
          quantity,
        },
      },
    );
  }

  async removeItem(
    userId: string,
    variantId: string,
  ) {
    return this.prisma.cartItem.deleteMany(
      {
        where: {
          variantId,

          cart: {
            userId,
          },
        },
      },
    );
  }

  async clearCart(
    userId: string,
  ) {
    return this.prisma.cartItem.deleteMany(
      {
        where: {
          cart: {
            userId,
          },
        },
      },
    );
  }
}