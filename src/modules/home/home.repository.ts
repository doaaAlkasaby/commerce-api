import { prisma } from '../../config/database.js';

export class HomeRepository {
  async findBanners(limit: number) {
    const now = new Date();

    return prisma.banner.findMany({
      where: {
        isActive: true,

        AND: [
          {
            OR: [
              { startsAt: null },
              { startsAt: { lte: now } },
            ],
          },
          {
            OR: [
              { endsAt: null },
              { endsAt: { gte: now } },
            ],
          },
        ],
      },

      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ],

      take: limit,
    });
  }

  async findCategories(limit: number) {
    return prisma.category.findMany({
      where: {
        isActive: true,
      },

      orderBy: [
        { name: 'asc' },
        { id: 'asc' },
      ],

      take: limit,

          select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      _count: {
        select: {
          children: {
      where: {
        isActive: true,
      },
    },
        },
      },
    },
    });
  }

  async findBrands(limit: number) {
    return prisma.brand.findMany({
      where: {
        isActive: true,
      },

      orderBy: [
        { name: 'asc' },
        { id: 'asc' },
      ],

      take: limit,
    });
  }

  async findFeaturedProducts(limit: number) {
    const now = new Date();

    const collection =
      await prisma.productCollection.findFirst({
        where: {
          slug: 'featured',

          isActive: true,

          AND: [
            {
              OR: [
                { startsAt: null },
                { startsAt: { lte: now } },
              ],
            },
            {
              OR: [
                { endsAt: null },
                { endsAt: { gte: now } },
              ],
            },
          ],
        },

        include: {
          products: {
            where: {
              product: {
                status: 'ACTIVE',

                variants: {
                  some: {
                    isActive: true,
                  },
                },
              },
            },

            orderBy: [
              { sortOrder: 'asc' },
              { productId: 'asc' },
            ],

            take: limit,

            include: {
              product: {
                include: {
                  images: {
                    orderBy: [
                      { sortOrder: 'asc' },
                      { id: 'asc' },
                    ],
                    take: 1,
                  },

                  variants: {
                    where: {
                      isActive: true,
                    },

                    orderBy: [
                      { price: 'asc' },
                      { id: 'asc' },
                    ],

                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

    if (!collection) {
      return [];
    }

    return collection.products.map(
      (item) => item.product,
    );
  }
}