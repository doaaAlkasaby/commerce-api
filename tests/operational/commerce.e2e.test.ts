import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
import { hashPassword } from '../../src/common/security/password.js';
import request from 'supertest';
import app from '../../src/app.js';
import { testPrisma } from '../../src/config/test-database.js';
import {
  developmentId,
  developmentStores,
  seedDevelopment,
} from '../../prisma/development/seed.js';
import { verifyDevelopmentSeed } from '../../prisma/development/cli.js';
import { enrollCustomer } from '../../src/modules/tenants/customer-enrollment.service.js';
import {
  globalRateLimiter,
  sensitiveRateLimiter,
} from '../../src/config/rate-limit.js';
import { ipKeyGenerator } from 'express-rate-limit';
import { RecoveryRepository } from '../../src/modules/recovery/recovery.repository.js';
import { RecoveryService } from '../../src/modules/recovery/recovery.service.js';

const fixture = vi.hoisted(() => ({
  outbox: `/tmp/commerce-phase81-mail-${crypto.randomUUID()}`,
  password: `Development!${crypto.randomUUID()}Aa1`,
}));
vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      EMAIL_DELIVERY_MODE: 'development_file',
      EMAIL_DEVELOPMENT_OUTBOX_DIR: fixture.outbox,
    },
  };
});

describe('seeded HTTP commerce and customer onboarding', () => {
  const tenantId = developmentId('tenant:fashion'),
    otherTenantId = developmentId('tenant:independent');
  const slug = 'dev81-kuwait-fashion',
    otherSlug = 'dev81-independent';
  const kw = developmentId('warehouse:fashion:kuwait'),
    sa = developmentId('warehouse:fashion:saudi');
  const customerId = developmentId('user:fashion-customer');
  const addressKw = developmentId('address:fashion-customer:KW'),
    addressSa = developmentId('address:fashion-customer:SA');
  const tee = developmentId('variant:fashion:tee:small'),
    medium = developmentId('variant:fashion:tee:medium'),
    denim = developmentId('variant:fashion:denim:30');
  const tokens: Record<string, string> = {};
  const createdUsers: string[] = [];
  const unrelatedId = randomUUID();
  const unrelatedSlug = `unrelated-${randomUUID()}`;
  let registeredId: string, registeredToken: string;
  let initialStock: Array<{ id: string; quantity: number }> = [];
  let initialCoverage: Array<{
    tenantId: string;
    warehouseId: string;
    countryCode: string;
  }> = [];
  let countriesBefore: string[] = [];
  const post = (
    path: string,
    token = tokens['fashion-customer']!,
    store = slug,
  ) =>
    request(app)
      .post(`/api/v1${path}`)
      .set('X-Tenant-Slug', store)
      .auth(token, { type: 'bearer' });
  const get = (
    path: string,
    token = tokens['fashion-customer']!,
    store = slug,
  ) =>
    request(app)
      .get(`/api/v1${path}`)
      .set('X-Tenant-Slug', store)
      .auth(token, { type: 'bearer' });
  const stock = (warehouseId: string, variantId = tee) =>
    testPrisma.inventory.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId, variantId } },
    });
  const add = async (variantId = tee, quantity = 2) => {
    const response = await post('/cart/items').send({ variantId, quantity });
    expect(response.status).toBe(200);
    return response;
  };
  const place = (address = addressKw, key = randomUUID()) =>
    post('/checkout')
      .set('Idempotency-Key', key)
      .send({ shippingAddressId: address, paymentMethod: 'CASH_ON_DELIVERY' });
  beforeAll(async () => {
    countriesBefore = (
      await testPrisma.country.findMany({
        where: { code: { in: ['KW', 'SA', 'EG'] } },
        select: { code: true },
      })
    ).map((row) => row.code);
    await testPrisma.tenant.create({
      data: {
        id: unrelatedId,
        slug: unrelatedSlug,
        code: unrelatedSlug,
        name: 'Unrelated merchant fixture',
        status: 'SUSPENDED',
        defaultCurrency: 'USD',
      },
    });
    await testPrisma.appSetting.create({
      data: {
        tenantId: unrelatedId,
        key: 'private-existing-setting',
        value: { preserve: true },
        isPublic: false,
      },
    });
    await seedDevelopment(testPrisma, fixture.password);
    initialStock = await testPrisma.inventory.findMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
      select: { id: true, quantity: true },
    });
    initialCoverage = await testPrisma.warehouseCoverage.findMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    const passwordHash = await hashPassword(fixture.password);
    const accounts = [
      ['fashion-owner', tenantId, 'OWNER'],
      ['fashion-admin', tenantId, 'ADMIN'],
      ['fashion-manager', tenantId, 'MANAGER'],
      ['fashion-customer', tenantId, 'CUSTOMER'],
      ['fashion-unverified', tenantId, 'CUSTOMER'],
      ['independent-owner', otherTenantId, 'OWNER'],
      ['independent-customer', otherTenantId, 'CUSTOMER'],
    ] as const;
    await testPrisma.$transaction(async (tx) => {
      for (const [key, memberTenantId, role] of accounts) {
        const id = developmentId(`user:${key}`);
        await tx.user.create({
          data: {
            id,
            email: `${key}@automated-commerce.example.test`,
            passwordHash,
            firstName: 'Automated',
            lastName: key,
            emailVerifiedAt: key === 'fashion-unverified' ? null : new Date(),
            tenantMemberships: { create: { tenantId: memberTenantId, role } },
          },
        });
        if (key !== 'fashion-customer' && key !== 'independent-customer')
          continue;
        for (const country of key === 'fashion-customer'
          ? ['KW', 'SA']
          : ['SA']) {
          await tx.address.create({
            data: {
              id: developmentId(`address:${key}:${country}`),
              userId: id,
              firstName: 'Automated',
              lastName: key,
              addressLine1: 'Fixture delivery address',
              city: country === 'KW' ? 'Kuwait City' : 'Riyadh',
              countryCode: country,
              latitude: country === 'KW' ? '29.3759' : '24.7136',
              longitude: country === 'KW' ? '47.9774' : '46.6753',
              isDefaultShipping:
                country === (key === 'fashion-customer' ? 'KW' : 'SA'),
              isDefaultBilling:
                country === (key === 'fashion-customer' ? 'KW' : 'SA'),
            },
          });
        }
      }
    });
    createdUsers.push(...accounts.map(([key]) => developmentId(`user:${key}`)));
    for (const [key] of accounts) {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: `${key}@automated-commerce.example.test`,
          password: fixture.password,
        });
      expect(login.status).toBe(200);
      tokens[key] = login.body.data.accessToken;
    }
  });
  beforeEach(async () => {
    // Fresh limiter budgets per journey; the middleware itself remains enabled.
    globalRateLimiter.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
    globalRateLimiter.resetKey('127.0.0.1');
    sensitiveRateLimiter.resetKey(`${tenantId}:${customerId}`);
    sensitiveRateLimiter.resetKey(
      `${otherTenantId}:${developmentId('user:independent-customer')}`,
    );
    await testPrisma.couponUsage.deleteMany({
      where: { coupon: { tenantId: { in: [tenantId, otherTenantId] } } },
    });
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: [tenantId, otherTenantId] } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.inventoryTransaction.deleteMany({
      where: {
        inventory: { tenantId: { in: [tenantId, otherTenantId] } },
        referenceId: { not: 'DEV81_INITIAL_STOCK' },
      },
    });
    for (const row of initialStock)
      await testPrisma.inventory.update({
        where: { id: row.id },
        data: { quantity: row.quantity, reservedQuantity: 0 },
      });
    await testPrisma.cartItem.deleteMany({
      where: { cart: { tenantId: { in: [tenantId, otherTenantId] } } },
    });
    await testPrisma.warehouseCoverage.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.warehouseCoverage.createMany({ data: initialCoverage });
    await testPrisma.warehouse.updateMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
      data: { isDefault: false },
    });
    await testPrisma.warehouse.update({
      where: { id: kw },
      data: { isDefault: true },
    });
    await testPrisma.warehouse.update({
      where: { id: developmentId('warehouse:independent:saudi') },
      data: { isDefault: true },
    });
    await testPrisma.tenant.updateMany({
      where: { id: { in: [tenantId, otherTenantId] } },
      data: { status: 'ACTIVE' },
    });
    await testPrisma.tenantOrderPolicy.update({
      where: { tenantId },
      data: {
        minOrderAmount: '5',
        maxOrderAmount: '250',
        maxOrderItems: 20,
        maxDistinctItems: 5,
        maxQuantityPerItem: 10,
      },
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Unexpected provider IO in local NONE scenarios'),
    );
  });
  afterAll(async () => {
    const seededTenantIds = developmentStores.map(({ key }) =>
      developmentId(`tenant:${key}`),
    );
    await testPrisma.couponUsage.deleteMany({
      where: { coupon: { tenantId: { in: seededTenantIds } } },
    });
    await testPrisma.checkoutRequest.deleteMany({
      where: { tenantId: { in: seededTenantIds } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: seededTenantIds } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: seededTenantIds } },
    });
    await testPrisma.inventory.deleteMany({
      where: { tenantId: { in: seededTenantIds } },
    });
    await testPrisma.warehouse.deleteMany({
      where: { tenantId: { in: seededTenantIds } },
    });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId: { in: seededTenantIds } } },
    });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [...seededTenantIds, unrelatedId] } },
    });
    await testPrisma.user.deleteMany({
      where: {
        id: {
          in: [
            ...Object.keys(tokens).map((key) => developmentId(`user:${key}`)),
            ...createdUsers,
            ...[
              'admin@example.com',
              'manager@example.com',
              'customer1@example.com',
              'customer2@example.com',
            ].map((email) => developmentId(`user:${email}`)),
          ],
        },
      },
    });
    await testPrisma.country.deleteMany({
      where: {
        code: {
          in: ['KW', 'SA', 'EG'].filter(
            (code) => !countriesBefore.includes(code),
          ),
        },
      },
    });
    await rm(fixture.outbox, { recursive: true, force: true });
    await testPrisma.$disconnect();
  });
  it('seeds repeatably without duplicating data or resetting reservations and merchant policy edits', async () => {
    const before = await testPrisma.inventory.count();
    const original = await stock(kw);
    await testPrisma.inventory.update({
      where: { id: original.id },
      data: { quantity: 19, reservedQuantity: 1 },
    });
    await testPrisma.tenantOrderPolicy.update({
      where: { tenantId },
      data: { maxOrderAmount: '249' },
    });
    await seedDevelopment(testPrisma, fixture.password);
    expect(await testPrisma.inventory.count()).toBe(before);
    expect(await stock(kw)).toMatchObject({
      quantity: 19,
      reservedQuantity: 1,
    });
    expect(
      (
        await testPrisma.tenantOrderPolicy.findUniqueOrThrow({
          where: { tenantId },
        })
      ).maxOrderAmount?.toString(),
    ).toBe('249');
    expect((await verifyDevelopmentSeed(testPrisma)).stores).toEqual([
      { slug, currency: 'KWD', warehouses: 2, inventoryRows: 12 },
      { slug: otherSlug, currency: 'SAR', warehouses: 1, inventoryRows: 6 },
      ...developmentStores.slice(2).map((store) => ({
        slug: store.slug,
        currency: store.currency,
        warehouses: 1,
        inventoryRows: 3,
      })),
    ]);
    expect(
      await testPrisma.tenant.findUniqueOrThrow({ where: { id: unrelatedId } }),
    ).toMatchObject({
      name: 'Unrelated merchant fixture',
      status: 'SUSPENDED',
      defaultCurrency: 'USD',
    });
    expect(
      (
        await testPrisma.appSetting.findUniqueOrThrow({
          where: {
            tenantId_key: {
              tenantId: unrelatedId,
              key: 'private-existing-setting',
            },
          },
        })
      ).value,
    ).toEqual({ preserve: true });
  });
  it('refuses a storefront namespace collision without overwriting unrelated merchant data', async () => {
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: { slug: `${slug}-moved` },
    });
    await testPrisma.tenant.update({
      where: { id: unrelatedId },
      data: { slug },
    });
    try {
      await expect(
        seedDevelopment(testPrisma, fixture.password),
      ).rejects.toThrow(
        /Collision: Tenant slug .* is owned by unrelated tenant ID/,
      );
      expect(
        (
          await testPrisma.tenant.findUniqueOrThrow({
            where: { id: unrelatedId },
          })
        ).name,
      ).toBe('Unrelated merchant fixture');
    } finally {
      await testPrisma.tenant.update({
        where: { id: unrelatedId },
        data: { slug: unrelatedSlug },
      });
      await testPrisma.tenant.update({
        where: { id: tenantId },
        data: { slug },
      });
    }
  });
  it('registers, enrolls, verifies through the private outbox, refreshes authentication and checks out', async () => {
    const bootstrap = await request(app)
      .get('/api/v1/storefront')
      .set('X-Tenant-Slug', slug);
    expect(bootstrap.body.data).toMatchObject({ slug, currency: 'KWD' });
    const email = `new-${randomUUID()}@example.test`;
    const registered = await request(app).post('/api/v1/auth/register').send({
      email,
      password: fixture.password,
      firstName: 'New',
      lastName: 'Customer',
      role: 'ADMIN',
    });
    expect(registered.status).toBe(201);
    expect(registered.body.data).toMatchObject({
      email,
      role: 'CUSTOMER',
      emailVerifiedAt: null,
    });
    registeredId = registered.body.data.id;
    createdUsers.push(registeredId);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: fixture.password });
    expect(login.status).toBe(200);
    registeredToken = login.body.data.accessToken;
    const enrolled = await post('/storefront/enroll', registeredToken).send({});
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.data).toMatchObject({
      tenantId,
      userId: registeredId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });
    expect(
      (await post('/storefront/enroll', registeredToken).send({})).status,
    ).toBe(200);
    expect(
      (
        await post('/storefront/enroll', registeredToken).send({
          role: 'OWNER',
        })
      ).status,
    ).toBe(400);
    const address = await post('/addresses', registeredToken).send({
      firstName: 'New',
      lastName: 'Customer',
      addressLine1: 'Development destination',
      city: 'Kuwait City',
      country: 'KW',
      latitude: 29.3759,
      longitude: 47.9774,
    });
    expect(address.status).toBe(201);
    expect(
      (
        await post('/checkout/preview', registeredToken).send({
          shippingAddressId: address.body.data.id,
        })
      ).status,
    ).toBe(403);
    const messages = await Promise.all(
      (await readdir(fixture.outbox)).map(async (file) =>
        z
          .object({ email: z.string(), verificationToken: z.string() })
          .passthrough()
          .parse(
            JSON.parse(await readFile(join(fixture.outbox, file), 'utf8')),
          ),
      ),
    );
    const message = messages.find((row) => row.email === email);
    expect(message).toBeDefined();
    expect(
      (
        await request(app)
          .get('/api/v1/auth/verify-email')
          .query({ token: message!.verificationToken })
      ).status,
    ).toBe(200);
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken });
    expect(refreshed.status).toBe(200);
    registeredToken = refreshed.body.data.accessToken;
    expect((await get('/cart', registeredToken)).status).toBe(200);
    expect(
      (
        await post('/cart/items', registeredToken).send({
          variantId: tee,
          quantity: 1,
        })
      ).status,
    ).toBe(200);
    const order = await post('/checkout', registeredToken)
      .set('Idempotency-Key', randomUUID())
      .send({
        shippingAddressId: address.body.data.id,
        paymentMethod: 'CASH_ON_DELIVERY',
      });
    expect(order.status).toBe(201);
    expect(order.body.data.order).toMatchObject({
      warehouseId: kw,
      currency: 'KWD',
    });
    expect(
      (await get(`/orders/my/${order.body.data.order.id}`, registeredToken))
        .status,
    ).toBe(200);
  });
  it('enrolls an existing identity into another store without duplicates or reactivating suspended memberships', async () => {
    const [http, first, second] = await Promise.all([
      post('/storefront/enroll', registeredToken, otherSlug).send({}),
      enrollCustomer(otherTenantId, registeredId),
      enrollCustomer(otherTenantId, registeredId),
    ]);
    expect([200, 201]).toContain(http.status);
    expect(
      [http.status === 201, first.created, second.created].filter(Boolean),
    ).toHaveLength(1);
    expect([
      http.body.data.role,
      first.membership.role,
      second.membership.role,
    ]).toEqual(['CUSTOMER', 'CUSTOMER', 'CUSTOMER']);
    expect(
      await testPrisma.tenantMember.count({
        where: { tenantId: otherTenantId, userId: registeredId },
      }),
    ).toBe(1);
    expect(
      (await get('/cart', registeredToken, otherSlug)).body.data.items,
    ).toEqual([]);
    await testPrisma.tenantMember.update({
      where: {
        tenantId_userId: { tenantId: otherTenantId, userId: registeredId },
      },
      data: { status: 'SUSPENDED' },
    });
    await expect(
      enrollCustomer(otherTenantId, registeredId),
    ).rejects.toMatchObject({ code: 'TENANT_MEMBERSHIP_INACTIVE' });
    expect((await get('/cart', registeredToken)).status).toBe(200);
    await testPrisma.tenant.update({
      where: { id: otherTenantId },
      data: { status: 'SUSPENDED' },
    });
    expect(
      (await post('/storefront/enroll', registeredToken, otherSlug).send({}))
        .status,
    ).toBe(401);
  });
  it('fulfills Kuwait delivery with authoritative totals, snapshots, reservation and idempotent replay', async () => {
    const browse = await get('/products');
    expect(browse.status).toBe(200);
    expect(browse.body.data.items).toHaveLength(3);
    await add();
    const options = await post('/checkout/shipping-options').send({
      shippingAddressId: addressKw,
    });
    expect(options.status).toBe(200);
    const preview = await post('/checkout/preview').send({
      shippingAddressId: addressKw,
    });
    expect(preview.body.data).toMatchObject({
      currency: 'KWD',
      subtotal: '25',
      shippingAmount: '1.25',
      taxAmount: '0',
      totalAmount: '26.25',
      fulfillment: { warehouseId: kw },
    });
    const key = randomUUID();
    const order = await place(addressKw, key);
    expect(order.status).toBe(201);
    expect(order.body.data.order).toMatchObject({
      warehouseId: kw,
      currency: 'KWD',
      shippingAmount: '1.25',
      totalAmount: '26.25',
      fulfillmentSnapshot: { warehouseId: kw, countryCode: 'KW' },
      shippingAddress: { country: 'KW' },
    });
    expect((await place(addressKw, key)).status).toBe(200);
    expect(await stock(kw)).toMatchObject({
      quantity: 20,
      reservedQuantity: 2,
    });
    expect(await stock(sa)).toMatchObject({ quantity: 8, reservedQuantity: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['INVITED', 'SUSPENDED', 'REMOVED'] as const)(
    'does not reactivate a %s membership through customer enrollment',
    async (status) => {
      await testPrisma.tenantMember.update({
        where: {
          tenantId_userId: { tenantId: otherTenantId, userId: registeredId },
        },
        data: { status },
      });
      const result = await post(
        '/storefront/enroll',
        registeredToken,
        otherSlug,
      ).send({});
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('TENANT_MEMBERSHIP_INACTIVE');
      expect(
        (
          await testPrisma.tenantMember.findUniqueOrThrow({
            where: {
              tenantId_userId: {
                tenantId: otherTenantId,
                userId: registeredId,
              },
            },
          })
        ).status,
      ).toBe(status);
    },
  );
  it('fulfills Saudi delivery from the destination-eligible source with enough whole-cart stock', async () => {
    await add(medium, 5);
    const preview = await post('/checkout/preview').send({
      shippingAddressId: addressSa,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      currency: 'KWD',
      subtotal: '62.5',
      taxAmount: '9.375',
      fulfillment: { warehouseId: sa },
    });
    const order = await place(addressSa);
    expect(order.status).toBe(201);
    expect(order.body.data.order.warehouseId).toBe(sa);
    expect(await stock(sa, medium)).toMatchObject({
      quantity: 15,
      reservedQuantity: 5,
    });
    expect((await stock(kw, medium)).reservedQuantity).toBe(0);
  });
  it('uses explicit cross-border coverage and the actual source distance', async () => {
    expect(
      (
        await request(app)
          .put(`/api/v1/warehouses/${kw}/coverage`)
          .set('X-Tenant-Slug', slug)
          .auth(tokens['fashion-owner']!, { type: 'bearer' })
          .send({ countries: ['KW', 'SA'] })
      ).status,
    ).toBe(200);
    await add(denim, 3);
    const options = await post('/checkout/shipping-options').send({
      shippingAddressId: addressSa,
    });
    expect(options.status).toBe(200);
    expect(
      options.body.data.options.every(
        (row: { methodCode: string }) => row.methodCode === 'standard',
      ),
    ).toBe(true);
    const order = await place(addressSa);
    expect(order.status).toBe(201);
    expect(order.body.data.order).toMatchObject({
      warehouseId: kw,
      shippingMethodCode: 'standard',
      shippingAmount: '3.75',
      totalAmount: '72.75',
    });
  });
  it('rejects unsupported delivery without creating orders, payments or reservations and retains the cart', async () => {
    const categoryId = developmentId('tax:fashion');
    await testPrisma.taxProfile.create({
      data: {
        tenantId,
        countryCode: 'EG',
        currency: 'KWD',
        pricesIncludeTax: false,
        defaultTaxCategoryId: categoryId,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: categoryId, countryCode: 'EG', rate: 0 },
    });
    await add();
    const address = await post('/addresses').send({
      firstName: 'Development',
      lastName: 'Buyer',
      addressLine1: 'Unsupported destination',
      city: 'Cairo',
      country: 'EG',
    });
    expect(address.status).toBe(201);
    const result = await place(address.body.data.id);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('NO_ELIGIBLE_FULFILLMENT_WAREHOUSE');
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(0);
    expect(
      await testPrisma.payment.count({ where: { order: { tenantId } } }),
    ).toBe(0);
    expect((await stock(kw)).reservedQuantity).toBe(0);
    expect((await get('/cart')).body.data.itemCount).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects sufficient aggregate stock when neither eligible source can fulfill the entire cart', async () => {
    await request(app)
      .put(`/api/v1/warehouses/${kw}/coverage`)
      .set('X-Tenant-Slug', slug)
      .auth(tokens['fashion-owner']!, { type: 'bearer' })
      .send({ countries: ['KW', 'SA'] });
    await add(medium, 5);
    await add(denim, 3);
    const result = await place(addressSa);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('NO_ELIGIBLE_FULFILLMENT_WAREHOUSE');
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(0);
    expect((await get('/cart')).body.data.itemCount).toBe(8);
    expect(
      (await testPrisma.inventory.findMany({ where: { tenantId } })).every(
        (row) => row.reservedQuantity === 0,
      ),
    ).toBe(true);
  });
  it('enforces every tenant limit in preview and final checkout without changing the cart', async () => {
    const cases = [
      { data: { minOrderAmount: '30' }, code: 'ORDER_MIN_AMOUNT_NOT_MET' },
      { data: { maxOrderAmount: '20' }, code: 'ORDER_MAX_AMOUNT_EXCEEDED' },
      { data: { maxOrderItems: 1 }, code: 'ORDER_MAX_ITEMS_EXCEEDED' },
      {
        data: { maxQuantityPerItem: 1 },
        code: 'ORDER_MAX_QUANTITY_PER_ITEM_EXCEEDED',
      },
      {
        data: { maxDistinctItems: 1 },
        code: 'ORDER_MAX_DISTINCT_ITEMS_EXCEEDED',
      },
    ];
    for (const row of cases) {
      sensitiveRateLimiter.resetKey(`${tenantId}:${customerId}`);
      await testPrisma.tenantOrderPolicy.update({
        where: { tenantId },
        data: {
          minOrderAmount: '5',
          maxOrderAmount: '250',
          maxOrderItems: 20,
          maxDistinctItems: 5,
          maxQuantityPerItem: 10,
        },
      });
      await request(app)
        .delete('/api/v1/cart')
        .set('X-Tenant-Slug', slug)
        .auth(tokens['fashion-customer']!, { type: 'bearer' });
      if (row.code === 'ORDER_MAX_DISTINCT_ITEMS_EXCEEDED') {
        await add(tee, 1);
        await add(medium, 1);
      } else await add();
      const policy = await request(app)
        .patch('/api/v1/order-policy')
        .set('X-Tenant-Slug', slug)
        .auth(tokens['fashion-owner']!, { type: 'bearer' })
        .send(row.data);
      expect(policy.status).toBe(200);
      const preview = await post('/checkout/preview').send({
        shippingAddressId: addressKw,
      });
      expect(preview.body.code).toBe(row.code);
      const order = await place();
      expect(order.status).toBe(409);
      expect(order.body.code).toBe(row.code);
      expect((await get('/cart')).body.data.itemCount).toBe(2);
    }
  });
  it('uses discounted merchandise, excluding tax and shipping, with tenant currency precision', async () => {
    await add();
    const policy = await request(app)
      .patch('/api/v1/order-policy')
      .set('X-Tenant-Slug', slug)
      .auth(tokens['fashion-owner']!, { type: 'bearer' })
      .send({ minOrderAmount: '22.500', maxOrderAmount: '22.500' });
    expect(policy.status).toBe(200);
    const preview = await post('/checkout/preview').send({
      shippingAddressId: addressSa,
      couponCode: 'DEV81SAVE10',
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      currency: 'KWD',
      subtotal: '25',
      couponDiscount: '2.5',
      taxAmount: '3.375',
      shippingAmount: '1.25',
      totalAmount: '27.125',
    });
    expect(
      preview.body.data.taxBreakdown.every(
        (row: { taxRate: string }) => row.taxRate === '15',
      ),
    ).toBe(true);
    expect(
      (
        await request(app)
          .patch('/api/v1/order-policy')
          .set('X-Tenant-Slug', slug)
          .auth(tokens['fashion-owner']!, { type: 'bearer' })
          .send({ maxOrderAmount: '22.5001' })
      ).status,
    ).toBe(400);
  });
  it.each(['PAID', 'FAILED'] as const)(
    'records a local NONE payment as %s against the original source after the default changes',
    async (status) => {
      await add();
      const result = await place();
      expect(result.status).toBe(201);
      const changed = await request(app)
        .patch(`/api/v1/warehouses/${sa}`)
        .set('X-Tenant-Slug', slug)
        .auth(tokens['fashion-owner']!, { type: 'bearer' })
        .send({ isDefault: true });
      expect(changed.status).toBe(200);
      const orderId: string = result.body.data.order.id;
      const paymentId: string = result.body.data.payment.id;
      expect(
        (await post(`/payments/${paymentId}/initiate`).send({})).status,
      ).toBe(200);
      if (status === 'PAID') {
        const directBlocked = await request(app)
          .patch(`/api/v1/payments/${paymentId}/status`)
          .set('X-Tenant-Slug', slug)
          .auth(tokens['fashion-owner']!, { type: 'bearer' })
          .send({ status: 'PAID' });
        expect(directBlocked.status).toBe(409);
        expect(directBlocked.body.code).toBe(
          'COD_PAYMENT_CONFIRMATION_REQUIRED',
        );
        for (const nextStatus of [
          'PROCESSING',
          'SHIPPED',
          'DELIVERED',
        ] as const) {
          const step = await request(app)
            .patch(`/api/v1/orders/${orderId}/status`)
            .set('X-Tenant-Slug', slug)
            .auth(tokens['fashion-owner']!, { type: 'bearer' })
            .send({ status: nextStatus });
          expect(step.status).toBe(200);
        }
        const confirmed = await request(app)
          .post(`/api/v1/orders/${orderId}/cod/confirm-payment`)
          .set('X-Tenant-Slug', slug)
          .auth(tokens['fashion-owner']!, { type: 'bearer' })
          .send({
            referenceId: `e2e-cod-${orderId}`,
            collectedAmount: result.body.data.order.totalAmount,
            currency: result.body.data.order.currency,
          });
        expect(confirmed.status).toBe(200);
      } else {
        const updated = await request(app)
          .patch(`/api/v1/payments/${paymentId}/status`)
          .set('X-Tenant-Slug', slug)
          .auth(tokens['fashion-owner']!, { type: 'bearer' })
          .send({ status });
        expect(updated.status).toBe(200);
      }
      expect(await stock(kw)).toMatchObject({
        quantity: status === 'PAID' ? 18 : 20,
        reservedQuantity: 0,
      });
      expect(await stock(sa)).toMatchObject({
        quantity: 8,
        reservedQuantity: 0,
      });
      expect((await get(`/payments/${paymentId}`)).body.data.status).toBe(
        status,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('expires an uninitiated reservation safely and fences a replayed worker claim', async () => {
    await add();
    const result = await post('/checkout')
      .set('Idempotency-Key', randomUUID())
      .send({
        shippingAddressId: addressKw,
        paymentMethod: 'CARD',
        paymentProvider: 'NONE',
      });
    expect(result.status).toBe(201);
    await testPrisma.$executeRaw`UPDATE "Order" SET "reservationExpiresAt"=clock_timestamp()-interval '1 second' WHERE "id"=${result.body.data.order.id}`;
    const repository = new RecoveryRepository(testPrisma);
    await repository.enqueue(10);
    const job = (await repository.claim(1, 60000))[0]!;
    expect(job.orderId).toBe(result.body.data.order.id);
    const recovery = new RecoveryService(repository);
    expect(await recovery.process(job)).toBe('EXPIRED');
    expect(await recovery.process(job)).toBe('LEASE_LOST');
    expect(await stock(kw)).toMatchObject({
      quantity: 20,
      reservedQuantity: 0,
    });
    expect((await stock(sa)).reservedQuantity).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('isolates merchant staff, customer orders, warehouse stock, policies and private settings', async () => {
    const foreignWarehouse = developmentId('warehouse:independent:saudi');
    const foreignStock = await testPrisma.inventory.findFirstOrThrow({
      where: { tenantId: otherTenantId },
    });
    expect(
      (await get(`/warehouses/${foreignWarehouse}`, tokens['fashion-manager']!))
        .status,
    ).toBe(404);
    expect(
      (await get(`/inventory/${foreignStock.id}`, tokens['fashion-manager']!))
        .status,
    ).toBe(404);
    expect(
      (await get('/order-policy', tokens['fashion-manager']!, otherSlug))
        .status,
    ).toBe(401);
    expect(
      (
        await get(
          '/app-settings/admin/all',
          tokens['fashion-manager']!,
          otherSlug,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          `/inventory/${foreignStock.id}/stock-in`,
          tokens['fashion-manager']!,
        ).send({ quantity: 1 })
      ).status,
    ).toBe(404);
    await testPrisma.appSetting.create({
      data: {
        tenantId: otherTenantId,
        key: 'private-operational-fixture',
        value: 'not-public',
        isPublic: false,
      },
    });
    expect(
      JSON.stringify(
        (
          await request(app)
            .get('/api/v1/storefront')
            .set('X-Tenant-Slug', otherSlug)
        ).body,
      ),
    ).not.toContain('not-public');
    const added = await post(
      '/cart/items',
      tokens['independent-customer']!,
      otherSlug,
    ).send({
      variantId: developmentId('variant:independent:tee:small'),
      quantity: 2,
    });
    expect(added.status).toBe(200);
    const order = await post(
      '/checkout',
      tokens['independent-customer']!,
      otherSlug,
    )
      .set('Idempotency-Key', randomUUID())
      .send({
        shippingAddressId: developmentId('address:independent-customer:SA'),
        paymentMethod: 'CASH_ON_DELIVERY',
      });
    expect(order.status).toBe(201);
    expect((await get(`/orders/my/${order.body.data.order.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await get(
          `/orders/${order.body.data.order.id}`,
          tokens['fashion-manager']!,
        )
      ).status,
    ).toBe(404);
  });
});
