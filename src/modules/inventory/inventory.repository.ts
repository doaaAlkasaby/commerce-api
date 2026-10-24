import type {
  Prisma,
  PrismaClient,
  InventoryTransactionType,
} from '../../generated/prisma/client.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export const inventoryInclude = {
  variant: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          basePrice: true,
        },
      },

      values: {
        include: {
          attributeValue: {
            include: {
              attribute: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },

      images: {
        orderBy: {
          sortOrder: 'asc',
        },
        select: {
          id: true,
          storageKey: true,
          url: true,
          altText: true,
          sortOrder: true,
          isPrimary: true,
        },
      },
    },
  },
} satisfies Prisma.InventoryInclude;

export type InventoryWithVariant = Prisma.InventoryGetPayload<{
  include: typeof inventoryInclude;
}>;

export class InventoryRepository {
  constructor(private readonly prisma: PrismaExecutor) {}

  async create(variantId: string, quantity = 0) {
    return this.prisma.inventory.create({
      data: {
        variantId,
        quantity,
        reservedQuantity: 0,
      },
      include: inventoryInclude,
    });
  }

  async findById(id: string) {
    return this.prisma.inventory.findUnique({
      where: {
        id,
      },
      include: inventoryInclude,
    });
  }

  async findByVariantId(variantId: string) {
    return this.prisma.inventory.findUnique({
      where: {
        variantId,
      },
      include: inventoryInclude,
    });
  }

  async existsByVariantId(variantId: string): Promise<boolean> {
    const inventory = await this.prisma.inventory.findUnique({
      where: {
        variantId,
      },
      select: {
        id: true,
      },
    });

    return inventory !== null;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.inventory.delete({
      where: {
        id,
      },
    });
  }

  async findMany(params: {
    page: number;
    limit: number;
    variantId?: string;
    lowStock?: number;
  }) {
    const { page, limit, variantId, lowStock } = params;

    const where: Prisma.InventoryWhereInput = {};

    if (variantId) {
      where.variantId = variantId;
    }

    if (lowStock !== undefined) {
      where.quantity = {
        gte: 0,
      };

      /*
       * Prisma cannot express:
       *
       * quantity - reservedQuantity <= lowStock
       *
       * directly through the normal query builder.
       *
       * We therefore handle low-stock filtering
       * separately below.
       */
    }

    if (lowStock === undefined) {
      const [items, total] = await Promise.all([
        this.prisma.inventory.findMany({
          where,
          include: inventoryInclude,
          orderBy: {
            updatedAt: 'desc',
          },
          skip: (page - 1) * limit,
          take: limit,
        }),

        this.prisma.inventory.count({
          where,
        }),
      ]);

      return {
        items,
        total,
      };
    }

    /*
     * Low-stock requires a raw SQL query because
     * available quantity is a calculated column.
     *
     * We first obtain matching inventory IDs.
     */
    const ids = await this.findLowStockIds(lowStock, variantId);

    const total = ids.length;

    const pagedIds = ids.slice((page - 1) * limit, page * limit);

    if (pagedIds.length === 0) {
      return {
        items: [],
        total,
      };
    }

    const items = await this.prisma.inventory.findMany({
      where: {
        id: {
          in: pagedIds,
        },
      },
      include: inventoryInclude,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return {
      items,
      total,
    };
  }

  private async findLowStockIds(
    lowStock: number,
    variantId?: string,
  ): Promise<string[]> {
    if (variantId) {
      return this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT i."id"
        FROM "Inventory" i
        WHERE i."variantId" = ${variantId}
          AND (
            i."quantity" -
            i."reservedQuantity"
          ) <= ${lowStock}
        ORDER BY i."updatedAt" DESC
      `.then((rows) => rows.map((row) => row.id));
    }

    return this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT i."id"
      FROM "Inventory" i
      WHERE (
        i."quantity" -
        i."reservedQuantity"
      ) <= ${lowStock}
      ORDER BY i."updatedAt" DESC
    `.then((rows) => rows.map((row) => row.id));
  }

  /*
   * --------------------------------------------------
   * Atomic STOCK IN
   * --------------------------------------------------
   */

  async stockIn(inventoryId: string, quantity: number): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" + ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
    `;
  }

  /*
   * --------------------------------------------------
   * Atomic STOCK OUT
   *
   * We cannot remove stock that is already reserved.
   *
   * available = quantity - reservedQuantity
   * --------------------------------------------------
   */

  async stockOut(inventoryId: string, quantity: number): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" - ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND (
          "quantity" -
          "reservedQuantity"
        ) >= ${quantity}
    `;
  }

  /*
   * --------------------------------------------------
   * ADJUSTMENT
   *
   * Positive:
   *   quantity increases
   *
   * Negative:
   *   quantity decreases
   *
   * But quantity can never become less than
   * reservedQuantity.
   * --------------------------------------------------
   */

  async adjustment(inventoryId: string, quantity: number): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" + ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND (
          "quantity" + ${quantity}
        ) >= "reservedQuantity"
    `;
  }

  /*
   * --------------------------------------------------
   * RESERVATION
   *
   * quantity remains unchanged.
   *
   * reservedQuantity increases only when enough
   * available stock exists.
   * --------------------------------------------------
   */

  async reserve(inventoryId: string, quantity: number): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "reservedQuantity" =
          "reservedQuantity" + ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND (
          "quantity" -
          "reservedQuantity"
        ) >= ${quantity}
    `;
  }

  /*
   * --------------------------------------------------
   * RELEASE
   *
   * reservedQuantity cannot become negative.
   * --------------------------------------------------
   */

  async release(inventoryId: string, quantity: number): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "reservedQuantity" =
          "reservedQuantity" - ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND "reservedQuantity" >= ${quantity}
    `;
  }

  /*
   * --------------------------------------------------
   * SALE
   *
   * A sale consumes both:
   *
   * quantity
   * reservedQuantity
   *
   * Example:
   *
   * quantity = 10
   * reserved = 3
   *
   * SALE 3
   *
   * quantity = 7
   * reserved = 0
   * --------------------------------------------------
   */

  async sale(inventoryId: string, quantity: number): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" - ${quantity},

        "reservedQuantity" =
          "reservedQuantity" - ${quantity},

        "updatedAt" = CURRENT_TIMESTAMP

      WHERE "id" = ${inventoryId}

        AND "quantity" >= ${quantity}

        AND "reservedQuantity" >= ${quantity}
    `;
  }

  /*
   * --------------------------------------------------
   * TRANSACTIONS
   * --------------------------------------------------
   */

  async createTransaction(data: {
    inventoryId: string;
    type: InventoryTransactionType;
    quantity: number;
    referenceId?: string | null;
    reason?: string | null;
  }) {
    return this.prisma.inventoryTransaction.create({
      data: {
        inventoryId: data.inventoryId,

        type: data.type,

        quantity: data.quantity,

        referenceId: data.referenceId ?? null,

        reason: data.reason ?? null,
      },
    });
  }

  async findTransactionByReference(
    inventoryId: string,
    type: InventoryTransactionType,
    referenceId: string,
  ) {
    return this.prisma.inventoryTransaction.findFirst({
      where: {
        inventoryId,
        type,
        referenceId,
      },
    });
  }

  async findTransactions(
    inventoryId: string,
    params: {
      page: number;
      limit: number;
    },
  ) {
    const { page, limit } = params;

    const where = {
      inventoryId,
    };

    const [items, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      }),

      this.prisma.inventoryTransaction.count({
        where,
      }),
    ]);

    return {
      items,
      total,
    };
  }
}
