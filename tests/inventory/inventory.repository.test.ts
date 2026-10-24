import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';

import { createCategoryRepository } from '../../src/modules/categories/category.repository.js';

import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';

import { createProductRepository } from '../../src/modules/products/product.repository.js';

describe('Inventory repository', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const categorySlug = `inventory-repository-${runId}`;
  const productSlug = `inventory-repository-${runId}`;
  const productSku = `INVENTORY-REPOSITORY-${runId}`;

  const categoryRepository = createCategoryRepository(testPrisma);
  const productRepository = createProductRepository(testPrisma);
  const repository = new InventoryRepository(testPrisma);

  let categoryId: string;
  let productId: string;
  let inventoryId: string;

  const referenceId = (label: string) => `${label}-${runId}`;

  beforeAll(async () => {
    await testPrisma.$connect();

    const category = await categoryRepository.create({
      name: 'Inventory Repository Test',
      slug: categorySlug,
    });
    categoryId = category.id;

    const product = await productRepository.create({
      name: 'Inventory Repository Test Product',
      slug: productSlug,
      sku: productSku,
      price: '10.00',
      categoryId,
    });
    productId = product.id;

    const inventory = await repository.create(productId, 10);
    inventoryId = inventory.id;
  });

  beforeEach(async () => {
    await testPrisma.inventoryTransaction.deleteMany({
      where: {
        inventoryId,
      },
    });
    await testPrisma.inventory.update({
      where: {
        id: inventoryId,
      },
      data: {
        quantity: 10,
        reservedQuantity: 0,
      },
    });
  });

  afterAll(async () => {
    if (productId) {
      await testPrisma.product.delete({
        where: {
          id: productId,
        },
      });
    }

    if (categoryId) {
      await testPrisma.category.delete({
        where: {
          id: categoryId,
        },
      });
    }

    await testPrisma.$disconnect();
  });

  it('creates inventory and finds it by ID and product ID', async () => {
    const byId = await repository.findById(inventoryId);
    const byProductId = await repository.findByProductId(productId);

    expect(byId?.id).toBe(inventoryId);
    expect(byId?.quantity).toBe(10);
    expect(byProductId?.id).toBe(inventoryId);
    expect(await repository.findById('missing-inventory')).toBeNull();
    expect(await repository.findByProductId('missing-product')).toBeNull();
  });

  it('stocks in quantity and records the transaction', async () => {
    const inventory = await repository.stockIn(productId, 5, {
      reason: 'Restock',
      referenceId: referenceId('stock-in'),
    });
    const transactions = await repository.getTransactions(productId);

    expect(inventory?.quantity).toBe(15);
    expect(transactions).toHaveLength(1);
    expect(transactions?.[0]).toMatchObject({
      type: 'STOCK_IN',
      quantity: 5,
      reason: 'Restock',
      referenceId: referenceId('stock-in'),
    });
  });

  it('stocks out only unreserved quantity', async () => {
    await repository.reserve(
      productId,
      6,
      referenceId('stock-out-reservation'),
    );

    expect(await repository.stockOut(productId, 5, {})).toBeNull();

    const inventory = await repository.stockOut(productId, 4, {
      reason: 'Damaged',
      referenceId: referenceId('stock-out'),
    });

    expect(inventory?.quantity).toBe(6);
    expect(inventory?.reservedQuantity).toBe(6);
  });

  it('rejects adjustments below reserved stock and records valid adjustments', async () => {
    await repository.reserve(
      productId,
      6,
      referenceId('adjustment-reservation'),
    );

    expect(
      await repository.adjust(productId, -5, { reason: 'Count correction' }),
    ).toBeNull();

    const inventory = await repository.adjust(productId, -2, {
      reason: 'Count correction',
      referenceId: referenceId('adjustment'),
    });

    expect(inventory?.quantity).toBe(8);
    expect(inventory?.reservedQuantity).toBe(6);
    expect(await repository.getTransactions(productId)).toHaveLength(2);
  });

  it('reserves available stock once per reference', async () => {
    const reference = referenceId('reservation');
    const first = await repository.reserve(productId, 4, reference);
    const repeated = await repository.reserve(productId, 4, reference);

    expect(first?.reservedQuantity).toBe(4);
    expect(repeated?.reservedQuantity).toBe(4);
    expect(await repository.getTransactions(productId)).toHaveLength(1);
  });

  it('does not reserve more than the available stock', async () => {
    const inventory = await repository.reserve(
      productId,
      11,
      referenceId('excess-reservation'),
    );

    expect(inventory).toBeNull();
    expect(await repository.getTransactions(productId)).toHaveLength(0);
  });

  it('releases reserved stock and rejects excessive releases', async () => {
    await repository.reserve(productId, 4, referenceId('release-reservation'));

    expect(
      await repository.release(productId, 5, referenceId('release')),
    ).toBeNull();

    const inventory = await repository.release(
      productId,
      3,
      referenceId('release'),
    );

    expect(inventory?.quantity).toBe(10);
    expect(inventory?.reservedQuantity).toBe(1);
  });

  it('completes sales from reserved stock and rejects excess sales', async () => {
    await repository.reserve(productId, 4, referenceId('sale-reservation'));

    expect(await repository.sale(productId, 5, referenceId('sale'))).toBeNull();

    const inventory = await repository.sale(productId, 3, referenceId('sale'));

    expect(inventory?.quantity).toBe(7);
    expect(inventory?.reservedQuantity).toBe(1);
  });

  it('returns transactions newest first', async () => {
    await repository.stockIn(productId, 1, {
      referenceId: referenceId('history-stock-in'),
    });
    await repository.adjust(productId, 1, {
      referenceId: referenceId('history-adjustment'),
    });

    const transactions = await repository.getTransactions(productId);

    expect(transactions).toHaveLength(2);
    expect(transactions?.[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
      transactions?.[1]?.createdAt.getTime() ?? 0,
    );
    expect(await repository.getTransactions('missing-product')).toBeNull();
  });
});
