import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';

import { prisma } from '../../config/database.js';

import { mapInventory, mapInventoryTransaction } from './inventory.mapper.js';

import { InventoryRepository } from './inventory.repository.js';

import type {
  AdjustmentInput,
  InventoryListQuery,
  StockInInput,
  StockOutInput,
  CreateInventoryInput,
  InventoryResponse,
} from './inventory.types.js';

const RESERVED_MANUAL_REFERENCE_PREFIXES = ['cod-dmg:', 'init:'] as const;

const isPrismaUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  async commitOrderSale(
    tenantId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const order = await tx.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true, payments: true },
    });

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }
    if (
      order.paymentStatus !== 'PAID' ||
      !order.payments.some((payment) => payment.status === 'PAID')
    ) {
      throw new AppError(
        'Inventory can only be committed for a paid order',
        409,
        'ORDER_PAYMENT_NOT_PAID',
      );
    }

    const repository = new InventoryRepository(tx);
    // Match checkout lock ordering across orders sharing multiple variants.
    for (const item of [...order.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    )) {
      const inventory = await repository.findReservedInventory(
        tenantId,
        orderId,
        item.variantId,
        order.warehouseId,
      );
      if (!inventory) {
        throw new AppError(
          `Inventory not found for SKU "${item.sku}"`,
          409,
          'INVENTORY_NOT_FOUND',
        );
      }

      const existingSale = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'SALE',
        orderId,
      );
      if (existingSale) {
        if (existingSale.quantity !== item.quantity) {
          throw new AppError(
            `Committed inventory quantity does not match order SKU "${item.sku}"`,
            409,
            'INVENTORY_SALE_QUANTITY_MISMATCH',
          );
        }
        continue;
      }

      const reservation = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'RESERVATION',
        orderId,
      );
      if (!reservation || reservation.quantity !== item.quantity) {
        throw new AppError(
          `Active inventory reservation not found for SKU "${item.sku}"`,
          409,
          'ORDER_INVENTORY_RESERVATION_NOT_FOUND',
        );
      }

      const affectedRows = await repository.sale(
        tenantId,
        inventory.id,
        item.quantity,
      );
      if (affectedRows !== 1) {
        const concurrentSale = await repository.findTransactionByReference(
          tenantId,
          inventory.id,
          'SALE',
          orderId,
        );
        if (concurrentSale?.quantity === item.quantity) continue;
        throw new AppError(
          `Cannot commit inventory sale for SKU "${item.sku}"`,
          409,
          'INVALID_INVENTORY_SALE',
        );
      }

      await repository.createTransaction(tenantId, {
        inventoryId: inventory.id,
        type: 'SALE',
        quantity: item.quantity,
        referenceId: orderId,
        reason: `Payment completed for order ${order.orderNumber}`,
      });
    }
  }

  async releaseOrderReservation(
    tenantId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const order = await tx.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true, payments: true },
    });

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }
    if (
      order.paymentStatus === 'PAID' ||
      order.payments.some((payment) => payment.status === 'PAID')
    ) {
      return;
    }

    const repository = new InventoryRepository(tx);
    // Match checkout lock ordering across orders sharing multiple variants.
    for (const item of [...order.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    )) {
      const inventory = await repository.findReservedInventory(
        tenantId,
        orderId,
        item.variantId,
        order.warehouseId,
      );
      if (!inventory) continue;

      const existingRelease = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'RELEASE',
        orderId,
      );
      if (existingRelease) continue;

      const existingSale = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'SALE',
        orderId,
      );
      if (existingSale) continue;

      const reservation = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'RESERVATION',
        orderId,
      );
      if (!reservation) continue;

      const affectedRows = await repository.release(
        tenantId,
        inventory.id,
        item.quantity,
      );
      if (affectedRows !== 1) {
        const concurrentRelease = await repository.findTransactionByReference(
          tenantId,
          inventory.id,
          'RELEASE',
          orderId,
        );
        const concurrentSale = await repository.findTransactionByReference(
          tenantId,
          inventory.id,
          'SALE',
          orderId,
        );
        if (concurrentRelease || concurrentSale) continue;
        throw new AppError(
          `Cannot release inventory reservation for SKU "${item.sku}"`,
          409,
          'INVALID_INVENTORY_RELEASE',
        );
      }

      await repository.createTransaction(tenantId, {
        inventoryId: inventory.id,
        type: 'RELEASE',
        quantity: item.quantity,
        referenceId: orderId,
        reason: `Reservation released for order ${order.orderNumber}`,
      });
    }
  }

  async releaseOrderReservationAsDamaged(
    tenantId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
    reason?: string,
  ): Promise<void> {
    const order = await tx.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true, payments: true },
    });

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }
    if (
      order.paymentStatus === 'PAID' ||
      order.payments.some((payment) => payment.status === 'PAID')
    ) {
      throw new AppError(
        'Cannot process damaged return for a paid order',
        409,
        'ORDER_ALREADY_PAID',
      );
    }

    const repository = new InventoryRepository(tx);
    const damageReferenceId = `cod-dmg:${orderId}`;
    const trimmedReason = reason?.trim() || null;

    // Match checkout lock ordering across orders sharing multiple variants.
    for (const item of [...order.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    )) {
      const inventory = await repository.findReservedInventory(
        tenantId,
        orderId,
        item.variantId,
        order.warehouseId,
      );
      if (!inventory) {
        throw new AppError(
          `Active inventory reservation not found for SKU "${item.sku}"`,
          409,
          'ORDER_INVENTORY_RESERVATION_NOT_FOUND',
        );
      }

      const existingSale = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'SALE',
        orderId,
      );
      if (existingSale) {
        throw new AppError(
          `Inventory sale already committed for SKU "${item.sku}"`,
          409,
          'INVENTORY_SALE_ALREADY_COMMITTED',
        );
      }

      const existingRelease = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'RELEASE',
        orderId,
      );
      const existingDamageOut = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'STOCK_OUT',
        damageReferenceId,
      );

      if (existingRelease && existingDamageOut) {
        if (
          existingRelease.quantity !== item.quantity ||
          existingDamageOut.quantity !== item.quantity
        ) {
          throw new AppError(
            `Damaged return ledger quantity mismatch for SKU "${item.sku}"`,
            409,
            'INVENTORY_DAMAGED_RETURN_MISMATCH',
          );
        }
        continue;
      }

      if (existingRelease || existingDamageOut) {
        throw new AppError(
          `Inconsistent inventory ledger state for damaged return of SKU "${item.sku}"`,
          409,
          'INVENTORY_DAMAGED_RETURN_CONFLICT',
        );
      }

      const reservation = await repository.findTransactionByReference(
        tenantId,
        inventory.id,
        'RESERVATION',
        orderId,
      );
      if (!reservation || reservation.quantity !== item.quantity) {
        throw new AppError(
          `Active inventory reservation not found for SKU "${item.sku}"`,
          409,
          'ORDER_INVENTORY_RESERVATION_NOT_FOUND',
        );
      }

      const releasedRows = await repository.release(
        tenantId,
        inventory.id,
        item.quantity,
      );
      if (releasedRows !== 1) {
        throw new AppError(
          `Cannot release inventory reservation for SKU "${item.sku}"`,
          409,
          'INVALID_INVENTORY_RELEASE',
        );
      }

      await repository.createTransaction(tenantId, {
        inventoryId: inventory.id,
        type: 'RELEASE',
        quantity: item.quantity,
        referenceId: orderId,
        reason: `Reservation released for damaged COD return of order ${order.orderNumber}`,
      });

      const stockedOutRows = await repository.stockOut(
        tenantId,
        inventory.id,
        item.quantity,
      );
      if (stockedOutRows !== 1) {
        throw new AppError(
          `Cannot write off damaged inventory for SKU "${item.sku}"`,
          409,
          'INSUFFICIENT_INVENTORY',
        );
      }

      await repository.createTransaction(tenantId, {
        inventoryId: inventory.id,
        type: 'STOCK_OUT',
        quantity: item.quantity,
        referenceId: damageReferenceId,
        reason: trimmedReason
          ? `Damaged COD return for order ${order.orderNumber}: ${trimmedReason}`
          : `Damaged COD return write-off for order ${order.orderNumber}`,
      });
    }
  }

  /*
   * ==================================================
   * CREATE INVENTORY
   * ==================================================
   */

  async create(tenantId: string, input: CreateInventoryInput) {
    const quantity = input.quantity ?? 0;
    this.validateNonNegativeQuantity(quantity);

    const variant = await prisma.productVariant.findFirst({
      where: {
        id: input.variantId,
        product: { tenantId },
      },
      select: {
        id: true,
        isActive: true,
        product: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!variant) {
      throw new AppError('Product variant not found', 404, 'VARIANT_NOT_FOUND');
    }

    if (!variant.isActive) {
      throw new AppError(
        'Cannot create inventory for an inactive variant',
        409,
        'VARIANT_INACTIVE',
      );
    }

    if (variant.product.status === 'ARCHIVED') {
      throw new AppError(
        'Cannot create inventory for an archived product',
        409,
        'PRODUCT_ARCHIVED',
      );
    }

    const exists = await this.repository.existsByVariantId(
      tenantId,
      input.variantId,
      input.warehouseId,
    );

    if (exists) {
      throw new AppError(
        'Inventory already exists for this variant',
        409,
        'INVENTORY_ALREADY_EXISTS',
      );
    }

    const inventory = await prisma
      .$transaction(async (tx) => {
        const repository = new InventoryRepository(tx);
        const created = await repository.create(
          tenantId,
          input.variantId,
          quantity,
          input.warehouseId,
        );
        if (quantity > 0) {
          await repository.createTransaction(tenantId, {
            inventoryId: created.id,
            type: 'STOCK_IN',
            quantity,
            referenceId: `init:${created.id}`,
            reason: 'Initial stock',
          });
        }
        return created;
      })
      .catch((error: unknown) => {
        if (isPrismaUniqueConstraintError(error)) {
          throw new AppError(
            'Inventory already exists for this variant',
            409,
            'INVENTORY_ALREADY_EXISTS',
          );
        }

        throw error;
      });

    return mapInventory(inventory);
  }

  /*
   * ==================================================
   * GET ONE
   * ==================================================
   */

  async getById(tenantId: string, id: string) {
    const inventory = await this.repository.findById(tenantId, id);

    if (!inventory) {
      throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
    }

    return mapInventory(inventory);
  }

  /*
   * ==================================================
   * GET BY VARIANT
   * ==================================================
   */

  async getByVariantId(tenantId: string, variantId: string) {
    const inventory = await this.repository.findByVariantId(
      tenantId,
      variantId,
    );

    if (!inventory) {
      throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
    }

    return mapInventory(inventory);
  }

  /*
   * ==================================================
   * LIST
   * ==================================================
   */

  async list(tenantId: string, query: InventoryListQuery) {
    const { items, total } = await this.repository.findMany(tenantId, query);

    return {
      items: items.map(mapInventory),

      page: query.page,

      limit: query.limit,

      total,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  /*
   * ==================================================
   * STOCK IN
   * ==================================================
   */

  async stockIn(tenantId: string, inventoryId: string, input: StockInInput) {
    this.validatePositiveQuantity(input.quantity);
    const referenceId = input.referenceId?.trim() || undefined;
    const reason = input.reason?.trim() || null;

    return this.runManualMovement(
      tenantId,
      inventoryId,
      'STOCK_IN',
      input.quantity,
      reason,
      referenceId,
      async (repository) => {
        const affectedRows = await repository.stockIn(
          tenantId,
          inventoryId,
          input.quantity,
        );

        if (affectedRows !== 1) {
          throw new AppError(
            'Inventory quantity would exceed maximum supported limit',
            409,
            'INVENTORY_QUANTITY_OVERFLOW',
          );
        }
      },
    );
  }

  /*
   * ==================================================
   * STOCK OUT
   * ==================================================
   */

  async stockOut(tenantId: string, inventoryId: string, input: StockOutInput) {
    this.validatePositiveQuantity(input.quantity);
    const referenceId = input.referenceId?.trim() || undefined;
    const reason = input.reason?.trim() || null;

    return this.runManualMovement(
      tenantId,
      inventoryId,
      'STOCK_OUT',
      input.quantity,
      reason,
      referenceId,
      async (repository) => {
        const affectedRows = await repository.stockOut(
          tenantId,
          inventoryId,
          input.quantity,
        );

        if (affectedRows !== 1) {
          throw new AppError(
            'Insufficient available inventory',
            409,
            'INSUFFICIENT_INVENTORY',
          );
        }
      },
    );
  }

  /*
   * ==================================================
   * ADJUSTMENT
   * ==================================================
   */

  async adjustment(
    tenantId: string,
    inventoryId: string,
    input: AdjustmentInput,
  ) {
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity === 0 ||
      Math.abs(input.quantity) > 1_000_000_000
    ) {
      throw new AppError(
        'Adjustment quantity must be a non-zero integer within supported bounds',
        400,
        'INVALID_ADJUSTMENT',
      );
    }
    const referenceId = input.referenceId?.trim() || undefined;
    const reason = input.reason.trim();
    if (!reason) {
      throw new AppError('Reason is required', 400, 'INVALID_ADJUSTMENT');
    }

    return this.runManualMovement(
      tenantId,
      inventoryId,
      'ADJUSTMENT',
      input.quantity,
      reason,
      referenceId,
      async (repository) => {
        const affectedRows = await repository.adjustment(
          tenantId,
          inventoryId,
          input.quantity,
        );

        if (affectedRows !== 1) {
          if (input.quantity > 0) {
            throw new AppError(
              'Inventory quantity would exceed maximum supported limit',
              409,
              'INVENTORY_QUANTITY_OVERFLOW',
            );
          }
          throw new AppError(
            'Inventory adjustment would make physical quantity lower than reserved quantity',
            409,
            'INVALID_INVENTORY_ADJUSTMENT',
          );
        }
      },
    );
  }

  /*
   * ==================================================
   * TRANSACTION HISTORY
   * ==================================================
   */

  async listTransactions(
    tenantId: string,
    inventoryId: string,
    params: {
      page: number;
      limit: number;
    },
  ) {
    await this.ensureInventoryExists(tenantId, this.repository, inventoryId);

    const { items, total } = await this.repository.findTransactions(
      tenantId,
      inventoryId,
      params,
    );

    return {
      items: items.map(mapInventoryTransaction),

      page: params.page,

      limit: params.limit,

      total,

      totalPages: Math.ceil(total / params.limit),
    };
  }

  /*
   * ==================================================
   * HELPERS
   * ==================================================
   */

  private async ensureInventoryExists(
    tenantId: string,
    repository: InventoryRepository,
    inventoryId: string,
  ) {
    const inventory = await repository.findById(tenantId, inventoryId);

    if (!inventory) {
      throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
    }

    return inventory;
  }

  private async runManualMovement(
    tenantId: string,
    inventoryId: string,
    type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT',
    quantity: number,
    reason: string | null,
    referenceId: string | undefined,
    applyUpdate: (repository: InventoryRepository) => Promise<void>,
  ): Promise<InventoryResponse> {
    const execute = () =>
      prisma.$transaction(async (tx) => {
        const repository = new InventoryRepository(tx);

        await this.ensureInventoryExists(tenantId, repository, inventoryId);

        if (referenceId) {
          await this.assertManualReferenceAllowed(tx, tenantId, referenceId);
          await repository.lockReference(inventoryId, referenceId);
          const existing = await repository.findAnyTransactionByReference(
            tenantId,
            inventoryId,
            referenceId,
          );
          if (existing) {
            this.validateManualIdempotentMatch(existing, type, quantity, reason);
            const inventory = await repository.findById(tenantId, inventoryId);
            if (!inventory) {
              throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
            }
            return mapInventory(inventory);
          }
        }

        await applyUpdate(repository);

        await repository.createTransaction(tenantId, {
          inventoryId,
          type,
          quantity,
          referenceId: referenceId ?? null,
          reason,
        });

        const inventory = await repository.findById(tenantId, inventoryId);
        if (!inventory) {
          throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
        }
        return mapInventory(inventory);
      });

    try {
      return await execute();
    } catch (error) {
      if (!referenceId || !isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      const existing = await this.repository.findAnyTransactionByReference(
        tenantId,
        inventoryId,
        referenceId,
      );
      if (!existing) throw error;
      this.validateManualIdempotentMatch(existing, type, quantity, reason);
      const inventory = await this.repository.findById(tenantId, inventoryId);
      if (!inventory) {
        throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
      }
      return mapInventory(inventory);
    }
  }

  private async assertManualReferenceAllowed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    referenceId: string,
  ): Promise<void> {
    const normalized = referenceId.trim().toLowerCase();
    if (
      RESERVED_MANUAL_REFERENCE_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix),
      )
    ) {
      throw new AppError(
        'Reference ID uses a system-reserved prefix',
        400,
        'RESERVED_REFERENCE_ID',
      );
    }

    const existingOrder = await tx.order.findFirst({
      where: {
        id: referenceId,
        tenantId,
      },
      select: { id: true },
    });
    if (existingOrder) {
      throw new AppError(
        'Order IDs cannot be used as manual inventory reference IDs',
        409,
        'ORDER_REFERENCE_ID_FORBIDDEN',
      );
    }
  }

  private validateManualIdempotentMatch(
    existing: { type: string; quantity: number; reason: string | null },
    expectedType: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT',
    expectedQuantity: number,
    expectedReason: string | null,
  ): void {
    if (
      existing.type !== expectedType ||
      existing.quantity !== expectedQuantity ||
      (existing.reason ?? null) !== (expectedReason ?? null)
    ) {
      throw new AppError(
        'Reference ID has already been used with conflicting mutation parameters',
        409,
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
  }

  private validateNonNegativeQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000_000) {
      throw new AppError(
        'Quantity must be a non-negative integer within supported bounds',
        400,
        'INVALID_QUANTITY',
      );
    }
  }

  private validatePositiveQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
      throw new AppError(
        'Quantity must be a positive integer within supported bounds',
        400,
        'INVALID_QUANTITY',
      );
    }
  }
}
