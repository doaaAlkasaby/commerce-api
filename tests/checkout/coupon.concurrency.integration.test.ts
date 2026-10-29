import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import pg from 'pg';
import { testPrisma } from '../../src/config/test-database.js';
import { env } from '../../src/config/env.js';
import {
  CheckoutService,
  type CheckoutFailurePoint,
} from '../../src/modules/checkout/checkout.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';

const suite =
  process.env.RUN_COUPON_CONCURRENCY_INTEGRATION === '1'
    ? describe
    : describe.skip;
const fixture = `coupon-race-${crypto.randomUUID()}`;

suite('coupon concurrency against PostgreSQL (Point 9)', () => {
  let tenantId: string;
  let otherTenantId: string;
  let countryCode: string;
  let variantId: string;
  let inventoryId: string;
  let couponId: string;
  const users: Array<{ id: string; addressId: string; cartId: string }> = [];
  const code = `${fixture}-coupon`.toUpperCase();

  beforeAll(async () => {
    const country = await testPrisma.country.create({
      data: {
        code: `Q${crypto.randomUUID().slice(0, 7)}`,
        name: fixture,
        currencyCode: 'EGP',
      },
    });
    countryCode = country.code;
    const tenant = await testPrisma.tenant.create({
      data: {
        name: fixture,
        slug: fixture,
        code: fixture,
        defaultCurrency: 'EGP',
      },
    });
    tenantId = tenant.id;
    otherTenantId = (
      await testPrisma.tenant.create({
        data: {
          name: 'Other coupon tenant',
          slug: `${fixture}-other`,
          code: `${fixture}-other`,
          defaultCurrency: 'USD',
        },
      })
    ).id;
    const category = await testPrisma.category.create({
      data: { tenantId, name: 'Coupon race', slug: fixture },
    });
    const taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId, code: fixture, name: 'Standard' },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Race product',
        slug: fixture,
        basePrice: '20',
        status: 'ACTIVE',
      },
    });
    variantId = (
      await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: fixture,
          combinationKey: 'default',
          isActive: true,
          taxCategoryId: taxCategory.id,
        },
      })
    ).id;
    inventoryId = (
      await testPrisma.inventory.create({ data: { variantId, quantity: 20 } })
    ).id;
    await testPrisma.taxProfile.create({
      data: {
        tenantId,
        countryCode,
        currency: 'EGP',
        defaultTaxCategoryId: taxCategory.id,
        pricesIncludeTax: false,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: '5' },
    });
    const profile = await testPrisma.shippingProfile.create({
      data: {
        tenantId,
        countryCode,
        currency: 'EGP',
        originLatitude: '30',
        originLongitude: '31',
      },
    });
    const zone = await testPrisma.shippingZone.create({
      data: { profileId: profile.id, code: fixture, name: 'Zone', countryCode },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'standard', name: 'Standard' },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: '3', maxDistanceKm: '50' },
    });
    couponId = (
      await testPrisma.coupon.create({
        data: {
          tenantId,
          code,
          discountType: 'FIXED_AMOUNT',
          discountValue: '2',
        },
      })
    ).id;
    for (let i = 0; i < 4; i++) {
      const user = await testPrisma.user.create({
        data: {
          email: `${fixture}-${i}@example.test`,
          passwordHash: 'test',
          firstName: 'Coupon',
          lastName: 'Tester',
        },
      });
      const address = await testPrisma.address.create({
        data: {
          userId: user.id,
          firstName: 'Coupon',
          lastName: 'Tester',
          addressLine1: 'Street',
          city: 'Cairo',
          countryCode,
          latitude: '30',
          longitude: '31',
        },
      });
      const cart = await testPrisma.cart.create({
        data: { tenantId, userId: user.id },
      });
      users.push({ id: user.id, addressId: address.id, cartId: cart.id });
    }
  });

  const reset = async () => {
    await testPrisma.checkoutRequest.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await testPrisma.couponUsage.deleteMany({
      where: { coupon: { tenantId } },
    });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 20, reservedQuantity: 0 },
    });
    await testPrisma.coupon.update({
      where: { id: couponId },
      data: {
        usageCount: 0,
        usageLimit: null,
        perUserLimit: null,
        isActive: true,
        startsAt: null,
        endsAt: null,
        minimumOrderAmount: null,
        maximumDiscountAmount: null,
        discountValue: '2',
        discountType: 'FIXED_AMOUNT',
      },
    });
    await testPrisma.cartItem.deleteMany({
      where: { cartId: { in: users.map((u) => u.cartId) } },
    });
  };
  beforeEach(async () => {
    await reset();
    await testPrisma.cartItem.createMany({
      data: users.map((u) => ({ cartId: u.cartId, variantId, quantity: 1 })),
    });
  });
  afterEach(reset);
  afterAll(async () => {
    await testPrisma.cart.deleteMany({ where: { tenantId } });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId } },
    });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.address.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await testPrisma.country.delete({ where: { code: countryCode } });
  });

  const checkout = (
    index: number,
    failurePoint?: CheckoutFailurePoint,
    couponCode = code,
  ) => {
    const user = users[index]!;
    return new CheckoutService((point) => {
      if (point === failurePoint)
        throw new Error('Injected coupon race failure');
    }).checkout(
      {
        shippingAddressId: user.addressId,
        billingSameAsShipping: true,
        couponCode,
        paymentMethod: 'CARD',
        paymentProvider: 'NONE',
        shippingMethodCode: 'standard',
      },
      { tenantId, userId: user.id, idempotencyKey: crypto.randomUUID() },
    );
  };

  // Hold the coupon externally until both real checkout transactions have reached
  // their locking queries. No sleeps are used to assume transaction overlap.
  const race = async (
    attempts: Array<() => ReturnType<typeof checkout>>,
    updateWhileLocked?: (client: pg.Client) => Promise<unknown>,
  ) => {
    const blocker = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
    await blocker.connect();
    let releaseCommand = 'ROLLBACK';
    let results:
      | Promise<PromiseSettledResult<Awaited<ReturnType<typeof checkout>>>[]>
      | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM "Coupon" WHERE id=$1 FOR UPDATE', [
        couponId,
      ]);
      results = Promise.allSettled(attempts.map((attempt) => attempt()));
      const deadline = Date.now() + 3500;
      let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await testPrisma.$queryRaw<Array<{ waiting: number }>>`
          SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FROM "Coupon"%' AND cardinality(pg_blocking_pids(pid)) > 0
        `;
        waiting = rows[0]!.waiting;
        if (waiting >= attempts.length) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThanOrEqual(attempts.length);
      if (updateWhileLocked) {
        await updateWhileLocked(blocker);
        releaseCommand = 'COMMIT';
      }
    } finally {
      await blocker.query(releaseCommand);
      await blocker.end();
      // Always drain checkouts, including on a failed barrier assertion.
      if (results) await results;
    }
    return results!;
  };

  const expectState = async (successful: number, discountAmount = '2.00') => {
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(
      successful,
    );
    expect(
      await testPrisma.orderItem.count({ where: { order: { tenantId } } }),
    ).toBe(successful);
    expect(
      await testPrisma.payment.count({ where: { order: { tenantId } } }),
    ).toBe(successful);
    expect(
      await testPrisma.checkoutRequest.count({
        where: { order: { tenantId } },
      }),
    ).toBe(successful);
    expect(await testPrisma.couponUsage.count({ where: { couponId } })).toBe(
      successful,
    );
    expect(
      (await testPrisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
        .usageCount,
    ).toBe(successful);
    expect(
      (
        await testPrisma.inventory.findUniqueOrThrow({
          where: { id: inventoryId },
        })
      ).reservedQuantity,
    ).toBe(successful);
    expect(
      await testPrisma.inventoryTransaction.count({ where: { inventoryId } }),
    ).toBe(successful);
    const orders = await testPrisma.order.findMany({ where: { tenantId } });
    for (const order of orders) {
      expect(order.couponSnapshot).toMatchObject({
        id: couponId,
        code,
        discountType: 'FIXED_AMOUNT',
        currency: 'EGP',
        discountAmount,
      });
      expect(
        new Prisma.Decimal(order.discountAmount).equals(discountAmount),
      ).toBe(true);
    }
  };

  it.each([1, 2, 3])(
    'allows exactly one checkout to consume the last global use (repeat %i)',
    async () => {
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { usageLimit: 1 },
      });
      const results = await race([() => checkout(0), () => checkout(1)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({
        code: 'COUPON_USAGE_LIMIT_REACHED',
      });
      await expectState(1);
      const loser = results[0]!.status === 'rejected' ? users[0]! : users[1]!;
      expect(
        await testPrisma.cartItem.count({ where: { cartId: loser.cartId } }),
      ).toBe(1);
    },
  );

  it('never exceeds a global limit shared by four different users', async () => {
    await testPrisma.coupon.update({
      where: { id: couponId },
      data: { usageLimit: 2 },
    });
    const results = await race(users.map((_, index) => () => checkout(index)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results)
      if (r.status === 'rejected')
        expect(r.reason.code).toBe('COUPON_USAGE_LIMIT_REACHED');
    await expectState(2);
  });

  it('serializes same-user quota checks before either checkout can clear the cart', async () => {
    await testPrisma.coupon.update({
      where: { id: couponId },
      data: { perUserLimit: 1 },
    });
    // Schema permits one cart per tenant/user. The DB barrier proves both
    // transactions loaded that cart before competing on the coupon, not on cart writes.
    const results = await race([() => checkout(0), () => checkout(0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({
      code: 'COUPON_USER_USAGE_LIMIT_REACHED',
    });
    await expectState(1);
  });

  it('allows unlimited coupon use by concurrent users with separate carts', async () => {
    const results = await race([() => checkout(0), () => checkout(1)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    await expectState(2);
  });

  it('does not apply another tenant coupon even when the client supplies its code', async () => {
    const foreignCode = `${code}-FOREIGN`;
    const foreign = await testPrisma.coupon.create({
      data: {
        tenantId: otherTenantId,
        code: foreignCode,
        discountType: 'FIXED_AMOUNT',
        discountValue: '10',
      },
    });
    try {
      await expect(checkout(0, undefined, foreignCode)).rejects.toMatchObject({
        code: 'COUPON_NOT_FOUND',
      });
      expect(
        (
          await testPrisma.coupon.findUniqueOrThrow({
            where: { id: foreign.id },
          })
        ).usageCount,
      ).toBe(0);
      await expectState(0);
      expect(
        await testPrisma.cartItem.count({
          where: { cartId: users[0]!.cartId },
        }),
      ).toBe(1);
    } finally {
      await testPrisma.coupon.delete({ where: { id: foreign.id } });
    }
  });

  it('keeps identical coupon codes and usage independent across tenants', async () => {
    const foreign = await testPrisma.coupon.create({
      data: {
        tenantId: otherTenantId,
        code,
        discountType: 'FIXED_AMOUNT',
        discountValue: '10',
        usageLimit: 1,
        usageCount: 1,
      },
    });
    try {
      await checkout(0);
      await expectState(1);
      expect(
        (
          await testPrisma.coupon.findUniqueOrThrow({
            where: { id: foreign.id },
          })
        ).usageCount,
      ).toBe(1);
    } finally {
      await testPrisma.coupon.delete({ where: { id: foreign.id } });
    }
  });

  it('rolls back coupon consumption, snapshots and reservations and preserves the failed cart', async () => {
    await expect(checkout(0, 'after-coupon-consumed')).rejects.toThrow(
      'Injected coupon race failure',
    );
    await expectState(0);
    expect(
      await testPrisma.cartItem.count({ where: { cartId: users[0]!.cartId } }),
    ).toBe(1);
  });

  it('releases a rolled-back final use so the waiting checkout can consume it', async () => {
    await testPrisma.coupon.update({
      where: { id: couponId },
      data: { usageLimit: 1 },
    });
    const results = await race([
      () => checkout(0, 'after-coupon-consumed'),
      () => checkout(1),
    ]);
    expect(results[0]!.status).toBe('rejected');
    expect(results[1]!.status).toBe('fulfilled');
    await expectState(1);
    expect(
      await testPrisma.cartItem.count({ where: { cartId: users[0]!.cartId } }),
    ).toBe(1);
  });

  it.each([
    ['inactive status', '"isActive" = false', 'COUPON_INACTIVE'],
    [
      'future start',
      '"startsAt" = NOW() + INTERVAL \'1 day\'',
      'COUPON_NOT_STARTED',
    ],
    ['expiration', '"endsAt" = NOW() - INTERVAL \'1 day\'', 'COUPON_EXPIRED'],
    [
      'minimum subtotal',
      '"minimumOrderAmount" = 21',
      'COUPON_MINIMUM_ORDER_NOT_MET',
    ],
    ['global quota', '"usageLimit" = 0', 'COUPON_USAGE_LIMIT_REACHED'],
    ['per-user quota', '"perUserLimit" = 0', 'COUPON_USER_USAGE_LIMIT_REACHED'],
  ])(
    'revalidates %s after waiting for the coupon lock',
    async (_, assignment, expectedCode) => {
      // Assignments are static test SQL, never client input.
      const results = await race(
        [() => checkout(0), () => checkout(1)],
        (client) =>
          client.query(`UPDATE "Coupon" SET ${assignment} WHERE id=$1`, [
            couponId,
          ]),
      );
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected')
          expect(result.reason.code).toBe(expectedCode);
      }
      await expectState(0);
      for (const user of users)
        expect(
          await testPrisma.cartItem.count({ where: { cartId: user.cartId } }),
        ).toBe(1);
    },
  );

  it('uses locked coupon terms for both calculations and immutable snapshots', async () => {
    const results = await race(
      [() => checkout(0), () => checkout(1)],
      (client) =>
        client.query('UPDATE "Coupon" SET "discountValue"=4 WHERE id=$1', [
          couponId,
        ]),
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    await expectState(2, '4.00');
    const orders = await testPrisma.order.findMany({ where: { tenantId } });
    for (const order of orders)
      expect(order.couponSnapshot).toMatchObject({ discountValue: '4' });
  });

  it('does not oversell scarce inventory when the coupon is unlimited', async () => {
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 1 },
    });
    const results = await race([() => checkout(0), () => checkout(1)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expectState(1);
  });
});
