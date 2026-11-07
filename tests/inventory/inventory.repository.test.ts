import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { catalogTenantFixture } from '../helpers/catalog.js';

describe('Inventory repository and transactional service', () => {
  const tenant = catalogTenantFixture();
  const repository = new InventoryRepository(testPrisma);
  const service = new InventoryService(repository);
  let variantId: string;
  let inventoryId: string;
  const referenceId = (label: string) => `${label}-${tenant.id}`;
  const history = () =>
    repository.findTransactions(tenant.id, inventoryId, { page: 1, limit: 20 });

  beforeAll(async () => {
    await tenant.create();
    const category = await testPrisma.category.create({
      data: { tenantId: tenant.id, name: 'Inventory', slug: 'inventory' },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        name: 'Inventory Product',
        slug: 'inventory',
        basePrice: '10.00',
      },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `INV-${tenant.id}`,
        combinationKey: '',
        isDefault: true,
      },
    });
    variantId = variant.id;
    const inventory = await repository.create(tenant.id, variantId, 10);
    inventoryId = inventory.id;
  });

  beforeEach(async () => {
    // Never execute broad cleanup when fixture construction failed.
    if (!inventoryId) throw new Error('Inventory fixture was not created');
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 10, reservedQuantity: 0 },
    });
  });
  afterAll(async () => {
    await tenant.cleanup();
    await testPrisma.$disconnect();
  });

  it('creates inventory and finds it by ID and variant ID', async () => {
    expect(await repository.findById(tenant.id, inventoryId)).toMatchObject({
      id: inventoryId,
      quantity: 10,
    });
    expect(
      await repository.findByVariantId(tenant.id, variantId),
    ).toMatchObject({ id: inventoryId });
    expect(
      await repository.findById(tenant.id, 'missing-inventory'),
    ).toBeNull();
    expect(
      await repository.findByVariantId(tenant.id, 'missing-variant'),
    ).toBeNull();
  });
  it('stocks in quantity and records the transaction atomically', async () => {
    const inventory = await service.stockIn(tenant.id, inventoryId, {
      quantity: 5,
      reason: 'Restock',
      referenceId: referenceId('stock-in'),
    });
    expect(inventory.quantity).toBe(15);
    const transactions = await history();
    expect(transactions.total).toBe(1);
    expect(transactions.items[0]).toMatchObject({
      type: 'STOCK_IN',
      quantity: 5,
      reason: 'Restock',
      referenceId: referenceId('stock-in'),
    });
  });
  it('stocks out only unreserved quantity', async () => {
    await service.reserve(tenant.id, inventoryId, {
      quantity: 6,
      referenceId: referenceId('stock-out-reservation'),
    });
    expect(await repository.stockOut(tenant.id, inventoryId, 5)).toBe(0);
    const inventory = await service.stockOut(tenant.id, inventoryId, {
      quantity: 4,
      reason: 'Damaged',
      referenceId: referenceId('stock-out'),
    });
    expect(inventory).toMatchObject({ quantity: 6, reservedQuantity: 6 });
    expect((await history()).total).toBe(2);
  });
  it('rejects adjustments below reserved stock and records valid adjustments', async () => {
    await service.reserve(tenant.id, inventoryId, {
      quantity: 6,
      referenceId: referenceId('adjustment-reservation'),
    });
    expect(await repository.adjustment(tenant.id, inventoryId, -5)).toBe(0);
    const inventory = await service.adjustment(tenant.id, inventoryId, {
      quantity: -2,
      reason: 'Count correction',
      referenceId: referenceId('adjustment'),
    });
    expect(inventory).toMatchObject({ quantity: 8, reservedQuantity: 6 });
    expect((await history()).total).toBe(2);
  });
  it('reserves available stock once per reference', async () => {
    const input = { quantity: 4, referenceId: referenceId('reservation') };
    expect(await service.reserve(tenant.id, inventoryId, input)).toMatchObject({
      reservedQuantity: 4,
    });
    expect(await service.reserve(tenant.id, inventoryId, input)).toMatchObject({
      reservedQuantity: 4,
    });
    expect((await history()).total).toBe(1);
  });
  it('does not reserve more than available stock', async () => {
    expect(await repository.reserve(tenant.id, inventoryId, 11)).toBe(0);
    expect(await repository.findById(tenant.id, inventoryId)).toMatchObject({
      quantity: 10,
      reservedQuantity: 0,
    });
    expect((await history()).total).toBe(0);
  });
  it('releases reserved stock and rejects excessive releases', async () => {
    await service.reserve(tenant.id, inventoryId, {
      quantity: 4,
      referenceId: referenceId('release-reservation'),
    });
    expect(await repository.release(tenant.id, inventoryId, 5)).toBe(0);
    const inventory = await service.release(tenant.id, inventoryId, {
      quantity: 3,
      referenceId: referenceId('release'),
    });
    expect(inventory).toMatchObject({ quantity: 10, reservedQuantity: 1 });
  });
  it('completes sales from reserved stock and rejects excess sales', async () => {
    await service.reserve(tenant.id, inventoryId, {
      quantity: 4,
      referenceId: referenceId('sale-reservation'),
    });
    expect(await repository.sale(tenant.id, inventoryId, 5)).toBe(0);
    const inventory = await service.sale(tenant.id, inventoryId, {
      quantity: 3,
      referenceId: referenceId('sale'),
    });
    expect(inventory).toMatchObject({ quantity: 7, reservedQuantity: 1 });
  });
  it('returns transactions newest first', async () => {
    await service.stockIn(tenant.id, inventoryId, {
      quantity: 1,
      referenceId: referenceId('history-stock-in'),
    });
    await service.adjustment(tenant.id, inventoryId, {
      quantity: 1,
      reason: 'Count',
      referenceId: referenceId('history-adjustment'),
    });
    const transactions = await history();
    expect(transactions.total).toBe(2);
    const [newer, older] = transactions.items;
    expect(newer).toBeDefined();
    expect(older).toBeDefined();
    expect(newer!.createdAt.getTime()).toBeGreaterThanOrEqual(
      older!.createdAt.getTime(),
    );
    expect(
      await repository.findTransactions(tenant.id, 'missing-inventory', {
        page: 1,
        limit: 20,
      }),
    ).toEqual({ items: [], total: 0 });
  });
});
