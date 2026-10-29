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
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../src/generated/prisma/client.js';
import { testPrisma } from '../../src/config/test-database.js';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';
import { OrderService } from '../../src/modules/orders/order.service.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';

const enabled = process.env.RUN_RESERVATION_LIFECYCLE_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
const fixture = `reservation-lifecycle-${crypto.randomUUID()}`;

suite('inventory reservation lifecycle against PostgreSQL', () => {
  let tenantId: string;
  let userId: string;
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let inventoryId: string;
  let orderId: string | undefined;

  const payments = new PaymentService();
  const orders = new OrderService();

  beforeAll(async () => {
    const [user, tenant] = await Promise.all([
      testPrisma.user.create({
        data: {
          email: `${fixture}@example.test`,
          passwordHash: 'integration-test',
          firstName: 'Lifecycle',
          lastName: 'Tester',
        },
      }),
      testPrisma.tenant.create({
        data: { name: 'Lifecycle Tenant', slug: fixture, code: fixture },
      }),
    ]);
    userId = user.id;
    tenantId = tenant.id;

    const category = await testPrisma.category.create({
      data: {
        tenantId,
        name: 'Lifecycle Category',
        slug: `${fixture}-category`,
      },
    });
    categoryId = category.id;
    const product = await testPrisma.product.create({
      data: {
        tenantId,
        categoryId,
        name: 'Lifecycle Product',
        slug: `${fixture}-product`,
        basePrice: 10,
        status: 'ACTIVE',
      },
    });
    productId = product.id;
    const variant = await testPrisma.productVariant.create({
      data: {
        productId,
        sku: `${fixture}-sku`,
        combinationKey: 'default',
        isActive: true,
      },
    });
    variantId = variant.id;
    const inventory = await testPrisma.inventory.create({
      data: { variantId, quantity: 10, reservedQuantity: 0 },
    });
    inventoryId = inventory.id;
  });

  const cleanState = async () => {
    await testPrisma.checkoutRequest.deleteMany({ where: { userId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 10, reservedQuantity: 0 },
    });
    orderId = undefined;
  };

  beforeEach(async () => cleanState());
  afterEach(async () => cleanState());

  afterAll(async () => {
    await cleanState();
    await testPrisma.product.delete({ where: { id: productId } });
    await testPrisma.category.delete({ where: { id: categoryId } });
    await testPrisma.tenant.delete({ where: { id: tenantId } });
    await testPrisma.user.delete({ where: { id: userId } });
  });

  const createReservedOrder = async (quantity = 3) => {
    const order = await testPrisma.order.create({
      data: {
        tenantId,
        orderNumber: `${fixture}-${crypto.randomUUID()}`,
        userId,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        currency: 'USD',
        subtotal: 10 * quantity,
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        totalAmount: 10 * quantity,
        shippingAddress: { countryCode: 'US', city: 'Test City' },
        billingAddress: { countryCode: 'US', city: 'Test City' },
        items: {
          create: {
            productId,
            variantId,
            productName: 'Lifecycle Product',
            sku: `${fixture}-sku`,
            quantity,
            unitPrice: 10,
            itemDiscountAmount: 0,
            finalUnitPrice: 10,
            totalPrice: 10 * quantity,
            taxableAmount: 10 * quantity,
            taxAmount: 0,
            variantSnapshot: { sku: `${fixture}-sku` },
          },
        },
      },
    });
    orderId = order.id;

    await testPrisma.$transaction(async (tx) => {
      const repository = new InventoryRepository(tx);
      const updated = await repository.reserve(tenantId, inventoryId, quantity);
      expect(updated).toBe(1);
      await repository.createTransaction(tenantId, {
        inventoryId,
        type: 'RESERVATION',
        quantity,
        referenceId: order.id,
      });
    });

    const payment = await testPrisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.NONE,
        method: PaymentMethod.CARD,
        status: PaymentStatus.PENDING,
        amount: 10 * quantity,
        currency: 'USD',
      },
    });
    return { order, payment };
  };

  it('reserves stock without reducing physical quantity', async () => {
    await testPrisma.$transaction(async (tx) => {
      const repository = new InventoryRepository(tx);
      expect(await repository.reserve(tenantId, inventoryId, 3)).toBe(1);
      await repository.createTransaction(tenantId, {
        inventoryId,
        type: 'RESERVATION',
        quantity: 3,
        referenceId: `${fixture}-reservation`,
      });
    });
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(inventory).toMatchObject({ quantity: 10, reservedQuantity: 3 });
    expect(inventory.quantity - inventory.reservedQuantity).toBe(7);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RESERVATION' },
      }),
    ).toBe(1);
  });

  it('commits a successful payment as a sale and clears the reservation', async () => {
    const { payment } = await createReservedOrder();
    await payments.updatePaymentStatus(tenantId, payment.id, {
      status: PaymentStatus.PAID,
    });
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(inventory).toMatchObject({ quantity: 7, reservedQuantity: 0 });
    expect(inventory.quantity - inventory.reservedQuantity).toBe(7);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RESERVATION', referenceId: orderId },
      }),
    ).toBe(1);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: orderId, quantity: 3 },
      }),
    ).toBe(1);
    expect(
      (await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } }))
        .paymentStatus,
    ).toBe(PaymentStatus.PAID);
  });

  it('releases stock on payment failure without consuming physical quantity', async () => {
    const { payment } = await createReservedOrder();
    await payments.updatePaymentStatus(tenantId, payment.id, {
      status: PaymentStatus.FAILED,
    });
    await expect(
      payments.updatePaymentStatus(tenantId, payment.id, {
        status: PaymentStatus.PENDING,
      }),
    ).rejects.toMatchObject({
      code: 'ORDER_INVENTORY_RESERVATION_RELEASED',
      statusCode: 409,
    });
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(inventory).toMatchObject({ quantity: 10, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: {
          inventoryId,
          type: 'RELEASE',
          referenceId: orderId,
          quantity: 3,
        },
      }),
    ).toBe(1);
  });

  it('releases a pre-payment cancellation only once', async () => {
    await createReservedOrder();
    await orders.updateStatus(tenantId, orderId!, {
      status: OrderStatus.CANCELLED,
    });
    await orders.updateStatus(tenantId, orderId!, {
      status: OrderStatus.CANCELLED,
    });
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(inventory).toMatchObject({ quantity: 10, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('expires a pending unpaid order and does not release its reservation twice', async () => {
    await createReservedOrder();
    await orders.expirePendingOrder(tenantId, orderId!);
    await orders.expirePendingOrder(tenantId, orderId!);
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(inventory).toMatchObject({ quantity: 10, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: orderId },
      }),
    ).toBe(1);
    expect(
      (await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } }))
        .status,
    ).toBe(OrderStatus.CANCELLED);
  });

  it('releases only once when payment failure races pending-order expiration', async () => {
    const { payment } = await createReservedOrder();
    const results = await Promise.allSettled([
      payments.updatePaymentStatus(tenantId, payment.id, {
        status: PaymentStatus.FAILED,
      }),
      orders.expirePendingOrder(tenantId, orderId!),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(inventory).toMatchObject({ quantity: 10, reservedQuantity: 0 });
    expect(inventory.reservedQuantity).toBeGreaterThanOrEqual(0);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('rejects cancellation of a paid order without releasing sold inventory', async () => {
    const { payment } = await createReservedOrder();
    await payments.updatePaymentStatus(tenantId, payment.id, {
      status: PaymentStatus.PAID,
    });
    await expect(
      orders.updateStatus(tenantId, orderId!, {
        status: OrderStatus.CANCELLED,
      }),
    ).rejects.toMatchObject({
      code: 'PAID_ORDER_CANCELLATION_REQUIRES_REFUND',
    });
    const inventory = await testPrisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });
    expect(inventory).toMatchObject({ quantity: 7, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE', referenceId: orderId },
      }),
    ).toBe(0);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('rejects a reservation larger than remaining available stock', async () => {
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 10, reservedQuantity: 8 },
    });
    const affectedRows = await new InventoryRepository(testPrisma).reserve(
      tenantId,
      inventoryId,
      3,
    );
    expect(affectedRows).toBe(0);
    expect(
      await testPrisma.inventory.findUniqueOrThrow({
        where: { id: inventoryId },
      }),
    ).toMatchObject({ quantity: 10, reservedQuantity: 8 });
  });
});
