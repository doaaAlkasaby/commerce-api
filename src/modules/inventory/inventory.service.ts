import { AppError } from '../../common/errors/app-error.js';

import { prisma } from '../../config/database.js';

import { mapInventory, mapInventoryTransaction } from './inventory.mapper.js';

import { InventoryRepository } from './inventory.repository.js';

import type {
  AdjustmentInput,
  InventoryListQuery,
  ReleaseInput,
  ReservationInput,
  SaleInput,
  StockInInput,
  StockOutInput,
  CreateInventoryInput,
  InventoryResponse,
} from './inventory.types.js';

const isPrismaUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

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

    if (variant.product.status !== 'ACTIVE') {
      throw new AppError(
        'Cannot create inventory for an inactive product',
        409,
        'PRODUCT_NOT_ACTIVE',
      );
    }

    const exists = await this.repository.existsByVariantId(tenantId, input.variantId);

    if (exists) {
      throw new AppError(
        'Inventory already exists for this variant',
        409,
        'INVENTORY_ALREADY_EXISTS',
      );
    }

    const inventory = await this.repository
      .create(tenantId, input.variantId, quantity)
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
    const inventory = await this.repository.findByVariantId(tenantId, variantId);

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

    return prisma.$transaction(async (tx) => {
      const repository = new InventoryRepository(tx);

      await this.ensureInventoryExists(tenantId, repository, inventoryId);

      const affectedRows = await repository.stockIn(
        tenantId,
        inventoryId,
        input.quantity,
      );

      if (affectedRows !== 1) {
        throw new AppError(
          'Unable to increase inventory',
          409,
          'INVENTORY_UPDATE_FAILED',
        );
      }

      await repository.createTransaction(tenantId, {
        inventoryId,
        type: 'STOCK_IN',
        quantity: input.quantity,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
      });

      const inventory = await repository.findById(tenantId, inventoryId);

      if (!inventory) {
        throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
      }

      return mapInventory(inventory);
    });
  }

  /*
   * ==================================================
   * STOCK OUT
   * ==================================================
   */

  async stockOut(tenantId: string, inventoryId: string, input: StockOutInput) {
    this.validatePositiveQuantity(input.quantity);

    return prisma.$transaction(async (tx) => {
      const repository = new InventoryRepository(tx);

      await this.ensureInventoryExists(tenantId, repository, inventoryId);

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

      await repository.createTransaction(tenantId, {
        inventoryId,
        type: 'STOCK_OUT',
        quantity: input.quantity,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
      });

      const inventory = await repository.findById(tenantId, inventoryId);

      if (!inventory) {
        throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
      }

      return mapInventory(inventory);
    });
  }

  /*
   * ==================================================
   * ADJUSTMENT
   * ==================================================
   */

  async adjustment(tenantId: string, inventoryId: string, input: AdjustmentInput) {
    if (!Number.isInteger(input.quantity) || input.quantity === 0) {
      throw new AppError(
        'Adjustment quantity must be a non-zero integer',
        400,
        'INVALID_ADJUSTMENT',
      );
    }

    return prisma.$transaction(async (tx) => {
      const repository = new InventoryRepository(tx);

      await this.ensureInventoryExists(tenantId, repository, inventoryId);

      const affectedRows = await repository.adjustment(
        tenantId,
        inventoryId,
        input.quantity,
      );

      if (affectedRows !== 1) {
        throw new AppError(
          'Inventory adjustment would make physical quantity lower than reserved quantity',
          409,
          'INVALID_INVENTORY_ADJUSTMENT',
        );
      }

      await repository.createTransaction(tenantId, {
        inventoryId,
        type: 'ADJUSTMENT',
        quantity: input.quantity,
        referenceId: input.referenceId ?? null,
        reason: input.reason,
      });

      const inventory = await repository.findById(tenantId, inventoryId);

      if (!inventory) {
        throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
      }

      return mapInventory(inventory);
    });
  }

  /*
   * ==================================================
   * RESERVE
   * ==================================================
   */

  async reserve(tenantId: string, inventoryId: string, input: ReservationInput) {
    this.validatePositiveQuantity(input.quantity);
    this.validateReferenceId(input.referenceId);

    return this.runIdempotentTransaction(
      tenantId,
      inventoryId,
      'RESERVATION',
      input.referenceId,
      input.quantity,
      () =>
        prisma.$transaction(async (tx) => {
          const repository = new InventoryRepository(tx);

          const existing = await repository.findTransactionByReference(
            tenantId,
            inventoryId,
            'RESERVATION',
            input.referenceId,
          );

          if (existing) {
            this.validateIdempotentQuantity(existing.quantity, input.quantity);

            const inventory = await repository.findById(tenantId, inventoryId);

            if (!inventory) {
              throw new AppError(
                'Inventory not found',
                404,
                'INVENTORY_NOT_FOUND',
              );
            }

            return mapInventory(inventory);
          }

          await this.ensureInventoryExists(tenantId, repository, inventoryId);

          const affectedRows = await repository.reserve(
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

          await repository.createTransaction(tenantId, {
            inventoryId,
            type: 'RESERVATION',
            quantity: input.quantity,
            referenceId: input.referenceId,
            reason: input.reason ?? null,
          });

          const inventory = await repository.findById(tenantId, inventoryId);

          if (!inventory) {
            throw new AppError(
              'Inventory not found',
              404,
              'INVENTORY_NOT_FOUND',
            );
          }

          return mapInventory(inventory);
        }),
    );
  }

  /*
   * ==================================================
   * RELEASE
   * ==================================================
   */

  async release(tenantId: string, inventoryId: string, input: ReleaseInput) {
    this.validatePositiveQuantity(input.quantity);
    this.validateReferenceId(input.referenceId);

    return this.runIdempotentTransaction(
      tenantId,
      inventoryId,
      'RELEASE',
      input.referenceId,
      input.quantity,
      () =>
        prisma.$transaction(async (tx) => {
          const repository = new InventoryRepository(tx);

          const existing = await repository.findTransactionByReference(
            tenantId,
            inventoryId,
            'RELEASE',
            input.referenceId,
          );

          if (existing) {
            this.validateIdempotentQuantity(existing.quantity, input.quantity);

            const inventory = await repository.findById(tenantId, inventoryId);

            if (!inventory) {
              throw new AppError(
                'Inventory not found',
                404,
                'INVENTORY_NOT_FOUND',
              );
            }

            return mapInventory(inventory);
          }

          await this.ensureInventoryExists(tenantId, repository, inventoryId);

          const affectedRows = await repository.release(
            tenantId,
            inventoryId,
            input.quantity,
          );

          if (affectedRows !== 1) {
            throw new AppError(
              'Cannot release more inventory than currently reserved',
              409,
              'INVALID_INVENTORY_RELEASE',
            );
          }

          await repository.createTransaction(tenantId, {
            inventoryId,
            type: 'RELEASE',
            quantity: input.quantity,
            referenceId: input.referenceId,
            reason: input.reason ?? null,
          });

          const inventory = await repository.findById(tenantId, inventoryId);

          if (!inventory) {
            throw new AppError(
              'Inventory not found',
              404,
              'INVENTORY_NOT_FOUND',
            );
          }

          return mapInventory(inventory);
        }),
    );
  }

  /*
   * ==================================================
   * SALE
   * ==================================================
   */

  async sale(tenantId: string, inventoryId: string, input: SaleInput) {
    this.validatePositiveQuantity(input.quantity);
    this.validateReferenceId(input.referenceId);

    return this.runIdempotentTransaction(
      tenantId,
      inventoryId,
      'SALE',
      input.referenceId,
      input.quantity,
      () =>
        prisma.$transaction(async (tx) => {
          const repository = new InventoryRepository(tx);

          const existing = await repository.findTransactionByReference(
            tenantId,
            inventoryId,
            'SALE',
            input.referenceId,
          );

          if (existing) {
            this.validateIdempotentQuantity(existing.quantity, input.quantity);

            const inventory = await repository.findById(tenantId, inventoryId);

            if (!inventory) {
              throw new AppError(
                'Inventory not found',
                404,
                'INVENTORY_NOT_FOUND',
              );
            }

            return mapInventory(inventory);
          }

          await this.ensureInventoryExists(tenantId, repository, inventoryId);

          const affectedRows = await repository.sale(
            tenantId,
            inventoryId,
            input.quantity,
          );

          if (affectedRows !== 1) {
            throw new AppError(
              'Cannot complete sale because reserved inventory is insufficient',
              409,
              'INVALID_INVENTORY_SALE',
            );
          }

          await repository.createTransaction(tenantId, {
            inventoryId,
            type: 'SALE',
            quantity: input.quantity,
            referenceId: input.referenceId,
            reason: input.reason ?? null,
          });

          const inventory = await repository.findById(tenantId, inventoryId);

          if (!inventory) {
            throw new AppError(
              'Inventory not found',
              404,
              'INVENTORY_NOT_FOUND',
            );
          }

          return mapInventory(inventory);
        }),
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

  private async runIdempotentTransaction(
    tenantId: string,
    inventoryId: string,
    type: 'RESERVATION' | 'RELEASE' | 'SALE',
    referenceId: string,
    quantity: number,
    operation: () => Promise<InventoryResponse>,
  ): Promise<InventoryResponse> {
    try {
      return await operation();
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }

      const existing = await this.repository.findTransactionByReference(
        tenantId,
        inventoryId,
        type,
        referenceId,
      );

      if (!existing) {
        throw error;
      }

      this.validateIdempotentQuantity(existing.quantity, quantity);

      const inventory = await this.repository.findById(tenantId, inventoryId);

      if (!inventory) {
        throw new AppError('Inventory not found', 404, 'INVENTORY_NOT_FOUND');
      }

      return mapInventory(inventory);
    }
  }

  private validateIdempotentQuantity(
    existingQuantity: number,
    requestedQuantity: number,
  ): void {
    if (existingQuantity !== requestedQuantity) {
      throw new AppError(
        'Reference ID has already been used with a different quantity',
        409,
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
  }

  private validateReferenceId(referenceId: string | undefined): void {
    if (!referenceId || referenceId.trim().length === 0) {
      throw new AppError(
        'Reference ID is required',
        400,
        'REFERENCE_ID_REQUIRED',
      );
    }
  }

  private validateNonNegativeQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new AppError(
        'Quantity must be a non-negative integer',
        400,
        'INVALID_QUANTITY',
      );
    }
  }

  private validatePositiveQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(
        'Quantity must be a positive integer',
        400,
        'INVALID_QUANTITY',
      );
    }
  }
}
