import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  PaymentMethod,
  PaymentProvider,
} from '../../src/generated/prisma/client.js';
import { AppError } from '../../src/common/errors/app-error.js';
import { testPrisma } from '../../src/config/test-database.js';
import { CheckoutService } from '../../src/modules/checkout/checkout.service.js';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';

const enabled = process.env.RUN_INVENTORY_CONCURRENCY_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
const fixture = `inventory-concurrency-${crypto.randomUUID()}`;

suite('inventory concurrency against PostgreSQL', () => {
  let countryCode: string;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;
  let addressAId: string;
  let addressBId: string;
  let categoryAId: string;
  let categoryBId: string;
  let productAId: string;
  let productBId: string;
  let variantAId: string;
  let variantBId: string;
  let inventoryAId: string;
  let inventoryBId: string;
  let cartAId: string;
  let cartBId: string;
  let taxCategoryAId: string;

  beforeAll(async () => {
    const country = await testPrisma.country.create({
      data: {
        code: `I${crypto.randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase()}`,
        name: 'Inventory Concurrency Test Country',
        currencyCode: 'USD',
      },
    });
    countryCode = country.code;

    const [tenantA, tenantB] = await Promise.all([
      testPrisma.tenant.create({
        data: {
          name: 'Inventory Tenant A',
          slug: `${fixture}-a`,
          code: `${fixture}-a`,
          defaultCurrency: 'USD',
        },
      }),
      testPrisma.tenant.create({
        data: {
          name: 'Inventory Tenant B',
          slug: `${fixture}-b`,
          code: `${fixture}-b`,
          defaultCurrency: 'USD',
        },
      }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const [userA, userB] = await Promise.all([
      testPrisma.user.create({
        data: {
          email: `${fixture}-a@example.test`,
          passwordHash: 'integration-test',
          firstName: 'Buyer',
          lastName: 'A',
        },
      }),
      testPrisma.user.create({
        data: {
          email: `${fixture}-b@example.test`,
          passwordHash: 'integration-test',
          firstName: 'Buyer',
          lastName: 'B',
        },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;

    const [addressA, addressB] = await Promise.all([
      testPrisma.address.create({
        data: {
          userId: userAId,
          firstName: 'Buyer',
          lastName: 'A',
          addressLine1: '1 Test Street',
          city: 'Test City',
          countryCode,
        },
      }),
      testPrisma.address.create({
        data: {
          userId: userBId,
          firstName: 'Buyer',
          lastName: 'B',
          addressLine1: '2 Test Street',
          city: 'Test City',
          countryCode,
        },
      }),
    ]);
    addressAId = addressA.id;
    addressBId = addressB.id;

    const [categoryA, categoryB] = await Promise.all([
      testPrisma.category.create({
        data: {
          tenantId: tenantAId,
          name: 'Inventory Category A',
          slug: `${fixture}-category-a`,
        },
      }),
      testPrisma.category.create({
        data: {
          tenantId: tenantBId,
          name: 'Inventory Category B',
          slug: `${fixture}-category-b`,
        },
      }),
    ]);
    categoryAId = categoryA.id;
    categoryBId = categoryB.id;

    const [taxCategoryA] = await Promise.all([
      testPrisma.taxCategory.create({
        data: {
          tenantId: tenantAId,
          code: `${fixture}-standard`,
          name: 'Standard tax',
        },
      }),
    ]);
    taxCategoryAId = taxCategoryA.id;

    const [productA, productB] = await Promise.all([
      testPrisma.product.create({
        data: {
          tenantId: tenantAId,
          categoryId: categoryAId,
          name: 'Concurrent Product A',
          slug: `${fixture}-product-a`,
          basePrice: 20,
          status: 'ACTIVE',
          taxCategoryId: taxCategoryAId,
        },
      }),
      testPrisma.product.create({
        data: {
          tenantId: tenantBId,
          categoryId: categoryBId,
          name: 'Tenant B Product',
          slug: `${fixture}-product-b`,
          basePrice: 20,
          status: 'ACTIVE',
        },
      }),
    ]);
    productAId = productA.id;
    productBId = productB.id;

    const [variantA, variantB] = await Promise.all([
      testPrisma.productVariant.create({
        data: {
          productId: productAId,
          sku: `${fixture}-sku-a`,
          combinationKey: 'default',
          isActive: true,
          taxCategoryId: taxCategoryAId,
        },
      }),
      testPrisma.productVariant.create({
        data: {
          productId: productBId,
          sku: `${fixture}-sku-b`,
          combinationKey: 'default',
          isActive: true,
        },
      }),
    ]);
    variantAId = variantA.id;
    variantBId = variantB.id;

    const [inventoryA, inventoryB] = await Promise.all([
      testPrisma.inventory.create({
        data: { variantId: variantAId, quantity: 5, reservedQuantity: 0 },
      }),
      testPrisma.inventory.create({
        data: { variantId: variantBId, quantity: 5, reservedQuantity: 0 },
      }),
    ]);
    inventoryAId = inventoryA.id;
    inventoryBId = inventoryB.id;

    const [cartA, cartB] = await Promise.all([
      testPrisma.cart.create({
        data: { tenantId: tenantAId, userId: userAId },
      }),
      testPrisma.cart.create({
        data: { tenantId: tenantAId, userId: userBId },
      }),
    ]);
    cartAId = cartA.id;
    cartBId = cartB.id;

    await testPrisma.taxProfile.create({
      data: {
        tenantId: tenantAId,
        countryCode,
        currency: 'USD',
        pricesIncludeTax: false,
        defaultTaxCategoryId: taxCategoryAId,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategoryAId, countryCode, rate: 0 },
    });
    const shippingProfile = await testPrisma.shippingProfile.create({
      data: { tenantId: tenantAId, countryCode, currency: 'USD' },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: shippingProfile.id,
        code: `${fixture}-zone`,
        name: 'Test Zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: `${fixture}-standard`, name: 'Standard' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 0 },
    });
  });

  const resetState = async () => {
    await testPrisma.checkoutRequest.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: tenantAId } },
    });
    await testPrisma.order.deleteMany({ where: { tenantId: tenantAId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId: { in: [inventoryAId, inventoryBId] } },
    });
    await testPrisma.inventory.updateMany({
      where: { id: { in: [inventoryAId, inventoryBId] } },
      data: { quantity: 5, reservedQuantity: 0 },
    });
    await testPrisma.cartItem.deleteMany({
      where: { cartId: { in: [cartAId, cartBId] } },
    });
  };

  beforeEach(async () => resetState());
  afterEach(async () => resetState());

  afterAll(async () => {
    await resetState();
    await testPrisma.cart.deleteMany({
      where: { id: { in: [cartAId, cartBId] } },
    });
    await testPrisma.address.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    });
    await testPrisma.product.deleteMany({
      where: { id: { in: [productAId, productBId] } },
    });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: tenantAId } },
    });
    await testPrisma.taxProfile.deleteMany({ where: { tenantId: tenantAId } });
    await testPrisma.shippingProfile.deleteMany({
      where: { tenantId: tenantAId },
    });
    await testPrisma.taxCategory.deleteMany({ where: { id: taxCategoryAId } });
    await testPrisma.category.deleteMany({
      where: { id: { in: [categoryAId, categoryBId] } },
    });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantAId, tenantBId] } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } },
    });
    await testPrisma.country.delete({ where: { code: countryCode } });
  });

  const reserveInTransaction = async (
    tenantId: string,
    inventoryId: string,
    quantity: number,
    referenceId: string,
  ) =>
    testPrisma.$transaction(async (tx) => {
      const repository = new InventoryRepository(tx);
      const affectedRows = await repository.reserve(
        tenantId,
        inventoryId,
        quantity,
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
        quantity,
        referenceId,
      });
    });

  it('reserves exact available stock and records its inventory transaction', async () => {
    await reserveInTransaction(tenantAId, inventoryAId, 5, `${fixture}-exact`);
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryAId },
    });
    expect(inventory.quantity - inventory.reservedQuantity).toBe(0);
    expect(inventory.reservedQuantity).toBe(5);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId: inventoryAId, type: 'RESERVATION' },
      }),
    ).toBe(1);
  });

  it('rejects a request above available stock without changing inventory', async () => {
    await expect(
      reserveInTransaction(tenantAId, inventoryAId, 6, `${fixture}-over`),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_INVENTORY',
      statusCode: 409,
    });
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryAId },
    });
    expect(inventory).toMatchObject({ quantity: 5, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId: inventoryAId },
      }),
    ).toBe(0);
  });

  it('allows exactly one of two concurrent reservations that each request four of five units', async () => {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attempt = (label: string) =>
      testPrisma.$transaction(async (tx) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
        const repository = new InventoryRepository(tx);
        const affectedRows = await repository.reserve(
          tenantAId,
          inventoryAId,
          4,
        );
        if (affectedRows !== 1) {
          throw new AppError(
            'Insufficient available inventory',
            409,
            'INSUFFICIENT_INVENTORY',
          );
        }
        await repository.createTransaction(tenantAId, {
          inventoryId: inventoryAId,
          type: 'RESERVATION',
          quantity: 4,
          referenceId: `${fixture}-${label}`,
        });
      });

    const results = await Promise.allSettled([
      attempt('concurrent-a'),
      attempt('concurrent-b'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryAId },
    });
    expect(inventory.quantity - inventory.reservedQuantity).toBe(1);
    expect(inventory.quantity).toBe(5);
    expect(inventory.reservedQuantity).toBe(4);
    expect(inventory.reservedQuantity).toBeLessThanOrEqual(inventory.quantity);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId: inventoryAId, type: 'RESERVATION' },
      }),
    ).toBe(1);
  });

  it('does not allow one tenant to reserve another tenant inventory', async () => {
    const affectedRows = await new InventoryRepository(testPrisma).reserve(
      tenantAId,
      inventoryBId,
      1,
    );
    expect(affectedRows).toBe(0);
    expect(
      await testPrisma.inventory.findUniqueOrThrow({
        where: { id: inventoryBId },
      }),
    ).toMatchObject({ quantity: 5, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId: inventoryBId },
      }),
    ).toBe(0);
  });

  it('allows exactly one of two concurrent checkouts to reserve shared stock', async () => {
    await testPrisma.cartItem.createMany({
      data: [
        { cartId: cartAId, variantId: variantAId, quantity: 4 },
        { cartId: cartBId, variantId: variantAId, quantity: 4 },
      ],
    });
    const checkout = (userId: string, addressId: string) =>
      new CheckoutService().checkout(
        {
          shippingAddressId: addressId,
          billingSameAsShipping: true,
          paymentMethod: PaymentMethod.CARD,
          paymentProvider: PaymentProvider.NONE,
          currency: 'USD',
          shippingMethodCode: `${fixture}-standard`,
        },
        {
          tenantId: tenantAId,
          userId,
          idempotencyKey: `${crypto.randomUUID()}-checkout-key`,
        },
      );

    const results = await Promise.allSettled([
      checkout(userAId, addressAId),
      checkout(userBId, addressBId),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await testPrisma.order.count({ where: { tenantId: tenantAId } }),
    ).toBe(1);
    expect(
      await testPrisma.payment.count({
        where: { order: { tenantId: tenantAId } },
      }),
    ).toBe(1);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId: inventoryAId, type: 'RESERVATION' },
      }),
    ).toBe(1);
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryAId },
    });
    expect(inventory.quantity - inventory.reservedQuantity).toBe(1);
    expect(inventory.reservedQuantity).toBeLessThanOrEqual(inventory.quantity);

    const committedRequest = await testPrisma.checkoutRequest.findFirstOrThrow({
      where: { userId: { in: [userAId, userBId] } },
      select: { userId: true },
    });
    const failedUserId =
      committedRequest.userId === userAId ? userBId : userAId;
    const successfulCartId =
      committedRequest.userId === userAId ? cartAId : cartBId;
    const failedCartId = failedUserId === userAId ? cartAId : cartBId;
    expect(
      await testPrisma.cartItem.count({ where: { cartId: successfulCartId } }),
    ).toBe(0);
    expect(
      await testPrisma.cartItem.count({ where: { cartId: failedCartId } }),
    ).toBe(1);
    expect(
      await testPrisma.checkoutRequest.count({
        where: { userId: failedUserId },
      }),
    ).toBe(0);
    const order = await testPrisma.order.findFirstOrThrow({
      where: { tenantId: tenantAId },
    });
    expect(
      await testPrisma.payment.count({ where: { orderId: order.id } }),
    ).toBe(1);
  });
});
