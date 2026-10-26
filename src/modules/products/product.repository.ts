import { Prisma } from '../../generated/prisma/client.js';

import type {
  PrismaClient,
  ProductStatus,
} from '../../generated/prisma/client.js';

import type {
  CreateProductInput,
  ProductListQuery,
  UpdateProductInput,
} from './product.types.js';

type BestSellerRow = {
  productId: string;
  soldQuantity: bigint;
};

type BestSellerCountRow = {
  count: bigint;
};

const BEST_SELLER_ORDER_STATUSES = [
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
] as const;

/**
 * Reusable select for product variants.
 *
 * This keeps all product listing queries consistent.
 *
 * IMPORTANT:
 * We use `select` only.
 * Do NOT combine `include` and `select` at the same level.
 */
const productVariantSelect = {
  id: true,
  sku: true,
  price: true,

  isActive: true,
  isDefault: true,

  discountType: true,
  discountValue: true,
  discountStartsAt: true,
  discountEndsAt: true,

  combinationKey: true,

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
      { isPrimary: 'desc' },
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  },
} satisfies Prisma.ProductVariantSelect;

/**
 * ProductRepository
 *
 * Responsibilities:
 * - Product CRUD
 * - Product discovery queries
 * - Product variants loading
 * - Offers
 * - Best sellers
 * - New arrivals
 * - Collection products
 */
export class ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ============================================================
  // FIND PRODUCT BY ID
  // ============================================================

  async findById(id: string, tenantId: string) {
    return this.prisma.product.findUnique({
      where: {
        id,
        tenantId,
      },

      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },

        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },

        images: {
          orderBy: [
            { isPrimary: 'desc' },
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        },

        attributes: {
          orderBy: {
            sortOrder: 'asc',
          },

          include: {
            values: {
              orderBy: {
                sortOrder: 'asc',
              },
            },
          },
        },

        variants: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],

          select: {
            ...productVariantSelect,

            inventory: true,
          },
        },
      },
    });
  }

  // ============================================================
  // FIND PRODUCT BY SLUG
  // ============================================================

  async findBySlug(slug: string) {
    return this.prisma.product.findUnique({
      where: {
        slug,
      },
    });
  }

  // ============================================================
  // FIND ATTRIBUTE VALUES BY IDS
  // ============================================================

  async findAttributeValuesByIds(
    productId: string,
    attributeValueIds: string[],
  ) {
    if (attributeValueIds.length === 0) {
      return [];
    }

    return this.prisma.productAttributeValue.findMany({
      where: {
        id: {
          in: attributeValueIds,
        },

        attribute: {
          productId,
        },
      },

      select: {
        id: true,
        attributeId: true,
        value: true,
      },
    });
  }

  // ============================================================
  // FIND PRODUCTS
  // ============================================================

  async findList(
    query: ProductListQuery,
    skip: number,
    take: number,
  ) {
    const where = {
      status: 'ACTIVE' as const,

      ...(query.categoryId
        ? {
            categoryId: query.categoryId,
          }
        : {}),

      ...(query.brandId
        ? {
            brandId: query.brandId,
          }
        : {}),

      ...(query.search
        ? {
            OR: [
              {
                name: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },

              {
                description: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),

      ...(query.minPrice !== undefined ||
      query.maxPrice !== undefined
        ? {
            basePrice: {
              ...(query.minPrice !== undefined
                ? {
                    gte: query.minPrice,
                  }
                : {}),

              ...(query.maxPrice !== undefined
                ? {
                    lte: query.maxPrice,
                  }
                : {}),
            },
          }
        : {}),
    } satisfies Prisma.ProductWhereInput;

    const orderBy = {
      [query.sortBy]: query.sortOrder,
    } satisfies Prisma.ProductOrderByWithRelationInput;

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,

        orderBy,

        skip,
        take,

        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          status: true,

          basePrice: true,

          discountType: true,
          discountValue: true,
          discountStartsAt: true,
          discountEndsAt: true,

          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },

          brand: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },

          images: {
            where: {
              isPrimary: true,
            },

            orderBy: [
              { sortOrder: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],

            take: 1,

            select: {
              id: true,
              url: true,
              altText: true,
            },
          },
        },
      }),

      this.prisma.product.count({
        where,
      }),
    ]);

    return {
      items,
      total,
    };
  }

  // ============================================================
  // CREATE PRODUCT
  // ============================================================

  async create(input: CreateProductInput) {
    return this.prisma.product.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,

        categoryId: input.categoryId,
        brandId: input.brandId ?? null,

        basePrice: input.basePrice,

        discountType: input.discount?.type ?? null,
        discountValue: input.discount?.value ?? null,
        discountStartsAt: input.discount?.startsAt ?? null,
        discountEndsAt: input.discount?.endsAt ?? null,
      },
    });
  }

  // ============================================================
  // UPDATE PRODUCT
  // ============================================================

  async update(
    id: string,
    input: UpdateProductInput,
  ) {
    return this.prisma.product.update({
      where: {
        id,
      },

      data: {
        ...(input.name !== undefined && {
          name: input.name,
        }),

        ...(input.slug !== undefined && {
          slug: input.slug,
        }),

        ...(input.description !== undefined && {
          description: input.description,
        }),

        ...(input.categoryId !== undefined && {
          categoryId: input.categoryId,
        }),

        ...(input.brandId !== undefined && {
          brandId: input.brandId,
        }),

        ...(input.basePrice !== undefined && {
          basePrice: input.basePrice,
        }),

        ...(input.discount !== undefined && {
          discountType: input.discount?.type ?? null,
          discountValue: input.discount?.value ?? null,
          discountStartsAt: input.discount?.startsAt ?? null,
          discountEndsAt: input.discount?.endsAt ?? null,
        }),
      },
    });
  }

  // ============================================================
  // UPDATE PRODUCT STATUS
  // ============================================================

  async updateStatus(
    id: string,
    status: ProductStatus,
  ) {
    return this.prisma.product.update({
      where: {
        id,
      },

      data: {
        status,
      },
    });
  }

  // ============================================================
  // DELETE PRODUCT
  // ============================================================

  async delete(id: string) {
    return this.prisma.product.delete({
      where: {
        id,
      },
    });
  }

  // ============================================================
  // COUNT ACTIVE VARIANTS
  // ============================================================

  async countActiveVariants(
    productId: string,
  ): Promise<number> {
    return this.prisma.productVariant.count({
      where: {
        productId,
        isActive: true,
      },
    });
  }

  // ============================================================
  // CATEGORY EXISTS
  // ============================================================

  async categoryExists(
    categoryId: string,
  ): Promise<boolean> {
    const category =
      await this.prisma.category.findUnique({
        where: {
          id: categoryId,
        },

        select: {
          id: true,
        },
      });

    return category !== null;
  }

  // ============================================================
  // BRAND EXISTS
  // ============================================================

  async brandExists(
    brandId: string,
  ): Promise<boolean> {
    const brand =
      await this.prisma.brand.findUnique({
        where: {
          id: brandId,
        },

        select: {
          id: true,
        },
      });

    return brand !== null;
  }

  // ============================================================
  // FIND OFFERS
  // ============================================================

  /**
   * Returns products that currently have
   * an active product-level or variant-level discount.
   *
   * Pagination is performed directly by PostgreSQL.
   */
  async findOffers(
    skip: number,
    take: number,
  ) {
    const now = new Date();

    const where = {
      status: 'ACTIVE' as const,

      OR: [
        // --------------------------------------------------------
        // Product-level discount
        // --------------------------------------------------------
        {
          discountType: {
            not: null,
          },

          discountValue: {
            not: null,
          },

          OR: [
            {
              discountStartsAt: null,
            },

            {
              discountStartsAt: {
                lte: now,
              },
            },
          ],

          AND: [
            {
              OR: [
                {
                  discountEndsAt: null,
                },

                {
                  discountEndsAt: {
                    gte: now,
                  },
                },
              ],
            },
          ],
        },

        // --------------------------------------------------------
        // Variant-level discount
        // --------------------------------------------------------
        {
          variants: {
            some: {
              isActive: true,

              discountType: {
                not: null,
              },

              discountValue: {
                not: null,
              },

              OR: [
                {
                  discountStartsAt: null,
                },

                {
                  discountStartsAt: {
                    lte: now,
                  },
                },
              ],

              AND: [
                {
                  OR: [
                    {
                      discountEndsAt: null,
                    },

                    {
                      discountEndsAt: {
                        gte: now,
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    } satisfies Prisma.ProductWhereInput;

    const [items, total] =
      await Promise.all([
        this.prisma.product.findMany({
          where,

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

          include: {
            images: {
              orderBy: [
                { isPrimary: 'desc' },
                { sortOrder: 'asc' },
                { createdAt: 'asc' },
                { id: 'asc' },
              ],
            },

            variants: {
              where: {
                isActive: true,
              },

              orderBy: [
                { price: 'asc' },
                { id: 'asc' },
              ],

              select: productVariantSelect,
            },

            category: true,
            brand: true,
          },
        }),

        this.prisma.product.count({
          where,
        }),
      ]);

    return {
      items,
      total,
    };
  }

  // ============================================================
  // FIND BEST SELLERS
  // ============================================================

  /**
   * Returns best-selling active products.
   *
   * Ranking is calculated directly in PostgreSQL:
   *
   * OrderItem
   *      ↓
   * Order
   *      ↓
   * Product
   *      ↓
   * filter valid order statuses
   *      ↓
   * filter ACTIVE products
   *      ↓
   * GROUP BY product
   *      ↓
   * SUM(quantity)
   *      ↓
   * ORDER BY sold quantity
   *      ↓
   * OFFSET / LIMIT
   *
   * This avoids loading every bestseller into Node.js.
   */
  async findBestSellers(
    skip: number,
    take: number,
  ) {
    const orderStatuses =
      Prisma.join(
        BEST_SELLER_ORDER_STATUSES.map(
          (status) => Prisma.sql`${status}`,
        ),
      );

    // ----------------------------------------------------------
    // Step 1:
    // Get ONLY the product IDs for the requested page.
    // ----------------------------------------------------------

    const rows =
      await this.prisma.$queryRaw<
        BestSellerRow[]
      >(
        Prisma.sql`
          SELECT
            oi."productId" AS "productId",
            SUM(oi."quantity")::bigint AS "soldQuantity"

          FROM "OrderItem" oi

          INNER JOIN "Order" o
            ON o."id" = oi."orderId"

          INNER JOIN "Product" p
            ON p."id" = oi."productId"

          WHERE
            o."status" IN (${orderStatuses})
            AND p."status" = 'ACTIVE'

          GROUP BY
            oi."productId"

          ORDER BY
            SUM(oi."quantity") DESC,
            oi."productId" ASC

          OFFSET ${skip}
          LIMIT ${take}
        `,
      );

    // ----------------------------------------------------------
    // Count total bestseller products
    // ----------------------------------------------------------

    const countRows =
      await this.prisma.$queryRaw<
        BestSellerCountRow[]
      >(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS "count"

          FROM (
            SELECT
              oi."productId"

            FROM "OrderItem" oi

            INNER JOIN "Order" o
              ON o."id" = oi."orderId"

            INNER JOIN "Product" p
              ON p."id" = oi."productId"

            WHERE
              o."status" IN (${orderStatuses})
              AND p."status" = 'ACTIVE'

            GROUP BY
              oi."productId"
          ) AS bestseller_products
        `,
      );

    const total = Number(
      countRows[0]?.count ?? 0n,
    );

    if (rows.length === 0) {
      return {
        items: [],
        total,
      };
    }

    // ----------------------------------------------------------
    // Step 2:
    // Extract product IDs in database ranking order.
    // ----------------------------------------------------------

    const productIds = rows.map(
      (row) => row.productId,
    );

    // ----------------------------------------------------------
    // Step 3:
    // Fetch only products belonging to current page.
    // ----------------------------------------------------------

    const products =
      await this.prisma.product.findMany({
        where: {
          id: {
            in: productIds,
          },

          status: 'ACTIVE',
        },

        include: {
          images: {
            orderBy: [
              { isPrimary: 'desc' },
              { sortOrder: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
          },

          variants: {
            where: {
              isActive: true,
            },

            orderBy: [
              { price: 'asc' },
              { id: 'asc' },
            ],

            select: productVariantSelect,
          },

          category: true,
          brand: true,
        },
      });

    // ----------------------------------------------------------
    // Prisma `in` does not guarantee the same order
    // as productIds.
    // ----------------------------------------------------------

    const productMap = new Map(
      products.map((product) => [
        product.id,
        product,
      ]),
    );

    const items = productIds.flatMap(
      (productId) => {
        const product =
          productMap.get(productId);

        return product
          ? [product]
          : [];
      },
    );

    return {
      items,
      total,
    };
  }

  // ============================================================
  // FIND NEW ARRIVALS
  // ============================================================

  /**
   * Returns active products ordered by creation date.
   */
  async findNewArrivals(
    skip: number,
    take: number,
  ) {
    const where = {
      status: 'ACTIVE' as const,
    };

    const [items, total] =
      await Promise.all([
        this.prisma.product.findMany({
          where,

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

          include: {
            images: {
              orderBy: [
                { isPrimary: 'desc' },
                { sortOrder: 'asc' },
                { createdAt: 'asc' },
                { id: 'asc' },
              ],
            },

            variants: {
              where: {
                isActive: true,
              },

              orderBy: [
                { price: 'asc' },
                { id: 'asc' },
              ],

              select: productVariantSelect,
            },

            category: true,
            brand: true,
          },
        }),

        this.prisma.product.count({
          where,
        }),
      ]);

    return {
      items,
      total,
    };
  }

  // ============================================================
  // FIND COLLECTION PRODUCTS
  // ============================================================

  /**
   * Returns active products belonging to
   * an active collection.
   *
   * Pagination is based on collection item ordering.
   */
  async findCollectionProducts(
    collectionId: string,
    skip: number,
    take: number,
  ) {
    const where = {
      collectionId,

      product: {
        status: 'ACTIVE' as const,
      },
    };

    const [
      collectionItems,
      total,
    ] = await Promise.all([
      this.prisma.productCollectionItem.findMany(
        {
          where,

          orderBy: [
            {
              sortOrder: 'asc',
            },

            {
              productId: 'asc',
            },
          ],

          skip,
          take,

          include: {
            product: {
              include: {
                images: {
                  orderBy: [
                    {
                      isPrimary: 'desc',
                    },

                    {
                      sortOrder: 'asc',
                    },

                    {
                      createdAt: 'asc',
                    },

                    {
                      id: 'asc',
                    },
                  ],
                },

                variants: {
                  where: {
                    isActive: true,
                  },

                  orderBy: [
                    {
                      price: 'asc',
                    },

                    {
                      id: 'asc',
                    },
                  ],

                  select: productVariantSelect,
                },

                category: true,
                brand: true,
              },
            },
          },
        },
      ),

      this.prisma.productCollectionItem.count({
        where,
      }),
    ]);

    return {
      items: collectionItems.map(
        (item) => item.product,
      ),

      total,
    };
  }
}

// ============================================================
// REPOSITORY FACTORY
// ============================================================

export const createProductRepository = (
  prisma: PrismaClient,
) => new ProductRepository(prisma);