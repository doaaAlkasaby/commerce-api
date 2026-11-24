import type {
  Prisma,
  PrismaClient,
  InventoryTransactionType,
} from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export const inventoryInclude = {
  warehouse: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      isDefault: true,
    },
  },
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
          images: {
            select: { url: true },
            orderBy: [
              { isPrimary: 'desc' as const },
              { sortOrder: 'asc' as const },
              { createdAt: 'asc' as const },
            ],
            take: 1,
          },
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
      search?: string;
      lowStock?: number;
    },
  ) {
    const { page, limit, variantId, search, lowStock, warehouseId } = params;
    const trimmedSearch = search?.trim();

    const variantFilter: Prisma.ProductVariantWhereInput = {
      product: { tenantId },
      ...(trimmedSearch
        ? {
            OR: [
              { sku: { contains: trimmedSearch, mode: 'insensitive' } },
              {
                product: {
                  tenantId,
                  name: { contains: trimmedSearch, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const where: Prisma.InventoryWhereInput = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      variant: variantFilter,
    };

    if (variantId) {
      where.variantId = variantId;
    }

    if (lowStock !== undefined) {
      where.quantity = {
        gte: 0,
      };
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

    const ids = await this.findLowStockIds(
      tenantId,
      lowStock,
      variantId,
      warehouseId,
      trimmedSearch,
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
    search?: string,
  ): Promise<string[]> {
    const searchPattern = search ? `%${search}%` : null;
    if (variantId) {
      return this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT i."id"
        FROM "Inventory" i
        JOIN "ProductVariant" pv ON pv."id" = i."variantId"
        JOIN "Product" p ON p."id" = pv."productId"
        WHERE i."variantId" = ${variantId}
          AND (${warehouseId ?? null}::text IS NULL OR i."warehouseId" = ${warehouseId ?? null})
          AND (${searchPattern}::text IS NULL OR pv."sku" ILIKE ${searchPattern} OR p."name" ILIKE ${searchPattern})
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
        AND (${searchPattern}::text IS NULL OR pv."sku" ILIKE ${searchPattern} OR p."name" ILIKE ${searchPattern})
      ORDER BY i."updatedAt" DESC
    `.then((rows) => rows.map((row) => row.id));
  }

  /*
   * --------------------------------------------------
   * Atomic STOCK IN (with INT4 overflow guard)
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
        AND ("quantity"::bigint + ${quantity}::bigint) <= 2147483647
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
   * ADJUSTMENT (with reserved floor & INT4 overflow guard)
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
        AND ("quantity"::bigint + ${quantity}::bigint) >= "reservedQuantity"::bigint
        AND ("quantity"::bigint + ${quantity}::bigint) <= 2147483647
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

  async lockReference(inventoryId: string, referenceId: string): Promise<void> {
    await this.prisma
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'inv-ref:' + inventoryId + ':' + referenceId}))`;
  }

  async findAnyTransactionByReference(
    tenantId: string,
    inventoryId: string,
    referenceId: string,
  ) {
    return this.prisma.inventoryTransaction.findFirst({
      where: {
        inventoryId,
        inventory: { variant: { product: { tenantId } } },
        referenceId,
      },
      orderBy: { createdAt: 'asc' },
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
