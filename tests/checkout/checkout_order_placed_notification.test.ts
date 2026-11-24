import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import { CheckoutService } from '../../src/modules/checkout/checkout.service.js';
import { PaymentMethod } from '../../src/generated/prisma/client.js';
import { env } from '../../src/config/env.js';
import {
  createCartFixture,
  createInventoryFixture,
  createShippingProfileFixture,
  deleteFixtureTenant,
} from '../helpers/warehouse.js';

describe('Phase 2.2: Real Checkout ORDER_PLACED Notification Integration Tests', () => {
  let tenantId: string;
  let tenantSlug: string;
  let userId: string;
  let countryCode: string;
  let addressId: string;
  let variantId: string;
  let inventoryId: string;
  let taxCategory: any;

  const fixtureSlug = `chk-notif-${Date.now()}`;

  beforeAll(async () => {
    const testDbUrl = env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for integration tests');
    }
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SECURITY GUARD REJECTION: Integration tests must not run in production',
      );
    }

    const dbNameResult =
        await testPrisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database();
    `;
    const effectiveDbName = dbNameResult[0]?.current_database ?? '';
    const expectedDbName = new URL(testDbUrl).pathname.replace(/^\//, '');

    if (
      effectiveDbName === 'commerce_api_dev' ||
      effectiveDbName.endsWith('_dev') ||
      (effectiveDbName !== 'commerce_api_test' &&
        !/^commerce_api_test_phase1b_[a-f0-9]{32}$/.test(effectiveDbName)) ||
      effectiveDbName !== expectedDbName
    ) {
      throw new Error(
        `SECURITY GUARD REJECTION: Effective DB "${effectiveDbName}" is not isolated test DB ("${expectedDbName}").`,
      );
    }

    const country = await testPrisma.country.create({
      data: {
        code: `K${crypto.randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase()}`,
        name: 'Notification Test Country',
        currencyCode: 'USD',
      },
    });
    countryCode = country.code;

    const user = await testPrisma.user.create({
      data: {
        email: `${fixtureSlug}@example.test`,
        passwordHash: 'integration-test',
        firstName: 'Checkout',
        lastName: 'NotificationTester',
      },
    });
    userId = user.id;

    const tenant = await testPrisma.tenant.create({
      data: {
        name: 'Checkout Real Notification Tenant',
        slug: fixtureSlug,
        code: fixtureSlug,
        defaultCurrency: 'USD',
      },
    });
    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const address = await testPrisma.address.create({
      data: {
        userId,
        firstName: 'Checkout',
        lastName: 'Tester',
        addressLine1: '1 Notification Street',
        city: 'Test City',
        countryCode,
        latitude: 30,
        longitude: 31,
      },
    });
    addressId = address.id;

    const category = await testPrisma.category.create({
      data: {
        tenantId,
        name: 'Notification Category',
        slug: `${fixtureSlug}-category`,
      },
    });

    const product = await testPrisma.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Notification Product',
        slug: `${fixtureSlug}-product`,
        basePrice: 20,
        status: 'ACTIVE',
      },
    });

    taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId, code: `${fixtureSlug}-tax`, name: 'Standard Tax' },
    });

    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${fixtureSlug}-sku`,
        combinationKey: 'default',
        isActive: true,
        taxCategoryId: taxCategory.id,
      },
    });
    variantId = variant.id;

    const inventory = await createInventoryFixture({
      data: { variantId, quantity: 50, reservedQuantity: 0 },
    });
    inventoryId = inventory.id;

    await testPrisma.taxProfile.create({
      data: {
        tenantId,
        countryCode,
        currency: 'USD',
        pricesIncludeTax: false,
        defaultTaxCategoryId: taxCategory.id,
      },
    });

    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: 0 },
    });

    const shippingProfile = await createShippingProfileFixture({
      data: {
        tenantId,
        countryCode,
        currency: 'USD',
        originLatitude: 30,
        originLongitude: 31,
      },
    });

    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: shippingProfile.id,
        code: `${fixtureSlug}-zone`,
        name: 'Test Zone',
        countryCode,
      },
    });

    const method = await testPrisma.shippingMethod.create({
      data: {
        zoneId: zone.id,
        code: 'standard',
        name: 'Standard Delivery',
      },
    });

    await testPrisma.shippingRule.create({
      data: {
        methodId: method.id,
        flatRate: 5,
        maxDistanceKm: 100,
      },
    });
  });

  afterAll(async () => {
    if (tenantId) {
      await testPrisma.notification.deleteMany({ where: { tenantId } });
      await testPrisma.checkoutRequest.deleteMany({ where: { tenantId } });
      await testPrisma.orderStatusHistory.deleteMany({
        where: { order: { tenantId } },
      });
      await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
      await testPrisma.orderItem.deleteMany({
        where: { order: { tenantId } },
      });
      await testPrisma.order.deleteMany({ where: { tenantId } });
      await testPrisma.shippingRule.deleteMany({
        where: { method: { zone: { profile: { tenantId } } } },
      });
      await testPrisma.shippingMethod.deleteMany({
        where: { zone: { profile: { tenantId } } },
      });
      await testPrisma.shippingZone.deleteMany({
        where: { profile: { tenantId } },
      });
      await testPrisma.shippingProfile.deleteMany({ where: { tenantId } });
      await testPrisma.taxRule.deleteMany({
        where: { taxCategoryId: taxCategory.id },
      });
      await testPrisma.taxProfile.deleteMany({ where: { tenantId } });
      await testPrisma.productVariant.deleteMany({
        where: { product: { tenantId } },
      });
      await testPrisma.product.deleteMany({ where: { tenantId } });
      await testPrisma.taxCategory.deleteMany({ where: { tenantId } });
      await testPrisma.category.deleteMany({ where: { tenantId } });
      await deleteFixtureTenant({ where: { id: tenantId } });
    }
    if (userId) {
      await testPrisma.address.deleteMany({ where: { userId } });
      await testPrisma.user.deleteMany({ where: { id: userId } });
    }
    if (countryCode) {
      await testPrisma.country.deleteMany({ where: { code: countryCode } });
    }
  });

  const createCart = async () => {
    let cart = await testPrisma.cart.findFirst({
      where: { tenantId, userId },
    });
    if (!cart) {
      cart = await createCartFixture({ data: { tenantId, userId } });
    }
    await testPrisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await testPrisma.cartItem.create({
      data: {
        cartId: cart.id,
        variantId,
        quantity: 1,
      },
    });
    return cart;
  };

  it('1. Real Cash on Delivery checkout creates exactly one ORDER_PLACED notification', async () => {
    await createCart();

    const idempotencyKey = `idemp_cod_${Date.now()}`;
    const checkoutService = new CheckoutService();

    const result = await checkoutService.checkout(
      {
        shippingAddressId: addressId,
        billingAddressId: addressId,
        billingSameAsShipping: true,
        shippingMethodCode: 'standard',
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
      },
      {
        tenantId,
        userId,
        idempotencyKey,
      },
    );

    expect(result.order).not.toBeNull();
    expect(result.order.status).toBe('CONFIRMED');
    expect(result.idempotent).toBe(false);

    const notifs = await testPrisma.notification.findMany({
      where: {
        tenantId,
        userId,
        eventKey: `order_placed_${result.order.id}`,
      },
    });

    expect(notifs.length).toBe(1);
    const notif = notifs[0]!;
    expect(notif.tenantId).toBe(tenantId);
    expect(notif.userId).toBe(userId);
    expect(notif.eventKey).toBe(`order_placed_${result.order.id}`);
    expect(notif.type).toBe('ORDER');
    expect(notif.title).toBe(`Order Placed: #${result.order.orderNumber}`);
    expect(notif.body).toBe(
      `Your order #${result.order.orderNumber} has been placed successfully.`,
    );
    expect(notif.data).toEqual({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      eventType: 'ORDER_PLACED',
      tenantSlug,
    });
  });

  it('2. Real Prepaid (CARD) checkout creates ORDER_PLACED notification with PENDING payment status', async () => {
    await createCart();

    const idempotencyKey = `idemp_card_${Date.now()}`;
    const checkoutService = new CheckoutService();

    const result = await checkoutService.checkout(
      {
        shippingAddressId: addressId,
        billingAddressId: addressId,
        billingSameAsShipping: true,
        shippingMethodCode: 'standard',
        paymentMethod: PaymentMethod.CARD,
      },
      {
        tenantId,
        userId,
        idempotencyKey,
      },
    );

    expect(result.order.status).toBe('PENDING');
    expect(result.order.paymentStatus).toBe('PENDING');

    const notif = await testPrisma.notification.findFirst({
      where: {
        tenantId,
        userId,
        eventKey: `order_placed_${result.order.id}`,
      },
    });

    expect(notif).not.toBeNull();
    expect(notif!.tenantId).toBe(tenantId);
    expect(notif!.userId).toBe(userId);
    expect(notif!.eventKey).toBe(`order_placed_${result.order.id}`);
    expect(notif!.title).toBe(`Order Placed: #${result.order.orderNumber}`);
    expect(notif!.data).toEqual({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      eventType: 'ORDER_PLACED',
      tenantSlug,
    });
  });

  it('3. Replaying checkout with same idempotencyKey returns existing order without creating duplicate notification', async () => {
    await createCart();

    const idempotencyKey = `idemp_replay_${Date.now()}`;
    const checkoutService = new CheckoutService();

    const result1 = await checkoutService.checkout(
      {
        shippingAddressId: addressId,
        billingAddressId: addressId,
        billingSameAsShipping: true,
        shippingMethodCode: 'standard',
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
      },
      {
        tenantId,
        userId,
        idempotencyKey,
      },
    );

    expect(result1.idempotent).toBe(false);

    const result2 = await checkoutService.checkout(
      {
        shippingAddressId: addressId,
        billingAddressId: addressId,
        billingSameAsShipping: true,
        shippingMethodCode: 'standard',
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
      },
      {
        tenantId,
        userId,
        idempotencyKey,
      },
    );

    expect(result2.idempotent).toBe(true);
    expect(result2.order.id).toBe(result1.order.id);

    const count = await testPrisma.notification.count({
      where: {
        tenantId,
        eventKey: `order_placed_${result1.order.id}`,
      },
    });
    expect(count).toBe(1);
  });

  it('4. Checkout failure injection before commit creates NO order or notification', async () => {
    await createCart();

    const ordersBefore = await testPrisma.order.count({ where: { tenantId } });
    const notifsBefore = await testPrisma.notification.count({
      where: { tenantId },
    });

    const idempotencyKey = `idemp_fail_${Date.now()}`;
    const failingService = new CheckoutService((point) => {
      if (point === 'before-payment-create') {
        throw new Error('Simulated failure before payment creation');
      }
    });

    await expect(
      failingService.checkout(
        {
          shippingAddressId: addressId,
          billingAddressId: addressId,
          billingSameAsShipping: true,
          shippingMethodCode: 'standard',
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        },
        {
          tenantId,
          userId,
          idempotencyKey,
        },
      ),
    ).rejects.toThrow('Simulated failure before payment creation');

    const ordersAfter = await testPrisma.order.count({ where: { tenantId } });
    const notifsAfter = await testPrisma.notification.count({
      where: { tenantId },
    });

    expect(ordersAfter).toBe(ordersBefore);
    expect(notifsAfter).toBe(notifsBefore);
  });

  it('5. Checkout with insufficient inventory fails and creates NO order or notification', async () => {
    await createCart();

    const ordersBefore = await testPrisma.order.count({ where: { tenantId } });
    const notifsBefore = await testPrisma.notification.count({
      where: { tenantId },
    });

    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 0, reservedQuantity: 0 },
    });

    const checkoutService = new CheckoutService();
    const idempotencyKey = `idemp_stock_fail_${Date.now()}`;

    await expect(
      checkoutService.checkout(
        {
          shippingAddressId: addressId,
          billingAddressId: addressId,
          billingSameAsShipping: true,
          shippingMethodCode: 'standard',
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        },
        {
          tenantId,
          userId,
          idempotencyKey,
        },
      ),
    ).rejects.toThrow('Insufficient stock');

    const ordersAfter = await testPrisma.order.count({ where: { tenantId } });
    const notifsAfter = await testPrisma.notification.count({
      where: { tenantId },
    });

    expect(ordersAfter).toBe(ordersBefore);
    expect(notifsAfter).toBe(notifsBefore);

    const invState = await testPrisma.inventory.findUnique({
      where: { id: inventoryId },
    });
    expect(invState?.quantity).toBe(0);
    expect(invState?.reservedQuantity).toBe(0);

    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 50, reservedQuantity: 0 },
    });
  });

  it('6. Existing checkout response structure is 100% preserved', async () => {
    await createCart();

    const idempotencyKey = `idemp_contract_${Date.now()}`;
    const checkoutService = new CheckoutService();

    const result = await checkoutService.checkout(
      {
        shippingAddressId: addressId,
        billingAddressId: addressId,
        billingSameAsShipping: true,
        shippingMethodCode: 'standard',
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
      },
      {
        tenantId,
        userId,
        idempotencyKey,
      },
    );

    expect(result).toHaveProperty('order');
    expect(result).toHaveProperty('payment');
    expect(result).toHaveProperty('idempotent');
    expect(result.order).toHaveProperty('id');
    expect(result.order).toHaveProperty('orderNumber');
    expect(result.order).toHaveProperty('items');
    expect(result.order).toHaveProperty('status');
    expect(result.order).toHaveProperty('paymentStatus');
    expect(result.order).toHaveProperty('subtotal');
    expect(result.order).toHaveProperty('discountAmount');
    expect(result.order).toHaveProperty('shippingAmount');
    expect(result.order).toHaveProperty('taxAmount');
    expect(result.order).toHaveProperty('totalAmount');
    expect(result.order).toHaveProperty('shippingAddress');
    expect(result.order).toHaveProperty('billingAddress');
  });
});
