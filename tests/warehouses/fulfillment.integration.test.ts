import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { testPrisma } from '../../src/config/test-database.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { CheckoutService } from '../../src/modules/checkout/checkout.service.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';
import { OrderPolicyService } from '../../src/modules/warehouses/order-policy.service.js';

describe('single-source warehouse fulfillment', () => {
  const marker = randomUUID();
  const slug = `fulfillment-${marker}`;
  const checkout = new CheckoutService();
  let tenantId: string,
    otherTenantId: string,
    userId: string,
    token: string,
    addressId: string,
    cartId: string,
    warehouseA: string,
    warehouseB: string;
  const variants: string[] = [];
  const countriesCreated: string[] = [];
  const extraUsers: string[] = [];
  const input = () => ({
    shippingAddressId: addressId,
    paymentMethod: 'CASH_ON_DELIVERY' as const,
    shippingMethodCode: 'standard',
  });
  const context = () => ({ tenantId, userId, idempotencyKey: randomUUID() });
  const stocks = () =>
    testPrisma.inventory.findMany({
      where: { tenantId },
      orderBy: [{ warehouseId: 'asc' }, { variantId: 'asc' }],
    });
  beforeAll(async () => {
    for (const code of ['KW', 'SA', 'EG']) {
      if (!(await testPrisma.country.findUnique({ where: { code } }))) {
        await testPrisma.country.create({
          data: { code, name: `Fixture ${code}`, currencyCode: 'KWD' },
        });
        countriesCreated.push(code);
      }
    }
    tenantId = (
      await testPrisma.tenant.create({
        data: {
          slug,
          code: marker,
          name: 'Fulfillment',
          defaultCurrency: 'KWD',
        },
      })
    ).id;
    otherTenantId = (
      await testPrisma.tenant.create({
        data: {
          slug: `${slug}-other`,
          code: `${marker}-other`,
          name: 'Other',
          defaultCurrency: 'KWD',
        },
      })
    ).id;
    userId = (
      await testPrisma.user.create({
        data: {
          email: `${marker}@example.com`,
          passwordHash: 'unused',
          firstName: 'Buyer',
          lastName: 'Test',
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
    token = await createAccessToken(userId);
    await testPrisma.tenantMember.create({
      data: { tenantId, userId, role: 'OWNER' },
    });
    addressId = (
      await testPrisma.address.create({
        data: {
          userId,
          firstName: 'Buyer',
          lastName: 'Test',
          addressLine1: 'Delivery',
          city: 'Destination',
          countryCode: 'SA',
          latitude: 25,
          longitude: 45,
        },
      })
    ).id;
    const category = await testPrisma.category.create({
      data: { tenantId, name: 'Products', slug: 'products' },
    });
    const taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId, code: 'exempt', name: 'Exempt', treatment: 'EXEMPT' },
    });
    for (let index = 0; index < 2; index++) {
      const product = await testPrisma.product.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: `Item ${index}`,
          slug: `item-${index}`,
          status: 'ACTIVE',
          basePrice: '10.125',
        },
      });
      variants.push(
        (
          await testPrisma.productVariant.create({
            data: {
              productId: product.id,
              sku: `${marker}-${index}`,
              combinationKey: '',
              isDefault: true,
              taxCategoryId: taxCategory.id,
            },
          })
        ).id,
      );
    }
    for (const code of ['a', 'b']) {
      const warehouse = await testPrisma.warehouse.create({
        data: {
          tenantId,
          code,
          name: code,
          countryCode: 'KW',
          city: 'Origin',
          address: 'Stock source',
          latitude: 25,
          longitude: 45,
          priority: code === 'a' ? 20 : 10,
          isDefault: code === 'a',
        },
      });
      if (code === 'a') warehouseA = warehouse.id;
      else warehouseB = warehouse.id;
      await testPrisma.warehouseCoverage.create({
        data: { tenantId, warehouseId: warehouse.id, countryCode: 'SA' },
      });
      for (const variantId of variants)
        await testPrisma.inventory.create({
          data: {
            tenantId,
            warehouseId: warehouse.id,
            variantId,
            quantity: 10,
          },
        });
    }
    const shipping = await testPrisma.shippingProfile.create({
      data: {
        tenantId,
        countryCode: 'SA',
        currency: 'KWD',
        originLatitude: 0,
        originLongitude: 0,
      },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: shipping.id,
        code: 'destination',
        name: 'Destination',
        countryCode: 'SA',
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'standard', name: 'Standard' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: '2.125', maxDistanceKm: 5 },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId,
        countryCode: 'SA',
        currency: 'KWD',
        defaultTaxCategoryId: taxCategory.id,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode: 'SA', rate: 0 },
    });
    cartId = (await testPrisma.cart.create({ data: { tenantId, userId } })).id;
  });
  beforeEach(async () => {
    await testPrisma.checkoutRequest.deleteMany({ where: { tenantId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventory: { tenantId } },
    });
    await testPrisma.inventory.updateMany({
      where: { tenantId },
      data: { quantity: 10, reservedQuantity: 0 },
    });
    await testPrisma.warehouse.updateMany({
      where: { tenantId },
      data: { isActive: true, latitude: 25, longitude: 45 },
    });
    await testPrisma.warehouse.update({
      where: { id: warehouseA },
      data: { priority: 20 },
    });
    await testPrisma.warehouse.update({
      where: { id: warehouseB },
      data: { priority: 10 },
    });
    await testPrisma.warehouseCoverage.createMany({
      data: [warehouseA, warehouseB].map((warehouseId) => ({
        tenantId,
        warehouseId,
        countryCode: 'SA',
      })),
      skipDuplicates: true,
    });
    await testPrisma.tenantOrderPolicy.deleteMany({ where: { tenantId } });
    await testPrisma.cartItem.deleteMany({ where: { cartId } });
    await testPrisma.cartItem.createMany({
      data: variants.map((variantId) => ({ cartId, variantId, quantity: 1 })),
    });
    await testPrisma.tenantMember.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { status: 'ACTIVE' },
    });
  });
  afterAll(async () => {
    await testPrisma.checkoutRequest.deleteMany({ where: { tenantId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.cart.deleteMany({ where: { tenantId } });
    await testPrisma.product.deleteMany({ where: { tenantId } });
    await testPrisma.warehouse.deleteMany({ where: { tenantId } });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId } },
    });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: [userId, ...extraUsers] } },
    });
    if (countriesCreated.length)
      await testPrisma.country.deleteMany({
        where: { code: { in: countriesCreated } },
      });
    await testPrisma.$disconnect();
  });
  it('keeps published catalog global while bootstrapping tenant currency safely', async () => {
    const identifiers = [];
    for (const country of ['', 'EG', 'KW']) {
      const result = await request(app)
        .get('/api/v1/products')
        .set('X-Tenant-Slug', slug)
        .set('X-Country-Code', country);
      expect(result.status).toBe(200);
      identifiers.push(
        result.body.data.items.map((item: { id: string }) => item.id).sort(),
      );
    }
    expect(identifiers[0]).toHaveLength(2);
    expect(identifiers[1]).toEqual(identifiers[0]);
    expect(identifiers[2]).toEqual(identifiers[0]);
    const bootstrap = await request(app)
      .get('/api/v1/storefront')
      .set('X-Tenant-Slug', slug);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.data).toMatchObject({ slug, currency: 'KWD' });
    expect(Object.keys(bootstrap.body.data).sort()).toEqual([
      'currency',
      'id',
      'logoUrl',
      'name',
      'settings',
      'slug',
      'timezone',
    ]);
  });
  it('selects a whole-cart source by priority and uses that source coordinates for cross-border delivery', async () => {
    const before = await stocks();
    const preview = await checkout.preview(
      { shippingAddressId: addressId },
      { tenantId, userId },
    );
    expect(preview.fulfillment.warehouseId).toBe(warehouseB);
    expect(preview.shipping).toMatchObject({
      amount: '2.125',
      distanceKm: 0,
      currency: 'KWD',
    });
    expect(await stocks()).toEqual(before);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventory: { tenantId } },
      }),
    ).toBe(0);
  });
  it('supports one eligible warehouse and another delivery country than the browsing preference', async () => {
    await testPrisma.warehouseCoverage.deleteMany({
      where: { warehouseId: warehouseB },
    });
    const result = await request(app)
      .post('/api/v1/checkout/preview')
      .set('X-Tenant-Slug', slug)
      .set('X-Country-Code', 'UNCONFIGURED-PREFERENCE')
      .auth(token, { type: 'bearer' })
      .send({ shippingAddressId: addressId });
    expect(result.status).toBe(200);
    expect(result.body.data.fulfillment.warehouseId).toBe(warehouseA);
    expect(result.body.data.currency).toBe('KWD');
  });
  it('rejects aggregate stock that cannot fulfill the whole cart from one source', async () => {
    await testPrisma.inventory.updateMany({
      where: { warehouseId: warehouseA, variantId: variants[0]! },
      data: { quantity: 0 },
    });
    await testPrisma.inventory.updateMany({
      where: { warehouseId: warehouseB, variantId: variants[1]! },
      data: { quantity: 0 },
    });
    await expect(checkout.checkout(input(), context())).rejects.toMatchObject({
      code: 'NO_ELIGIBLE_FULFILLMENT_WAREHOUSE',
    });
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(0);
    expect(
      (await stocks()).every((stock) => stock.reservedQuantity === 0),
    ).toBe(true);
  });
  it('rejects absent explicit destination coverage', async () => {
    await testPrisma.warehouseCoverage.deleteMany({ where: { tenantId } });
    await expect(
      checkout.preview({ shippingAddressId: addressId }, { tenantId, userId }),
    ).rejects.toMatchObject({ code: 'NO_ELIGIBLE_FULFILLMENT_WAREHOUSE' });
  });
  it('revalidates after preview and retains the selected source on idempotent replay', async () => {
    expect(
      (
        await checkout.preview(
          { shippingAddressId: addressId },
          { tenantId, userId },
        )
      ).fulfillment.warehouseId,
    ).toBe(warehouseB);
    await testPrisma.inventory.updateMany({
      where: { warehouseId: warehouseB },
      data: { quantity: 0 },
    });
    const attempt = context();
    const result = await checkout.checkout(input(), attempt);
    expect(result.order.warehouseId).toBe(warehouseA);
    expect(result.order.fulfillmentSnapshot).toMatchObject({
      warehouseId: warehouseA,
      countryCode: 'KW',
    });
    const replay = await checkout.checkout(input(), attempt);
    expect(replay.idempotent).toBe(true);
    expect(replay.order).toEqual(result.order);
    expect(
      (await stocks())
        .filter((stock) => stock.warehouseId === warehouseA)
        .every((stock) => stock.reservedQuantity === 1),
    ).toBe(true);
  });
  it('releases exactly the original source once after priorities change', async () => {
    const result = await checkout.checkout(input(), context());
    await testPrisma.warehouse.update({
      where: { id: warehouseA },
      data: { priority: 0 },
    });
    const service = new InventoryService(new InventoryRepository(testPrisma));
    for (let index = 0; index < 2; index++)
      await testPrisma.$transaction((tx) =>
        service.releaseOrderReservation(tenantId, result.order.id, tx),
      );
    expect(
      (await stocks()).every(
        (stock) => stock.reservedQuantity === 0 && stock.quantity === 10,
      ),
    ).toBe(true);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: {
          referenceId: result.order.id,
          type: 'RELEASE',
          inventory: { warehouseId: warehouseB },
        },
      }),
    ).toBe(2);
    await testPrisma.warehouse.update({
      where: { id: warehouseA },
      data: { priority: 20 },
    });
  });
  it('prevents deactivation with active reservations', async () => {
    const result = await checkout.checkout(input(), context());
    const response = await request(app)
      .patch(`/api/v1/warehouses/${result.order.warehouseId}`)
      .set('X-Tenant-Slug', slug)
      .auth(token, { type: 'bearer' })
      .send({ isActive: false });
    expect(response.status).toBe(409);
  });
  it('enforces per-variant, total-unit and distinct-variant limits', async () => {
    const policy = new OrderPolicyService();
    for (const [limits, code] of [
      [{ maxQuantityPerItem: 1 }, 'ORDER_MAX_QUANTITY_PER_ITEM_EXCEEDED'],
      [{ maxOrderItems: 2 }, 'ORDER_MAX_ITEMS_EXCEEDED'],
      [{ maxDistinctItems: 1 }, 'ORDER_MAX_DISTINCT_ITEMS_EXCEEDED'],
    ] as const) {
      await testPrisma.tenantOrderPolicy.deleteMany({ where: { tenantId } });
      await policy.update(tenantId, limits);
      await testPrisma.cartItem.update({
        where: { cartId_variantId: { cartId, variantId: variants[0]! } },
        data: { quantity: 2 },
      });
      await expect(
        checkout.preview(
          { shippingAddressId: addressId },
          { tenantId, userId },
        ),
      ).rejects.toMatchObject({ code });
    }
  });
  it('uses exact discounted merchandise limits and validates partial policy updates', async () => {
    const policy = new OrderPolicyService();
    await policy.update(tenantId, {
      minOrderAmount: '20.250',
      maxOrderAmount: '20.250',
    });
    const preview = await checkout.preview(
      { shippingAddressId: addressId },
      { tenantId, userId },
    );
    expect(preview.subtotal).toBe('20.25');
    expect(preview.totalAmount).toBe('22.375');
    await expect(
      policy.update(tenantId, { maxOrderAmount: '20.249' }),
    ).rejects.toMatchObject({ code: 'ORDER_POLICY_INVALID_RANGE' });
    await expect(
      policy.update(tenantId, { minOrderAmount: '1.0001' }),
    ).rejects.toMatchObject({ code: 'INVALID_MONETARY_PRECISION' });
    await policy.update(tenantId, {
      minOrderAmount: null,
      maxOrderAmount: '20.249',
    });
    await expect(checkout.checkout(input(), context())).rejects.toMatchObject({
      code: 'ORDER_MAX_AMOUNT_EXCEEDED',
    });
  });
  it('rejects cross-tenant inventory at the database boundary', async () => {
    await expect(
      testPrisma.inventory.create({
        data: {
          tenantId: otherTenantId,
          warehouseId: warehouseA,
          variantId: variants[0]!,
          quantity: 1,
        },
      }),
    ).rejects.toThrow();
    const foreignWarehouse = await testPrisma.warehouse.create({
      data: {
        tenantId: otherTenantId,
        code: 'foreign',
        name: 'Foreign',
        countryCode: 'KW',
        city: 'Origin',
        address: 'Foreign',
      },
    });
    try {
      await expect(
        testPrisma.inventory.create({
          data: {
            tenantId: otherTenantId,
            warehouseId: foreignWarehouse.id,
            variantId: variants[0]!,
            quantity: 1,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await testPrisma.warehouse.delete({ where: { id: foreignWarehouse.id } });
    }
  });
  it('rejects negative available stock at the database boundary', async () => {
    await expect(
      testPrisma.inventory.update({
        where: {
          warehouseId_variantId: {
            warehouseId: warehouseA,
            variantId: variants[0]!,
          },
        },
        data: { reservedQuantity: 11 },
      }),
    ).rejects.toThrow();
  });
  it('enforces membership for preview and checkout, including direct service calls', async () => {
    await testPrisma.tenantMember.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { status: 'SUSPENDED' },
    });
    await expect(
      checkout.preview({ shippingAddressId: addressId }, { tenantId, userId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(checkout.checkout(input(), context())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('returns shipping options without modifying the cart or reservations', async () => {
    const before = await stocks();
    const result = await request(app)
      .post('/api/v1/checkout/shipping-options')
      .set('X-Tenant-Slug', slug)
      .set('X-Country-Code', 'UNCONFIGURED-PREFERENCE')
      .auth(token, { type: 'bearer' })
      .send({ shippingAddressId: addressId });
    expect(result.status).toBe(200);
    expect(result.body.data.options).toHaveLength(1);
    expect(result.body.data.options[0]).toMatchObject({
      methodCode: 'standard',
      amount: '2.125',
      fulfillment: { warehouseId: warehouseB },
    });
    expect(await stocks()).toEqual(before);
    expect(await testPrisma.cartItem.count({ where: { cartId } })).toBe(2);
  });
  it('rejects stock in warehouses that do not cover the destination', async () => {
    await testPrisma.warehouseCoverage.deleteMany({
      where: { warehouseId: warehouseA },
    });
    await testPrisma.inventory.updateMany({
      where: { warehouseId: warehouseB },
      data: { quantity: 0 },
    });
    await expect(checkout.checkout(input(), context())).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(0);
  });
  it('uses a stable warehouse-code tie break and excludes inactive sources', async () => {
    await testPrisma.warehouse.update({
      where: { id: warehouseA },
      data: { priority: 10 },
    });
    expect(
      (
        await checkout.preview(
          { shippingAddressId: addressId },
          { tenantId, userId },
        )
      ).fulfillment.warehouseId,
    ).toBe(warehouseA);
    await testPrisma.warehouse.update({
      where: { id: warehouseB },
      data: { isActive: false },
    });
    expect(
      (
        await checkout.preview(
          { shippingAddressId: addressId },
          { tenantId, userId },
        )
      ).fulfillment.warehouseId,
    ).toBe(warehouseA);
  });
  it('consumes only the original reservation once on successful payment', async () => {
    const result = await checkout.checkout(input(), context());
    await testPrisma.order.update({
      where: { id: result.order.id },
      data: { paymentStatus: 'PAID' },
    });
    await testPrisma.payment.update({
      where: { id: result.payment!.id },
      data: { status: 'PAID' },
    });
    const service = new InventoryService(new InventoryRepository(testPrisma));
    for (let count = 0; count < 2; count++)
      await testPrisma.$transaction((tx) =>
        service.commitOrderSale(tenantId, result.order.id, tx),
      );
    const inventory = await stocks();
    expect(
      inventory
        .filter((stock) => stock.warehouseId === warehouseB)
        .every((stock) => stock.quantity === 9 && stock.reservedQuantity === 0),
    ).toBe(true);
    expect(
      inventory
        .filter((stock) => stock.warehouseId === warehouseA)
        .every(
          (stock) => stock.quantity === 10 && stock.reservedQuantity === 0,
        ),
    ).toBe(true);
  });
  it('does not oversell the only destination-eligible source under concurrent checkout', async () => {
    await testPrisma.warehouseCoverage.deleteMany({
      where: { warehouseId: warehouseA },
    });
    await testPrisma.inventory.updateMany({
      where: { warehouseId: warehouseB },
      data: { quantity: 1 },
    });
    const other = await testPrisma.user.create({
      data: {
        email: `${marker}-concurrent@example.com`,
        passwordHash: 'unused',
        firstName: 'Other',
        lastName: 'Buyer',
      },
    });
    extraUsers.push(other.id);
    await testPrisma.tenantMember.create({
      data: { tenantId, userId: other.id, role: 'CUSTOMER' },
    });
    const address = await testPrisma.address.create({
      data: {
        userId: other.id,
        firstName: 'Other',
        lastName: 'Buyer',
        addressLine1: 'Destination',
        city: 'Destination',
        countryCode: 'SA',
        latitude: 25,
        longitude: 45,
      },
    });
    const cart = await testPrisma.cart.create({
      data: { tenantId, userId: other.id },
    });
    await testPrisma.cartItem.createMany({
      data: variants.map((variantId) => ({
        cartId: cart.id,
        variantId,
        quantity: 1,
      })),
    });
    const outcomes = await Promise.allSettled([
      checkout.checkout(input(), context()),
      checkout.checkout(
        { ...input(), shippingAddressId: address.id },
        { tenantId, userId: other.id, idempotencyKey: randomUUID() },
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(
      rejected?.status === 'rejected' ? rejected.reason : null,
    ).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(
      (await stocks())
        .filter((stock) => stock.warehouseId === warehouseB)
        .every((stock) => stock.quantity === 1 && stock.reservedQuantity === 1),
    ).toBe(true);
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(1);
  });
  it('validates address countries and coordinate pairs without clearing the cart', async () => {
    const count = await testPrisma.cartItem.count({ where: { cartId } });
    const invalid = await request(app)
      .patch(`/api/v1/addresses/${addressId}`)
      .auth(token, { type: 'bearer' })
      .send({ country: 'ZZ' });
    expect(invalid.status).toBe(400);
    const incomplete = await request(app)
      .patch(`/api/v1/addresses/${addressId}`)
      .auth(token, { type: 'bearer' })
      .send({ longitude: null });
    expect(incomplete.status).toBe(400);
    const valid = await request(app)
      .patch(`/api/v1/addresses/${addressId}`)
      .auth(token, { type: 'bearer' })
      .send({ country: 'sa', latitude: 25, longitude: 45 });
    expect(valid.status).toBe(200);
    expect(valid.body.data).toMatchObject({
      country: 'SA',
      latitude: 25,
      longitude: 45,
    });
    expect(await testPrisma.cartItem.count({ where: { cartId } })).toBe(count);
  });
  it('treats FREE as zero even when its stored flat rate is nonzero', async () => {
    const method = await testPrisma.shippingMethod.findFirstOrThrow({
      where: { zone: { profile: { tenantId } }, code: 'standard' },
    });
    const rule = await testPrisma.shippingRule.create({
      data: {
        methodId: method.id,
        priority: 100,
        minOrderAmount: '20.250',
        rateType: 'FREE',
        flatRate: '99.999',
      },
    });
    try {
      const preview = await checkout.preview(
        { shippingAddressId: addressId },
        { tenantId, userId },
      );
      expect(preview.shippingAmount).toBe('0');
      expect(preview.totalAmount).toBe('20.25');
    } finally {
      await testPrisma.shippingRule.delete({ where: { id: rule.id } });
    }
  });
  it('uses shipping cost before warehouse code when priorities tie', async () => {
    await testPrisma.warehouse.update({
      where: { id: warehouseA },
      data: { priority: 10, latitude: '25.001' },
    });
    const method = await testPrisma.shippingMethod.findFirstOrThrow({
      where: { zone: { profile: { tenantId } }, code: 'standard' },
    });
    const rule = await testPrisma.shippingRule.create({
      data: {
        methodId: method.id,
        priority: 100,
        maxDistanceKm: 0,
        flatRate: '1',
      },
    });
    try {
      const preview = await checkout.preview(
        { shippingAddressId: addressId },
        { tenantId, userId },
      );
      expect(preview.fulfillment.warehouseId).toBe(warehouseB);
      expect(preview.shippingAmount).toBe('1');
    } finally {
      await testPrisma.shippingRule.delete({ where: { id: rule.id } });
    }
  });
  it('falls back to an eligible method when the first configured method has no matching rate', async () => {
    const standard = await testPrisma.shippingMethod.findFirstOrThrow({
      where: { zone: { profile: { tenantId } }, code: 'standard' },
    });
    const method = await testPrisma.shippingMethod.create({
      data: {
        zoneId: standard.zoneId,
        code: 'ineligible',
        name: 'Ineligible',
        sortOrder: -1,
        rules: { create: { minOrderAmount: '9999', flatRate: '1' } },
      },
    });
    try {
      expect(
        (
          await checkout.preview(
            { shippingAddressId: addressId },
            { tenantId, userId },
          )
        ).shipping.methodCode,
      ).toBe('standard');
    } finally {
      await testPrisma.shippingMethod.delete({ where: { id: method.id } });
    }
  });
  it('requires every configured region/city constraint before selecting a zone', async () => {
    const profile = await testPrisma.shippingProfile.findUniqueOrThrow({
      where: { tenantId_countryCode: { tenantId, countryCode: 'SA' } },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: profile.id,
        code: 'restricted',
        name: 'Restricted',
        countryCode: 'SA',
        regionCode: 'North',
        city: 'Capital',
        methods: {
          create: {
            code: 'restricted',
            name: 'Restricted',
            rules: { create: { flatRate: '99' } },
          },
        },
      },
    });
    await testPrisma.address.update({
      where: { id: addressId },
      data: { state: 'North', city: 'Another city' },
    });
    try {
      expect(
        (
          await checkout.preview(
            { shippingAddressId: addressId },
            { tenantId, userId },
          )
        ).shipping.methodCode,
      ).toBe('standard');
    } finally {
      await testPrisma.shippingZone.delete({ where: { id: zone.id } });
      await testPrisma.address.update({
        where: { id: addressId },
        data: { state: null, city: 'Destination' },
      });
    }
  });
  it('checks monetary policy after coupons and excludes included tax and shipping', async () => {
    const category = await testPrisma.taxCategory.findUniqueOrThrow({
      where: { tenantId_code: { tenantId, code: 'exempt' } },
    });
    const coupon = await testPrisma.coupon.create({
      data: {
        tenantId,
        code: `POLICY-${marker}`.toUpperCase(),
        discountType: 'FIXED_AMOUNT',
        discountValue: '2.200',
      },
    });
    await testPrisma.taxCategory.update({
      where: { id: category.id },
      data: { treatment: 'STANDARD' },
    });
    await testPrisma.taxRule.updateMany({
      where: { taxCategoryId: category.id },
      data: { rate: 10 },
    });
    await testPrisma.taxProfile.updateMany({
      where: { tenantId },
      data: { pricesIncludeTax: true },
    });
    await testPrisma.product.updateMany({
      where: { tenantId },
      data: { basePrice: '11' },
    });
    await new OrderPolicyService().update(tenantId, {
      minOrderAmount: '18',
      maxOrderAmount: '18',
    });
    try {
      const preview = await checkout.preview(
        { shippingAddressId: addressId, couponCode: coupon.code },
        { tenantId, userId },
      );
      expect(preview).toMatchObject({
        currency: 'KWD',
        subtotal: '22',
        couponDiscount: '2.2',
        taxAmount: '1.8',
        shippingAmount: '2.125',
        totalAmount: '21.925',
      });
      await expect(checkout.checkout(input(), context())).rejects.toMatchObject(
        { code: 'ORDER_MAX_AMOUNT_EXCEEDED' },
      );
      expect(
        (await stocks()).every((stock) => stock.reservedQuantity === 0),
      ).toBe(true);
    } finally {
      await testPrisma.coupon.delete({ where: { id: coupon.id } });
      await testPrisma.taxCategory.update({
        where: { id: category.id },
        data: { treatment: 'EXEMPT' },
      });
      await testPrisma.taxRule.updateMany({
        where: { taxCategoryId: category.id },
        data: { rate: 0 },
      });
      await testPrisma.taxProfile.updateMany({
        where: { tenantId },
        data: { pricesIncludeTax: false },
      });
      await testPrisma.product.updateMany({
        where: { tenantId },
        data: { basePrice: '10.125' },
      });
    }
  });
  it('manages and filters stock per warehouse through merchant APIs', async () => {
    const created = await request(app)
      .post('/api/v1/warehouses')
      .set('X-Tenant-Slug', slug)
      .auth(token, { type: 'bearer' })
      .send({
        code: 'managed',
        name: 'Managed source',
        countryCode: 'KW',
        city: 'Origin',
        address: 'Managed fixture address',
      });
    expect(created.status).toBe(201);
    const warehouseId: string = created.body.data.id;
    try {
      const stock = await request(app)
        .post('/api/v1/inventory')
        .set('X-Tenant-Slug', slug)
        .auth(token, { type: 'bearer' })
        .send({ warehouseId, variantId: variants[0]!, quantity: 3 });
      expect(stock.status).toBe(201);
      expect(stock.body.data).toMatchObject({
        warehouseId,
        quantity: 3,
        reservedQuantity: 0,
      });
      const listing = await request(app)
        .get(`/api/v1/inventory?warehouseId=${warehouseId}&lowStock=5`)
        .set('X-Tenant-Slug', slug)
        .auth(token, { type: 'bearer' });
      expect(listing.status).toBe(200);
      expect(listing.body.data.items).toHaveLength(1);
      expect(listing.body.data.items[0]).toMatchObject({
        warehouseId,
        quantity: 3,
      });
      const coverage = await request(app)
        .put(`/api/v1/warehouses/${warehouseId}/coverage`)
        .set('X-Tenant-Slug', slug)
        .auth(token, { type: 'bearer' })
        .send({ countries: ['SA'] });
      expect(coverage.status).toBe(200);
      expect(coverage.body.data).toEqual({ warehouseId, countries: ['SA'] });
      const fetched = await request(app)
        .get(`/api/v1/warehouses/${warehouseId}`)
        .set('X-Tenant-Slug', slug)
        .auth(token, { type: 'bearer' });
      expect(fetched.body.data).toMatchObject({
        countryCode: 'KW',
        countries: ['SA'],
      });
    } finally {
      await testPrisma.inventory.deleteMany({ where: { warehouseId } });
      await testPrisma.warehouse.delete({ where: { id: warehouseId } });
    }
  });
});
