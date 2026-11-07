import type {
  Prisma,
  PrismaClient,
  InventoryTransactionType,
} from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export const inventoryInclude = {
  variant: {
    include: {
      product: {
        select: {
          id: true,
          tenantId: true,
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

  async create(
    tenantId: string,
    variantId: string,
    quantity = 0,
    requestedWarehouseId?: string,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, product: { tenantId } },
      select: { id: true },
    });
    if (!variant) throw new Error('Variant does not belong to this tenant');
    const warehouseId = await this.resolveWarehouse(
      tenantId,
      requestedWarehouseId,
    );
    return this.prisma.inventory.create({
      data: {
        variantId,
        tenantId,
        warehouseId,
        quantity,
        reservedQuantity: 0,
      },
      include: inventoryInclude,
    });
  }

  async resolveWarehouse(tenantId: string, id?: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        tenantId,
        isActive: true,
        ...(id ? { id } : { isDefault: true }),
      },
      select: { id: true },
    });
    if (!warehouse)
      throw new AppError(
        'An active tenant warehouse is required',
        409,
        'WAREHOUSE_NOT_CONFIGURED',
      );
    return warehouse.id;
  }

  async findReservedInventory(
    tenantId: string,
    orderId: string,
    variantId: string,
    warehouseId?: string | null,
  ) {
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: {
        type: 'RESERVATION',
        referenceId: orderId,
        inventory: {
          tenantId,
          variantId,
          ...(warehouseId ? { warehouseId } : {}),
        },
      },
      include: { inventory: true },
      take: 2,
    });
    if (transactions.length > 1)
      throw new AppError(
        'Original inventory reservation is ambiguous',
        409,
        'ORDER_INVENTORY_RESERVATION_AMBIGUOUS',
      );
    return transactions[0]?.inventory ?? null;
  }

  async findById(tenantId: string, id: string) {
    return this.prisma.inventory.findFirst({
      where: {
        id,
        variant: { product: { tenantId } },
      },
      include: inventoryInclude,
    });
  }

  async findByVariantId(
    tenantId: string,
    variantId: string,
    warehouseId?: string,
  ) {
    return this.prisma.inventory.findFirst({
      where: {
        variantId,
        warehouse: {
          tenantId,
          ...(warehouseId ? { id: warehouseId } : { isDefault: true }),
        },
        variant: { product: { tenantId } },
      },
      include: inventoryInclude,
    });
  }

  async existsByVariantId(
    tenantId: string,
    variantId: string,
    warehouseId?: string,
  ): Promise<boolean> {
    const inventory = await this.prisma.inventory.findFirst({
      where: {
        variantId,
        warehouse: {
          tenantId,
          ...(warehouseId ? { id: warehouseId } : { isDefault: true }),
        },
        variant: { product: { tenantId } },
      },
      select: {
        id: true,
      },
    });

    return inventory !== null;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.prisma.inventory.deleteMany({
      where: {
        id,
        variant: { product: { tenantId } },
      },
    });
  }

  async findMany(
    tenantId: string,
    params: {
      warehouseId?: string;
      page: number;
      limit: number;
      variantId?: string;
      lowStock?: number;
    },
  ) {
    const { page, limit, variantId, lowStock, warehouseId } = params;

    const where: Prisma.InventoryWhereInput = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      variant: { product: { tenantId } },
    };

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
    const ids = await this.findLowStockIds(
      tenantId,
      lowStock,
      variantId,
      warehouseId,
    );

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
        variant: { product: { tenantId } },
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
    tenantId: string,
    lowStock: number,
    variantId?: string,
    warehouseId?: string,
  ): Promise<string[]> {
    if (variantId) {
      return this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT i."id"
        FROM "Inventory" i
        JOIN "ProductVariant" pv ON pv."id" = i."variantId"
        JOIN "Product" p ON p."id" = pv."productId"
        WHERE i."variantId" = ${variantId}
          AND (${warehouseId ?? null}::text IS NULL OR i."warehouseId" = ${warehouseId ?? null})
          AND p."tenantId" = ${tenantId}
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
      JOIN "ProductVariant" pv ON pv."id" = i."variantId"
      JOIN "Product" p ON p."id" = pv."productId"
      WHERE (
        i."quantity" -
        i."reservedQuantity"
      ) <= ${lowStock}
        AND p."tenantId" = ${tenantId}
        AND (${warehouseId ?? null}::text IS NULL OR i."warehouseId" = ${warehouseId ?? null})
      ORDER BY i."updatedAt" DESC
    `.then((rows) => rows.map((row) => row.id));
  }

  /*
   * --------------------------------------------------
   * Atomic STOCK IN
   * --------------------------------------------------
   */

  async stockIn(
    tenantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" + ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND EXISTS (SELECT 1 FROM "ProductVariant" pv JOIN "Product" p ON p."id" = pv."productId" WHERE pv."id" = "Inventory"."variantId" AND p."tenantId" = ${tenantId})
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

  async stockOut(
    tenantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" - ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND EXISTS (SELECT 1 FROM "ProductVariant" pv JOIN "Product" p ON p."id" = pv."productId" WHERE pv."id" = "Inventory"."variantId" AND p."tenantId" = ${tenantId})
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

  async adjustment(
    tenantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" + ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND EXISTS (SELECT 1 FROM "ProductVariant" pv JOIN "Product" p ON p."id" = pv."productId" WHERE pv."id" = "Inventory"."variantId" AND p."tenantId" = ${tenantId})
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

  async reserve(
    tenantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "reservedQuantity" =
          "reservedQuantity" + ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND EXISTS (SELECT 1 FROM "ProductVariant" pv JOIN "Product" p ON p."id" = pv."productId" WHERE pv."id" = "Inventory"."variantId" AND p."tenantId" = ${tenantId})
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

  async release(
    tenantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "reservedQuantity" =
          "reservedQuantity" - ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${inventoryId}
        AND EXISTS (SELECT 1 FROM "ProductVariant" pv JOIN "Product" p ON p."id" = pv."productId" WHERE pv."id" = "Inventory"."variantId" AND p."tenantId" = ${tenantId})
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

  async sale(
    tenantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "Inventory"
      SET
        "quantity" =
          "quantity" - ${quantity},

        "reservedQuantity" =
          "reservedQuantity" - ${quantity},

        "updatedAt" = CURRENT_TIMESTAMP

      WHERE "id" = ${inventoryId}
        AND EXISTS (SELECT 1 FROM "ProductVariant" pv JOIN "Product" p ON p."id" = pv."productId" WHERE pv."id" = "Inventory"."variantId" AND p."tenantId" = ${tenantId})

        AND "quantity" >= ${quantity}

        AND "reservedQuantity" >= ${quantity}
    `;
  }

  /*
   * --------------------------------------------------
   * TRANSACTIONS
   * --------------------------------------------------
   */

  async createTransaction(
    tenantId: string,
    data: {
      inventoryId: string;
      type: InventoryTransactionType;
      quantity: number;
      referenceId?: string | null;
      reason?: string | null;
    },
  ) {
    const inventory = await this.prisma.inventory.findFirst({
      where: { id: data.inventoryId, variant: { product: { tenantId } } },
      select: { id: true },
    });
    if (!inventory) throw new Error('Inventory does not belong to this tenant');
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
    tenantId: string,
    inventoryId: string,
    type: InventoryTransactionType,
    referenceId: string,
  ) {
    return this.prisma.inventoryTransaction.findFirst({
      where: {
        inventoryId,
        inventory: { variant: { product: { tenantId } } },
        type,
        referenceId,
      },
    });
  }

  async findTransactions(
    tenantId: string,
    inventoryId: string,
    params: {
      page: number;
      limit: number;
    },
  ) {
    const { page, limit } = params;

    const where = {
      inventoryId,
      inventory: { variant: { product: { tenantId } } },
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
