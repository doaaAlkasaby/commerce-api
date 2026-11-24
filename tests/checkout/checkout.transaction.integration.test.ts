import { randomUUID } from 'node:crypto';
import { ensureFixtureMembership } from '../helpers/warehouse.js';
import { createShippingProfileFixture } from '../helpers/warehouse.js';
import { createCartFixture } from '../helpers/warehouse.js';
import {
  createInventoryFixture,
  deleteFixtureTenant,
  deleteFixtureTenants,
} from '../helpers/warehouse.js';
import { CouponRepository } from '../../src/modules/coupons/coupon.repository.js';
import { CartService } from '../../src/modules/cart/cart.service.js';
import { createProductRepository } from '../../src/modules/products/product.repository.js';
import type { CheckoutPreviewInput } from '../../src/modules/checkout/checkout.types.js';
import type {
  ShippingProfile,
  ShippingRule,
} from '../../src/generated/prisma/client.js';
import { CashOnDeliveryProvider } from '../../src/modules/payments/providers/cash-on-delivery.provider.js';
import { TaxService } from '../../src/common/tax/tax.service.js';
import { TaxRepository } from '../../src/common/tax/tax.repository.js';
import type { TaxRule, TaxProfile } from '../../src/generated/prisma/client.js';
import {
  OrderStatus,
  PaymentStatus,
} from '../../src/generated/prisma/client.js';
import { PaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { OrderRepository } from '../../src/modules/orders/order.repository.js';
import paymentRoutes from '../../src/modules/payments/payment.routes.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import type { PaymentProviderAdapter } from '../../src/modules/payments/providers/payment-provider.js';
import type {
  PaymentProviderCreateInput,
  PaymentProviderCreateResult,
} from '../../src/modules/payments/payment.types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../../src/config/env.js';
import checkoutRoutes from '../../src/modules/checkout/checkout.routes.js';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';
import { checkoutFingerprint } from '../../src/modules/checkout/checkout.idempotency.js';
import type {
  CheckoutInput,
  CheckoutResult,
} from '../../src/modules/checkout/checkout.types.js';
const execFileAsync = promisify(execFile);
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/modules/orders/order.routes.js';
import { OrderService } from '../../src/modules/orders/order.service.js';
import { inventoryService } from '../../src/modules/inventory/inventory.service.instance.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import {
  createTenantSchema,
  updateTenantSchema,
} from '../../src/modules/tenants/tenant.schemas.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  PaymentMethod,
  PaymentProvider,
  Prisma,
} from '../../src/generated/prisma/client.js';
import {
  CheckoutService,
  type CheckoutFailurePoint,
} from '../../src/modules/checkout/checkout.service.js';
import { testPrisma } from '../../src/config/test-database.js';

const enabled = process.env.RUN_CHECKOUT_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
const fixture = `checkout-it-${crypto.randomUUID()}`;

suite('checkout transaction against PostgreSQL', () => {
  let tenantId: string;
  let userId: string;
  let foreignAccessUserId: string;
  let countryCode: string;
  let addressId: string;
  let inventoryId: string;
  let couponId: string;
  let cartId: string;
  let variantId: string;
  let productId: string;
  let taxProfileId: string;
  let shippingProfileId: string;

  beforeAll(async () => {
    const country = await testPrisma.country.create({
      data: {
        code: `C${crypto.randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase()}`,
        name: 'Checkout Integration Country',
        currencyCode: 'USD',
      },
    });
    countryCode = country.code;
    const user = await testPrisma.user.create({
      data: {
        email: `${fixture}@example.test`,
        passwordHash: 'integration-test',
        firstName: 'Checkout',
        lastName: 'Tester',
      },
    });
    userId = user.id;
    foreignAccessUserId = (
      await testPrisma.user.create({
        data: {
          email: `${fixture}-foreign-access@example.test`,
          passwordHash: 'not-a-login',
          firstName: 'Foreign',
          lastName: 'Customer',
        },
      })
    ).id;
    const tenant = await testPrisma.tenant.create({
      data: {
        name: 'Checkout Integration Tenant',
        slug: fixture,
        code: fixture,
        defaultCurrency: 'EGP',
      },
    });
    tenantId = tenant.id;

    const address = await testPrisma.address.create({
      data: {
        userId,
        firstName: 'Checkout',
        lastName: 'Tester',
        addressLine1: '1 Test Street',
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
        name: 'Checkout Category',
        slug: `${fixture}-category`,
      },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Transaction Product',
        slug: `${fixture}-product`,
        basePrice: 20,
        status: 'ACTIVE',
      },
    });
    productId = product.id;
    const taxCategory = await testPrisma.taxCategory.create({
      data: { tenantId, code: `${fixture}-standard`, name: 'Standard tax' },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${fixture}-sku`,
        combinationKey: 'default',
        isActive: true,
        taxCategoryId: taxCategory.id,
      },
    });
    variantId = variant.id;
    const inventory = await createInventoryFixture({
      data: { variantId, quantity: 10, reservedQuantity: 0 },
    });
    inventoryId = inventory.id;
    const cart = await createCartFixture({ data: { tenantId, userId } });
    cartId = cart.id;

    const coupon = await testPrisma.coupon.create({
      data: {
        tenantId,
        code: `${fixture}-coupon`.toUpperCase(),
        discountType: 'FIXED_AMOUNT',
        discountValue: 2,
        usageLimit: 100,
      },
    });
    couponId = coupon.id;

    const taxProfile = await testPrisma.taxProfile.create({
      data: {
        tenantId,
        countryCode,
        currency: 'EGP',
        pricesIncludeTax: false,
        defaultTaxCategoryId: taxCategory.id,
      },
    });
    taxProfileId = taxProfile.id;
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: 5 },
    });
    const shippingProfile = await createShippingProfileFixture({
      data: {
        tenantId,
        countryCode,
        currency: 'EGP',
        originLatitude: 30,
        originLongitude: 30.5,
      },
    });
    shippingProfileId = shippingProfile.id;
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
      data: { methodId: method.id, flatRate: 3, maxDistanceKm: 50 },
    });
    await testPrisma.shippingRule.create({
      data: {
        methodId: method.id,
        minOrderAmount: 1000,
        flatRate: 1,
        maxDistanceKm: 50,
      },
    });
  });

  beforeEach(async () => {
    await ensureFixtureMembership(tenantId, userId);
    await testPrisma.cartItem.deleteMany({ where: { cartId } });
    await testPrisma.product.update({
      where: { id: productId },
      data: {
        basePrice: 20,
        discountType: null,
        discountValue: null,
      },
    });
    await testPrisma.cartItem.create({
      data: { cartId, variantId, quantity: 2 },
    });
  });

  afterEach(async () => {
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: { defaultCurrency: 'EGP' },
    });
    await testPrisma.taxProfile.update({
      where: { id: taxProfileId },
      data: { currency: 'EGP' },
    });
    await testPrisma.shippingProfile.update({
      where: { id: shippingProfileId },
      data: { currency: 'EGP' },
    });
    await testPrisma.paymentRefund.deleteMany({ where: { tenantId } });
    await testPrisma.checkoutRequest.deleteMany({ where: { userId } });
    await testPrisma.couponUsage.deleteMany({ where: { userId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { reservedQuantity: 0 },
    });
    await testPrisma.coupon.update({
      where: { id: couponId },
      data: { usageCount: 0 },
    });
    await testPrisma.cartItem.deleteMany({ where: { cartId } });
  });

  afterAll(async () => {
    await testPrisma.paymentRefund.deleteMany({ where: { tenantId } });
    await testPrisma.checkoutRequest.deleteMany({ where: { userId } });
    await testPrisma.couponUsage.deleteMany({ where: { userId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.cartItem.deleteMany({ where: { cartId } });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId } },
    });
    await deleteFixtureTenant({ where: { id: tenantId } });
    await testPrisma.address.delete({ where: { id: addressId } });
    await testPrisma.user.delete({ where: { id: foreignAccessUserId } });
    await testPrisma.user.delete({ where: { id: userId } });
    await testPrisma.country.delete({ where: { code: countryCode } });
  });

  const runCheckout = (
    failurePoint?: CheckoutFailurePoint,
    options: {
      useCoupon?: boolean;
      spoofAmounts?: boolean;
      clientCurrency?: string;
    } = {},
  ) => {
    const service = new CheckoutService((point) => {
      if (point === failurePoint)
        throw new Error(`Injected failure at ${point}`);
    });
    return service.checkout(
      {
        shippingAddressId: addressId,
        billingSameAsShipping: true,
        ...(options.useCoupon === false
          ? {}
          : { couponCode: `${fixture}-coupon`.toUpperCase() }),
        paymentMethod: PaymentMethod.CARD,
        paymentProvider: PaymentProvider.NONE,
        ...(options.clientCurrency ? { currency: options.clientCurrency } : {}),
        shippingMethodCode: `${fixture}-standard`,
        ...(options.spoofAmounts
          ? {
              subtotal: '999999.99',
              discountedSubtotal: '999999.99',
              totalAmount: '0.01',
              shippingAmount: '0.00',
              couponDiscount: '0.00',
            }
          : {}),
      },
      {
        tenantId,
        userId,
        idempotencyKey: `${crypto.randomUUID()}-checkout-key`,
      },
    );
  };

  const checkoutAtPrice = async (
    price: string,
    options: {
      useCoupon?: boolean;
      spoofAmounts?: boolean;
      productDiscount?: boolean;
    } = {},
  ) => {
    await testPrisma.product.update({
      where: { id: productId },
      data: {
        basePrice: price,
        discountType: options.productDiscount ? 'PERCENTAGE' : null,
        discountValue: options.productDiscount ? 10 : null,
      },
    });
    await testPrisma.cartItem.updateMany({
      where: { cartId },
      data: { quantity: 1 },
    });
    await runCheckout(undefined, options);
    return testPrisma.order.findFirstOrThrow({ where: { tenantId } });
  };

  const expectRolledBack = async () => {
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(0);
    expect(
      await testPrisma.orderItem.count({ where: { order: { tenantId } } }),
    ).toBe(0);
    expect(
      await testPrisma.payment.count({ where: { order: { tenantId } } }),
    ).toBe(0);
    expect(
      (
        await testPrisma.inventory.findUniqueOrThrow({
          where: { id: inventoryId },
        })
      ).reservedQuantity,
    ).toBe(0);
    expect(
      await testPrisma.inventoryTransaction.count({ where: { inventoryId } }),
    ).toBe(0);
    expect(
      (await testPrisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
        .usageCount,
    ).toBe(0);
    expect(await testPrisma.couponUsage.count({ where: { couponId } })).toBe(0);
    expect(await testPrisma.cartItem.count({ where: { cartId } })).toBe(1);
    expect(await testPrisma.checkoutRequest.count({ where: { userId } })).toBe(
      0,
    );
  };

  it('commits one order, payment, inventory reservation, coupon use, and cart clear', async () => {
    const result = await runCheckout();
    expect(result.idempotent).toBe(false);
    expect(await testPrisma.order.count({ where: { tenantId } })).toBe(1);
    const committedOrder = await testPrisma.order.findFirstOrThrow({
      where: { tenantId },
    });
    expect(Number(committedOrder.shippingDistanceKm)).toBeGreaterThan(48);
    expect(Number(committedOrder.shippingDistanceKm)).toBeLessThan(49);
    expect(Number(committedOrder.shippingAmount)).toBe(3);
    expect(
      await testPrisma.orderItem.count({ where: { order: { tenantId } } }),
    ).toBe(1);
    expect(
      await testPrisma.payment.count({ where: { order: { tenantId } } }),
    ).toBe(1);
    expect(
      await testPrisma.inventory.findUniqueOrThrow({
        where: { id: inventoryId },
      }),
    ).toMatchObject({ reservedQuantity: 2 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RESERVATION' },
      }),
    ).toBe(1);
    expect(
      (await testPrisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
        .usageCount,
    ).toBe(1);
    expect(await testPrisma.couponUsage.count({ where: { couponId } })).toBe(1);
    expect(await testPrisma.cartItem.count({ where: { cartId } })).toBe(0);
    expect(await testPrisma.checkoutRequest.count({ where: { userId } })).toBe(
      1,
    );
    expect(
      (await testPrisma.order.findFirstOrThrow({ where: { tenantId } }))
        .tenantId,
    ).toBe(tenantId);
    expect(result.order.id).toBeTruthy();
  });

  it('uses the configured tenant currency for the order, fixed coupon, shipping, tax, and payment', async () => {
    const result = await runCheckout();
    expect(result.order.currency).toBe('EGP');
    expect(result.payment?.currency).toBe('EGP');
    expect(new Prisma.Decimal(result.order.discountAmount).equals('2.00')).toBe(
      true,
    );
    expect(new Prisma.Decimal(result.order.shippingAmount).equals('3.00')).toBe(
      true,
    );
    expect(new Prisma.Decimal(result.order.taxAmount).equals('1.90')).toBe(
      true,
    );
    expect(
      await testPrisma.payment.findFirstOrThrow({
        where: { order: { tenantId } },
      }),
    ).toMatchObject({ currency: 'EGP' });
  });

  it('ignores a conflicting client currency and keeps the tenant currency authoritative', async () => {
    const result = await runCheckout(undefined, { clientCurrency: 'USD' });
    expect(result.order.currency).toBe('EGP');
    expect(result.payment?.currency).toBe('EGP');
  });

  it('fails with a controlled error when tenant currency is missing', async () => {
    await testPrisma.tenant.update({
      where: { id: tenantId },
      data: { defaultCurrency: null },
    });
    await expect(runCheckout()).rejects.toMatchObject({
      code: 'TENANT_CURRENCY_NOT_CONFIGURED',
      statusCode: 500,
    });
    await expectRolledBack();
  });

  it.each(['ZZZ', 'usd', '12!'])(
    'rejects invalid configured currency %s before writing checkout',
    async (currency) => {
      await testPrisma.tenant.update({
        where: { id: tenantId },
        data: { defaultCurrency: currency },
      });
      await expect(runCheckout()).rejects.toMatchObject({ statusCode: 500 });
      await expectRolledBack();
    },
  );

  it('validates ISO currency codes in tenant configuration input', () => {
    expect(
      createTenantSchema.safeParse({
        name: 'Currency tenant',
        slug: 'currency-tenant',
        code: 'CURRENCY',
        defaultCurrency: 'ZZZ',
      }).success,
    ).toBe(false);
    expect(
      updateTenantSchema.safeParse({ defaultCurrency: 'ZZZ' }).success,
    ).toBe(false);
    expect(
      updateTenantSchema.parse({ defaultCurrency: 'egp' }).defaultCurrency,
    ).toBe('EGP');
  });

  it('rejects independent payment currency overrides and preserves stored payment currency', async () => {
    const result = await runCheckout(undefined, { clientCurrency: 'USD' });
    await expect(
      new PaymentService().createPayment(tenantId, {
        orderId: result.order.id,
        amount: result.order.totalAmount,
        currency: 'USD',
        method: PaymentMethod.CARD,
        provider: PaymentProvider.NONE,
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CURRENCY_MISMATCH' });
    const payments = await testPrisma.payment.findMany({
      where: { orderId: result.order.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.currency).toBe('EGP');
    expect(payments[0]!.amount.equals(result.order.totalAmount)).toBe(true);
    expect(new Prisma.Decimal(result.order.discountAmount).equals('2.00')).toBe(
      true,
    );
    expect(new Prisma.Decimal(result.order.shippingAmount).equals('3.00')).toBe(
      true,
    );
    expect(new Prisma.Decimal(result.order.taxAmount).equals('1.90')).toBe(
      true,
    );
  });

  describe('currency-aware money persistence and checkout', () => {
    it('validates effective coupon values on partial type and amount updates', async () => {
      const coupons = new CouponRepository(testPrisma);
      try {
        await testPrisma.tenant.update({
          where: { id: tenantId },
          data: { defaultCurrency: 'KWD' },
        });
        await coupons.update(tenantId, couponId, { discountValue: '0.001' });
        await expect(
          coupons.update(tenantId, couponId, { discountType: 'PERCENTAGE' }),
        ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_DISCOUNT' });
        expect((await coupons.findById(tenantId, couponId))?.discountType).toBe(
          'FIXED_AMOUNT',
        );
        await testPrisma.tenant.update({
          where: { id: tenantId },
          data: { defaultCurrency: 'USD' },
        });
        await expect(
          coupons.update(tenantId, couponId, { discountValue: '0.001' }),
        ).rejects.toMatchObject({
          statusCode: 400,
          code: 'INVALID_MONETARY_PRECISION',
        });
      } finally {
        await testPrisma.coupon.update({
          where: { id: couponId },
          data: { discountType: 'FIXED_AMOUNT', discountValue: '2' },
        });
      }
    });

    it.each([
      ['USD', '12.345'],
      ['JPY', '1234.56'],
      ['KWD', '0.0001'],
      ['KWD', '10000000000'],
    ])(
      'rejects invalid %s catalog price %s before storage',
      async (currency, price) => {
        await testPrisma.tenant.update({
          where: { id: tenantId },
          data: { defaultCurrency: currency },
        });
        await expect(
          createProductRepository(testPrisma).update(tenantId, productId, {
            basePrice: price,
          }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(
          (
            await testPrisma.product.findUniqueOrThrow({
              where: { id: productId },
            })
          ).basePrice.equals('20'),
        ).toBe(true);
      },
    );
    it.each([
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ])(
      'calculates KWD inclusive=%s fixed-coupon=%s and shipping threshold exactly',
      async (inclusive, fixed) => {
        const rules = await testPrisma.shippingRule.findMany({
          where: { method: { zone: { profileId: shippingProfileId } } },
        });
        try {
          await testPrisma.tenant.update({
            where: { id: tenantId },
            data: { defaultCurrency: 'KWD' },
          });
          await testPrisma.taxProfile.update({
            where: { id: taxProfileId },
            data: { currency: 'KWD', pricesIncludeTax: inclusive },
          });
          await testPrisma.shippingProfile.update({
            where: { id: shippingProfileId },
            data: { currency: 'KWD' },
          });
          await testPrisma.product.update({
            where: { id: productId },
            data: { basePrice: '1.005' },
          });
          await testPrisma.coupon.update({
            where: { id: couponId },
            data: {
              discountType: fixed ? 'FIXED_AMOUNT' : 'PERCENTAGE',
              discountValue: fixed ? '0.001' : '10',
              maximumDiscountAmount: fixed ? null : '0.101',
            },
          });
          for (const rule of rules)
            await testPrisma.shippingRule.update({
              where: { id: rule.id },
              data: {
                minOrderAmount: rule.minOrderAmount ? '1.909' : null,
                flatRate: rule.minOrderAmount ? '0' : '0.123',
              },
            });
          const result = await runCheckout();
          const stored = await testPrisma.order.findUniqueOrThrow({
            where: { id: result.order.id },
            include: { items: true },
          });
          expect(stored.subtotal.equals('2.010')).toBe(true);
          expect(stored.discountAmount.equals(fixed ? '0.001' : '0.101')).toBe(
            true,
          );
          expect(stored.shippingAmount.equals('0')).toBe(true);
          expect(
            stored.taxAmount.equals(
              fixed
                ? inclusive
                  ? '0.096'
                  : '0.100'
                : inclusive
                  ? '0.091'
                  : '0.095',
            ),
          ).toBe(true);
          expect(
            stored.totalAmount.equals(
              fixed
                ? inclusive
                  ? '2.009'
                  : '2.109'
                : inclusive
                  ? '1.909'
                  : '2.004',
            ),
          ).toBe(true);
        } finally {
          await testPrisma.taxProfile.update({
            where: { id: taxProfileId },
            data: { pricesIncludeTax: false },
          });
          await testPrisma.coupon.update({
            where: { id: couponId },
            data: {
              discountType: 'FIXED_AMOUNT',
              discountValue: '2',
              maximumDiscountAmount: null,
            },
          });
          for (const rule of rules)
            await testPrisma.shippingRule.update({
              where: { id: rule.id },
              data: rule,
            });
        }
      },
    );

    it.each([
      ['KWD', '0.001', '0.002'],
      ['USD', '0.01', '0.02'],
      ['SAR', '12.34', '24.68'],
      ['AED', '12.34', '24.68'],
      ['EGP', '12.34', '24.68'],
      ['JPY', '123', '246'],
      ['CLF', '0.0001', '0.0002'],
    ])(
      'persists exact %s prices, quantities, preview, payment and immutable currency',
      async (currency, price, expectedSubtotal) => {
        await testPrisma.tenant.update({
          where: { id: tenantId },
          data: { defaultCurrency: currency },
        });
        await testPrisma.taxProfile.update({
          where: { id: taxProfileId },
          data: { currency },
        });
        await testPrisma.shippingProfile.update({
          where: { id: shippingProfileId },
          data: { currency },
        });
        await testPrisma.product.update({
          where: { id: productId },
          data: { basePrice: price },
        });
        const input: CheckoutPreviewInput = {
          shippingAddressId: addressId,
          billingSameAsShipping: true,
          shippingMethodCode: `${fixture}-standard`,
        };
        const service = new CheckoutService();
        const cart = await new CartService().getCart(tenantId, userId);
        expect(new Prisma.Decimal(cart.subtotal).equals(expectedSubtotal)).toBe(
          true,
        );
        const preview = await service.preview(input, { tenantId, userId });
        const idempotencyKey = crypto.randomUUID();
        const result = await service.checkout(
          {
            ...input,
            paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
            paymentProvider: PaymentProvider.NONE,
          },
          { tenantId, userId, idempotencyKey },
        );
        expect(
          new Prisma.Decimal(result.order.subtotal).equals(expectedSubtotal),
        ).toBe(true);
        expect(result.order.totalAmount).toBe(preview.totalAmount);
        const stored = await testPrisma.order.findUniqueOrThrow({
          where: { id: result.order.id },
          include: { items: true, payments: true },
        });
        expect(stored.items[0]!.unitPrice.equals(price)).toBe(true);
        expect(stored.payments[0]!.amount.equals(stored.totalAmount)).toBe(
          true,
        );
        expect(stored.currency).toBe(currency);
        const expectedTax = new Prisma.Decimal(expectedSubtotal)
          .mul('0.05')
          .toDecimalPlaces(
            currency === 'JPY'
              ? 0
              : currency === 'KWD'
                ? 3
                : currency === 'CLF'
                  ? 4
                  : 2,
            Prisma.Decimal.ROUND_HALF_UP,
          );
        expect(stored.taxAmount.equals(expectedTax)).toBe(true);
        expect(
          stored.totalAmount.equals(
            new Prisma.Decimal(expectedSubtotal).add('3').add(expectedTax),
          ),
        ).toBe(true);
        await testPrisma.tenant.update({
          where: { id: tenantId },
          data: { defaultCurrency: currency === 'USD' ? 'KWD' : 'USD' },
        });
        const replay = await service.checkout(
          {
            ...input,
            paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
            paymentProvider: PaymentProvider.NONE,
          },
          { tenantId, userId, idempotencyKey },
        );
        expect(replay.order.id).toBe(result.order.id);
        expect(replay.order.currency).toBe(currency);
        expect(replay.order.totalAmount).toBe(result.order.totalAmount);
        await new PaymentService().initiatePayment(
          tenantId,
          userId,
          stored.payments[0]!.id,
        );
        const historical = await testPrisma.order.findUniqueOrThrow({
          where: { id: stored.id },
          include: { payments: true },
        });
        expect(historical.currency).toBe(currency);
        expect(historical.totalAmount.equals(stored.totalAmount)).toBe(true);
        expect(historical.payments[0]!.currency).toBe(currency);
      },
    );
  });

  it('persists a database-time online deadline without exposing new API fields', async () => {
    const [before] = await testPrisma.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    const result = await runCheckout();
    const [after] = await testPrisma.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    const stored = await testPrisma.order.findUniqueOrThrow({
      where: { id: result.order.id },
    });
    expect(stored.reservationExpiresAt?.getTime()).toBeGreaterThanOrEqual(
      before!.now.getTime() + env.RESERVATION_TTL_SECONDS * 1000,
    );
    expect(stored.reservationExpiresAt?.getTime()).toBeLessThanOrEqual(
      after!.now.getTime() + env.RESERVATION_TTL_SECONDS * 1000,
    );
    expect(result.order).not.toHaveProperty('reservationExpiresAt');
    expect(result.order).not.toHaveProperty('recoveryJob');
  });
  it('keeps COD deadlines absent and idempotent checkout snapshots unchanged', async () => {
    const input: CheckoutInput = {
      shippingAddressId: addressId,
      billingSameAsShipping: true,
      shippingMethodCode: `${fixture}-standard`,
      paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
      paymentProvider: PaymentProvider.NONE,
    };
    const context = { tenantId, userId, idempotencyKey: crypto.randomUUID() };
    const service = new CheckoutService();
    const result = await service.checkout(input, context);
    const replay = await service.checkout(input, context);
    expect(result.idempotent).toBe(false);
    expect(replay.idempotent).toBe(true);
    expect(replay.order).toEqual(result.order);
    expect(replay.payment).toEqual(result.payment);
    expect(
      (
        await testPrisma.order.findUniqueOrThrow({
          where: { id: result.order.id },
        })
      ).reservationExpiresAt,
    ).toBeNull();
    expect(
      await testPrisma.recoveryJob.count({
        where: { orderId: result.order.id },
      }),
    ).toBe(0);
  });

  it('rejects a shipping profile configured in another currency', async () => {
    await testPrisma.shippingProfile.update({
      where: { id: shippingProfileId },
      data: { currency: 'USD' },
    });
    await expect(runCheckout()).rejects.toMatchObject({
      code: 'SHIPPING_CURRENCY_MISMATCH',
      statusCode: 500,
    });
    await expectRolledBack();
  });

  it('rejects a tax profile configured in another currency', async () => {
    await testPrisma.taxProfile.update({
      where: { id: taxProfileId },
      data: { currency: 'USD' },
    });
    await expect(runCheckout()).rejects.toMatchObject({
      code: 'TAX_CURRENCY_MISMATCH',
      statusCode: 500,
    });
    await expectRolledBack();
  });

  it('uses the second tenant currency independently for a checkout', async () => {
    const otherFixture = `${fixture}-other`;
    const otherTenant = await testPrisma.tenant.create({
      data: {
        name: 'Second Currency Tenant',
        slug: otherFixture,
        code: otherFixture,
        defaultCurrency: 'USD',
      },
    });
    const category = await testPrisma.category.create({
      data: {
        tenantId: otherTenant.id,
        name: 'Second Currency Category',
        slug: `${otherFixture}-category`,
      },
    });
    const taxCategory = await testPrisma.taxCategory.create({
      data: {
        tenantId: otherTenant.id,
        code: `${otherFixture}-tax`,
        name: 'Second tenant tax',
      },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId: otherTenant.id,
        categoryId: category.id,
        name: 'Second Currency Product',
        slug: `${otherFixture}-product`,
        basePrice: 20,
        status: 'ACTIVE',
      },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${otherFixture}-sku`,
        combinationKey: 'default',
        isActive: true,
        taxCategoryId: taxCategory.id,
      },
    });
    const inventory = await createInventoryFixture({
      data: { variantId: variant.id, quantity: 10, reservedQuantity: 0 },
    });
    const cart = await createCartFixture({
      data: { tenantId: otherTenant.id, userId },
    });
    await testPrisma.cartItem.create({
      data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId: otherTenant.id,
        countryCode,
        currency: 'USD',
        pricesIncludeTax: false,
        defaultTaxCategoryId: taxCategory.id,
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: 5 },
    });
    const profile = await createShippingProfileFixture({
      data: {
        tenantId: otherTenant.id,
        countryCode,
        currency: 'USD',
        originLatitude: 30,
        originLongitude: 30.5,
      },
    });
    const zone = await testPrisma.shippingZone.create({
      data: {
        profileId: profile.id,
        code: `${otherFixture}-zone`,
        name: 'Second tenant zone',
        countryCode,
      },
    });
    const method = await testPrisma.shippingMethod.create({
      data: {
        zoneId: zone.id,
        code: `${otherFixture}-standard`,
        name: 'Standard',
      },
    });
    await testPrisma.shippingRule.create({
      data: { methodId: method.id, flatRate: 3, maxDistanceKm: 50 },
    });

    try {
      const result = await new CheckoutService().checkout(
        {
          shippingAddressId: addressId,
          billingSameAsShipping: true,
          paymentMethod: PaymentMethod.CARD,
          paymentProvider: PaymentProvider.NONE,
          currency: 'EGP',
          shippingMethodCode: `${otherFixture}-standard`,
        },
        {
          tenantId: otherTenant.id,
          userId,
          idempotencyKey: `${crypto.randomUUID()}-second-tenant-checkout`,
        },
      );
      expect(result.order.currency).toBe('USD');
      expect(result.payment?.currency).toBe('USD');
    } finally {
      await testPrisma.payment.deleteMany({
        where: { order: { tenantId: otherTenant.id } },
      });
      await testPrisma.checkoutRequest.deleteMany({
        where: { order: { tenantId: otherTenant.id } },
      });
      await testPrisma.order.deleteMany({
        where: { tenantId: otherTenant.id },
      });
      await testPrisma.inventoryTransaction.deleteMany({
        where: { inventoryId: inventory.id },
      });
      await testPrisma.taxRule.deleteMany({
        where: { taxCategory: { tenantId: otherTenant.id } },
      });
      await deleteFixtureTenant({ where: { id: otherTenant.id } });
    }
  });

  it('keeps a 999.99 merchandise subtotal below the minimum, excluding shipping, tax, and client amounts', async () => {
    const below = await checkoutAtPrice('999.99', {
      useCoupon: false,
      spoofAmounts: true,
    });
    expect(below.shippingAmount.toString()).toBe('3');
    expect(below.subtotal.toString()).toBe('999.99');
  });

  it('accepts the exact 1000.00 inclusive shipping minimum boundary', async () => {
    const exact = await checkoutAtPrice('1000.00', { useCoupon: false });
    expect(exact.subtotal.toString()).toBe('1000');
    expect(exact.shippingAmount.toString()).toBe('1');
  });

  it('accepts an amount above the shipping minimum', async () => {
    const above = await checkoutAtPrice('1000.01', { useCoupon: false });
    expect(above.shippingAmount.toString()).toBe('1');
  });

  it('uses product-discounted merchandise for the shipping minimum', async () => {
    const discountedProduct = await checkoutAtPrice('1100.00', {
      useCoupon: false,
      productDiscount: true,
    });
    expect(discountedProduct.subtotal.toString()).toBe('990');
    expect(discountedProduct.shippingAmount.toString()).toBe('3');
  });

  it('subtracts coupon discounts before evaluating the shipping minimum', async () => {
    const couponDiscounted = await checkoutAtPrice('1000.00');
    expect(couponDiscounted.discountAmount.toString()).toBe('2');
    expect(couponDiscounted.shippingAmount.toString()).toBe('3');
  });

  it('rolls back all writes when a failure occurs after order creation', async () => {
    await expect(runCheckout('after-order-created')).rejects.toThrow(
      'Injected failure',
    );
    await expectRolledBack();
  });

  it('rolls back inventory reservation when a later operation fails', async () => {
    await expect(runCheckout('after-inventory-reserved')).rejects.toThrow(
      'Injected failure',
    );
    await expectRolledBack();
  });

  it('rolls back coupon count and usage after coupon consumption fails later', async () => {
    await expect(runCheckout('after-coupon-consumed')).rejects.toThrow(
      'Injected failure',
    );
    await expectRolledBack();
  });

  it('rolls back all previous mutations when payment creation fails', async () => {
    await expect(runCheckout('before-payment-create')).rejects.toThrow(
      'Injected failure',
    );
    await expectRolledBack();
  });
  describe('immutable checkout snapshots (Point 8)', () => {
    let attributeId: string;
    let valueId: string;
    const originalAddress = () => ({
      userId,
      firstName: 'Checkout',
      lastName: 'Tester',
      addressLine1: '1 Test Street',
      city: 'Test City',
      countryCode,
      latitude: '30',
      longitude: '31',
      phone: '0123456789',
    });
    const detail = (id: string) =>
      new OrderService().getMyOrder(tenantId, userId, id);
    const checkoutSnapshot = async () => {
      const result = await runCheckout();
      return { id: result.order.id, before: await detail(result.order.id) };
    };

    beforeEach(async () => {
      await ensureFixtureMembership(tenantId, userId);
      await testPrisma.address.update({
        where: { id: addressId },
        data: originalAddress(),
      });
      const attribute = await testPrisma.productAttribute.create({
        data: { productId, name: 'Color' },
      });
      attributeId = attribute.id;
      const value = await testPrisma.productAttributeValue.create({
        data: {
          attributeId,
          value: 'Blue',
          imageUrl: 'https://example.test/blue.jpg',
        },
      });
      valueId = value.id;
      await testPrisma.productVariantValue.create({
        data: { variantId, attributeValueId: valueId },
      });
      await testPrisma.productImage.create({
        data: {
          productId,
          storageKey: 'original-product',
          url: 'https://example.test/product.jpg',
          isPrimary: true,
        },
      });
    });

    afterEach(async () => {
      await testPrisma.productVariantValue.deleteMany({ where: { variantId } });
      await testPrisma.productAttribute.deleteMany({
        where: { id: attributeId },
      });
      await testPrisma.productImage.deleteMany({ where: { productId } });
      await testPrisma.productVariantImage.deleteMany({ where: { variantId } });
      await testPrisma.product.update({
        where: { id: productId },
        data: { name: 'Transaction Product' },
      });
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { sku: `${fixture}-sku`, price: null },
      });
      await testPrisma.address.upsert({
        where: { id: addressId },
        create: { id: addressId, ...originalAddress() },
        update: originalAddress(),
      });
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: {
          code: `${fixture}-coupon`.toUpperCase(),
          discountValue: '2',
          isActive: true,
        },
      });
      await testPrisma.taxRule.updateMany({
        where: { taxCategory: { tenantId } },
        data: { rate: '5' },
      });
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { pricesIncludeTax: false },
      });
      await testPrisma.shippingRule.updateMany({
        where: {
          method: { zone: { profileId: shippingProfileId } },
          minOrderAmount: null,
        },
        data: { flatRate: '3' },
      });
      await testPrisma.shippingRule.updateMany({
        where: {
          method: { zone: { profileId: shippingProfileId } },
          minOrderAmount: '1000',
        },
        data: { flatRate: '1' },
      });
      await testPrisma.shippingMethod.updateMany({
        where: { zone: { profileId: shippingProfileId } },
        data: { name: 'Standard' },
      });
    });

    it('keeps the purchased product name after a rename', async () => {
      const { id, before } = await checkoutSnapshot();
      await testPrisma.product.update({
        where: { id: productId },
        data: { name: 'Renamed' },
      });
      expect(await detail(id)).toEqual(before);
      expect(before.items[0]?.productName).toBe('Transaction Product');
    });

    it('keeps original/effective prices, discounts, quantities and totals after price changes', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { discountType: 'PERCENTAGE', discountValue: '10' },
      });
      const { id, before } = await checkoutSnapshot();
      expect(before.items[0]).toMatchObject({
        unitPrice: '20',
        itemDiscountAmount: '2',
        finalUnitPrice: '18',
        totalPrice: '36',
        quantity: 2,
      });
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '99', discountValue: '50' },
      });
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { price: '120' },
      });
      expect(await detail(id)).toEqual(before);
    });

    it('keeps variant SKU, selected options and images after catalog edits', async () => {
      await testPrisma.productVariantImage.create({
        data: {
          variantId,
          storageKey: 'original-variant',
          url: 'https://example.test/variant.jpg',
          isPrimary: true,
        },
      });
      const { id, before } = await checkoutSnapshot();
      expect(before.items[0]?.variantSnapshot).toMatchObject({
        sku: `${fixture}-sku`,
        values: [
          {
            value: 'Blue',
            attributeName: 'Color',
            imageUrl: 'https://example.test/blue.jpg',
          },
        ],
        images: [{ url: 'https://example.test/variant.jpg' }],
      });
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { sku: `${fixture}-changed` },
      });
      await testPrisma.productAttribute.update({
        where: { id: attributeId },
        data: { name: 'Changed option' },
      });
      await testPrisma.productAttributeValue.update({
        where: { id: valueId },
        data: { value: 'Red', imageUrl: null },
      });
      await testPrisma.productVariantImage.deleteMany({ where: { variantId } });
      expect(await detail(id)).toEqual(before);
    });

    it('keeps the product image fallback after images are removed', async () => {
      const { id, before } = await checkoutSnapshot();
      expect(before.items[0]?.variantSnapshot).toMatchObject({
        images: [{ url: 'https://example.test/product.jpg' }],
      });
      await testPrisma.productImage.deleteMany({ where: { productId } });
      expect(await detail(id)).toEqual(before);
    });

    it('keeps shipping/billing addresses and delivery coordinates after an address edit', async () => {
      const { id, before } = await checkoutSnapshot();
      expect(before.shippingAddress).toMatchObject({
        firstName: 'Checkout',
        phone: '0123456789',
        addressLine1: '1 Test Street',
        countryCode,
        latitude: '30',
        longitude: '31',
      });
      expect(before.billingAddress).toEqual(before.shippingAddress);
      await testPrisma.address.update({
        where: { id: addressId },
        data: {
          firstName: 'Changed',
          addressLine1: 'Moved',
          latitude: '0',
          longitude: '0',
        },
      });
      expect(await detail(id)).toEqual(before);
    });

    it('keeps addresses after the saved address is deleted', async () => {
      const { id, before } = await checkoutSnapshot();
      await testPrisma.address.delete({ where: { id: addressId } });
      expect(await detail(id)).toEqual(before);
    });

    it('keeps the shipping decision after configuration changes', async () => {
      const { id, before } = await checkoutSnapshot();
      expect(before.shippingProfileSnapshot).toMatchObject({
        currency: 'EGP',
        amount: '3.00',
        eligibleSubtotal: '38.00',
        shippingMethodName: 'Standard',
      });
      await testPrisma.shippingProfile.update({
        where: { id: shippingProfileId },
        data: { originLatitude: '0', currency: 'USD' },
      });
      await testPrisma.shippingRule.updateMany({
        where: { method: { zone: { profileId: shippingProfileId } } },
        data: { flatRate: '99' },
      });
      await testPrisma.shippingMethod.updateMany({
        where: { zone: { profileId: shippingProfileId } },
        data: { name: 'New shipping' },
      });
      expect(await detail(id)).toEqual(before);
      await testPrisma.shippingProfile.update({
        where: { id: shippingProfileId },
        data: { originLatitude: '30' },
      });
    });

    it('keeps applied tax rates and amounts after tax configuration changes', async () => {
      const { id, before } = await checkoutSnapshot();
      expect(before.items[0]).toMatchObject({
        taxRate: '5',
        taxableAmount: '38',
        taxAmount: '1.9',
        taxTreatment: 'STANDARD',
      });
      await testPrisma.taxRule.updateMany({
        where: { taxCategory: { tenantId } },
        data: { rate: '20' },
      });
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { pricesIncludeTax: true },
      });
      expect(await detail(id)).toEqual(before);
    });

    it('captures the actual tax inclusion setting without changing tax calculations', async () => {
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { pricesIncludeTax: true },
      });
      const { before } = await checkoutSnapshot();
      expect(before.pricesIncludeTax).toBe(true);
      expect(before.taxProfileSnapshot).toMatchObject({
        pricesIncludeTax: true,
        currency: 'EGP',
      });
    });

    it('keeps coupon terms after the coupon is changed and disabled', async () => {
      const { id, before } = await checkoutSnapshot();
      expect(before.couponSnapshot).toMatchObject({
        code: `${fixture}-coupon`.toUpperCase(),
        discountType: 'FIXED_AMOUNT',
        discountValue: '2',
        discountAmount: '2.00',
        currency: 'EGP',
      });
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: {
          code: `${fixture}-changed`,
          discountValue: '100',
          isActive: false,
        },
      });
      expect(await detail(id)).toEqual(before);
    });

    it('keeps authoritative currency after tenant settings change', async () => {
      const { id, before } = await checkoutSnapshot();
      await testPrisma.tenant.update({
        where: { id: tenantId },
        data: { defaultCurrency: 'USD' },
      });
      expect(await detail(id)).toEqual(before);
      expect(before.currency).toBe('EGP');
      expect(before.payments[0]?.currency).toBe('EGP');
    });

    it('serves snapshots through the authenticated historical order detail API', async () => {
      const { id, before } = await checkoutSnapshot();
      await testPrisma.product.update({
        where: { id: productId },
        data: { name: 'Changed after checkout' },
      });
      const app = express();
      app.use('/orders', orderRoutes);
      const token = await createAccessToken(userId);
      const response = await request(app)
        .get(`/orders/my/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', fixture);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(before);
    });

    it('rolls back every snapshot together with the checkout transaction', async () => {
      await expect(runCheckout('after-order-created')).rejects.toThrow(
        'Injected failure',
      );
      await expectRolledBack();
    });

    it('does not expose order snapshots to another tenant or customer', async () => {
      const { id } = await checkoutSnapshot();
      const other = await testPrisma.tenant.create({
        data: {
          name: 'Other snapshot tenant',
          slug: `${fixture}-snapshot-other`,
          code: `${fixture}-snapshot-other`,
          defaultCurrency: 'USD',
        },
      });
      try {
        await expect(
          new OrderService().getOrder(other.id, id),
        ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
        await expect(
          new OrderService().getMyOrder(tenantId, crypto.randomUUID(), id),
        ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
      } finally {
        await deleteFixtureTenant({ where: { id: other.id } });
      }
    });

    it('reads shipping history even after the shipping profile and rules are deleted', async () => {
      const { id, before } = await checkoutSnapshot();
      const profile = await testPrisma.shippingProfile.findUniqueOrThrow({
        where: { id: shippingProfileId },
        include: {
          zones: { include: { methods: { include: { rules: true } } } },
        },
      });
      try {
        await testPrisma.shippingProfile.delete({
          where: { id: shippingProfileId },
        });
        expect(await detail(id)).toEqual(before);
      } finally {
        const { zones, ...profileData } = profile;
        await createShippingProfileFixture({ data: profileData });
        for (const zone of zones) {
          const { methods, ...zoneData } = zone;
          await testPrisma.shippingZone.create({ data: zoneData });
          for (const method of methods) {
            const { rules, ...methodData } = method;
            await testPrisma.shippingMethod.create({ data: methodData });
            await testPrisma.shippingRule.createMany({ data: rules });
          }
        }
      }
    });

    it('allows operational status updates without modifying snapshots', async () => {
      const { id, before } = await checkoutSnapshot();
      const after = await new OrderService().updateStatus(tenantId, id, {
        status: 'CONFIRMED',
      });
      expect(after.status).toBe('CONFIRMED');
      expect({
        ...after,
        status: before.status,
        updatedAt: before.updatedAt,
      }).toEqual(before);
    });

    it('leaves coupon snapshots null when no coupon is applied', async () => {
      const result = await runCheckout(undefined, { useCoupon: false });
      const order = await detail(result.order.id);
      expect(order.couponSnapshot).toBeNull();
      expect(new Prisma.Decimal(order.discountAmount).isZero()).toBe(true);
    });
    it('returns absent legacy snapshots as null without synthesizing current configuration', async () => {
      const { id, before } = await checkoutSnapshot();
      await testPrisma.order.update({
        where: { id },
        data: {
          couponSnapshot: Prisma.DbNull,
          shippingProfileSnapshot: Prisma.DbNull,
          taxProfileSnapshot: Prisma.DbNull,
        },
      });
      const legacy = await detail(id);
      expect(legacy.couponSnapshot).toBeNull();
      expect(legacy.shippingProfileSnapshot).toBeNull();
      expect(legacy.taxProfileSnapshot).toBeNull();
      expect(legacy.items).toEqual(before.items);
      expect(legacy.totalAmount).toBe(before.totalAmount);
    });
  });
  describe('checkout idempotency end-to-end (Point 10)', () => {
    let key: string;
    const extraUsers: string[] = [];
    const extraTenants: string[] = [];
    const input = (): CheckoutInput => ({
      shippingAddressId: addressId,
      billingSameAsShipping: true,
      couponCode: `${fixture}-coupon`.toUpperCase(),
      paymentMethod: PaymentMethod.CARD,
      paymentProvider: PaymentProvider.NONE,
      shippingMethodCode: `${fixture}-standard`,
    });
    const context = () => ({ tenantId, userId, idempotencyKey: key });
    const attempt = (
      patch: Partial<CheckoutInput> = {},
      service = new CheckoutService(),
    ) => service.checkout({ ...input(), ...patch }, context());
    beforeEach(() => {
      key = crypto.randomUUID();
    });
    afterEach(async () => {
      const scope = {
        OR: [
          { userId: { in: extraUsers } },
          { tenantId: { in: extraTenants } },
        ],
      };
      await testPrisma.checkoutRequest.deleteMany({ where: scope });
      await testPrisma.couponUsage.deleteMany({ where: { order: scope } });
      await testPrisma.payment.deleteMany({ where: { order: scope } });
      await testPrisma.order.deleteMany({ where: scope });
      await testPrisma.taxRule.deleteMany({
        where: { taxCategory: { tenantId: { in: extraTenants } } },
      });
      await deleteFixtureTenants({
        where: { id: { in: extraTenants } },
      });
      await testPrisma.cart.deleteMany({
        where: { userId: { in: extraUsers } },
      });
      await testPrisma.address.deleteMany({
        where: { userId: { in: extraUsers } },
      });
      await testPrisma.user.deleteMany({ where: { id: { in: extraUsers } } });
      extraUsers.length = 0;
      extraTenants.length = 0;
      await testPrisma.product.update({
        where: { id: productId },
        data: { status: 'ACTIVE' },
      });
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { isActive: true },
      });
      await testPrisma.shippingProfile.update({
        where: { id: shippingProfileId },
        data: { isActive: true },
      });
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { isActive: true, discountValue: '2' },
      });
      await testPrisma.address.upsert({
        where: { id: addressId },
        create: {
          id: addressId,
          userId,
          firstName: 'Checkout',
          lastName: 'Tester',
          addressLine1: '1 Test Street',
          city: 'Test City',
          countryCode,
          latitude: '30',
          longitude: '31',
        },
        update: {},
      });
    });
    const expectOne = async () => {
      expect(await testPrisma.order.count({ where: { tenantId } })).toBe(1);
      expect(
        await testPrisma.orderItem.count({ where: { order: { tenantId } } }),
      ).toBe(1);
      expect(
        await testPrisma.payment.count({ where: { order: { tenantId } } }),
      ).toBe(1);
      expect(
        await testPrisma.checkoutRequest.count({
          where: { tenantId, userId, idempotencyKey: key },
        }),
      ).toBe(1);
      expect(await testPrisma.couponUsage.count({ where: { couponId } })).toBe(
        1,
      );
      expect(
        (await testPrisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
          .usageCount,
      ).toBe(1);
      expect(
        (
          await testPrisma.inventory.findUniqueOrThrow({
            where: { id: inventoryId },
          })
        ).reservedQuantity,
      ).toBe(2);
      expect(
        await testPrisma.inventoryTransaction.count({ where: { inventoryId } }),
      ).toBe(1);
    };

    it('commits a scoped key, fingerprint and original result atomically', async () => {
      const first = await attempt();
      expect(first.idempotent).toBe(false);
      expect(
        await testPrisma.checkoutRequest.findFirstOrThrow({
          where: { tenantId, userId, idempotencyKey: key },
        }),
      ).toMatchObject({
        orderId: first.order.id,
        requestFingerprint: checkoutFingerprint(input()),
      });
      await expectOne();
    });

    it('replays the original order after cart clearing without duplicating any effects', async () => {
      const first = await attempt();
      expect(await testPrisma.cartItem.count({ where: { cartId } })).toBe(0);
      expect(await attempt()).toEqual({ ...first, idempotent: true });
      await expectOne();
    });

    it('returns original prices and snapshots after catalog changes', async () => {
      const first = await attempt();
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '9999', status: 'DRAFT' },
      });
      expect(await attempt()).toEqual({ ...first, idempotent: true });
      await expectOne();
    });

    it('does not recalculate coupon, shipping, tax or tenant currency on replay', async () => {
      const first = await attempt();
      const before = await new OrderService().getMyOrder(
        tenantId,
        userId,
        first.order.id,
      );
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { discountValue: '99', isActive: false },
      });
      await testPrisma.shippingProfile.update({
        where: { id: shippingProfileId },
        data: { isActive: false },
      });
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { isActive: false },
      });
      await testPrisma.tenant.update({
        where: { id: tenantId },
        data: { defaultCurrency: null },
      });
      expect(await attempt()).toEqual({ ...first, idempotent: true });
      expect(
        await new OrderService().getMyOrder(tenantId, userId, first.order.id),
      ).toEqual(before);
      await expectOne();
    });

    it.each([
      { shippingAddressId: '00000000-0000-4000-8000-000000000001' },
      { shippingMethodCode: 'different-method' },
      { couponCode: 'DIFFERENT' },
      { paymentMethod: PaymentMethod.BANK_TRANSFER },
      {
        billingSameAsShipping: false,
        billingAddressId: '00000000-0000-4000-8000-000000000002',
      },
    ])(
      'rejects changed checkout intent %j with a controlled conflict',
      async (patch) => {
        await attempt();
        await expect(attempt(patch)).rejects.toMatchObject({
          statusCode: 409,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
        });
        await expectOne();
      },
    );

    it('canonicalizes property order, defaults and coupon casing and ignores client currency', async () => {
      const first = await attempt();
      const reordered: CheckoutInput = {
        paymentMethod: PaymentMethod.CARD,
        shippingMethodCode: `${fixture}-standard`,
        couponCode: ` ${fixture}-coupon `,
        shippingAddressId: addressId,
        currency: 'USD',
      };
      expect(
        await new CheckoutService().checkout(reordered, context()),
      ).toEqual({ ...first, idempotent: true });
      await expectOne();
    });

    it.each([1, 2, 3])(
      'rejects an overlapping duplicate and safely replays it after commit (repeat %i)',
      async () => {
        const blocker = new pg.Client({
          connectionString: env.TEST_DATABASE_URL,
        });
        await blocker.connect();
        let pending: Promise<CheckoutResult> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            'SELECT id FROM "Coupon" WHERE id=$1 FOR UPDATE',
            [couponId],
          );
          pending = attempt();
          // Attach an observer immediately to avoid an unhandled rejection on setup failure.
          void pending.catch(() => {});
          let waiting = false;
          const deadline = Date.now() + 3500;
          while (Date.now() < deadline) {
            const rows = await testPrisma.$queryRaw<
              Array<{ blocked: boolean }>
            >`
            SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
            AND wait_event_type='Lock' AND query LIKE '%FROM "Coupon"%') AS blocked
          `;
            if (rows[0]?.blocked) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);
          await expect(attempt()).rejects.toMatchObject({
            statusCode: 409,
            code: 'CHECKOUT_IN_PROGRESS',
          });
        } finally {
          await blocker.query('ROLLBACK');
          await blocker.end();
        }
        const first = await pending!;
        expect(await attempt()).toEqual({ ...first, idempotent: true });
        await expectOne();
      },
    );

    it('allows simultaneous duplicate calls to produce only one order', async () => {
      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      for (const result of results)
        if (result.status === 'rejected')
          expect(result.reason.code).toBe('CHECKOUT_IN_PROGRESS');
      const replay = await attempt();
      expect(replay.idempotent).toBe(true);
      await expectOne();
    });

    it.each([
      'after-order-created',
      'after-inventory-reserved',
      'after-coupon-consumed',
      'before-payment-create',
    ] as const)(
      'rolls back failed attempts at %s and allows the same key to retry',
      async (point) => {
        const failing = new CheckoutService((at) => {
          if (at === point) throw new Error('Transient checkout failure');
        });
        await expect(attempt({}, failing)).rejects.toThrow(
          'Transient checkout failure',
        );
        await expectRolledBack();
        const successful = await attempt();
        expect(successful.idempotent).toBe(false);
        await expectOne();
      },
    );

    it('does not poison the key after a business validation failure', async () => {
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { isActive: false },
      });
      await expect(attempt()).rejects.toMatchObject({
        code: 'COUPON_INACTIVE',
      });
      await expectRolledBack();
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { isActive: true },
      });
      await attempt();
      await expectOne();
    });

    it('does not expose another user order when that user reuses the key', async () => {
      const first = await attempt();
      const user = await testPrisma.user.create({
        data: {
          email: `${crypto.randomUUID()}@example.test`,
          passwordHash: 'test',
          firstName: 'Other',
          lastName: 'User',
        },
      });
      extraUsers.push(user.id);
      const address = await testPrisma.address.create({
        data: {
          userId: user.id,
          firstName: 'Other',
          lastName: 'User',
          addressLine1: 'Street',
          city: 'Cairo',
          countryCode,
          latitude: '30',
          longitude: '31',
        },
      });
      const cart = await createCartFixture({
        data: { tenantId, userId: user.id },
      });
      await testPrisma.cartItem.create({
        data: { cartId: cart.id, variantId, quantity: 1 },
      });
      const other = await new CheckoutService().checkout(
        { ...input(), shippingAddressId: address.id },
        { ...context(), userId: user.id },
      );
      expect(other.idempotent).toBe(false);
      expect(other.order.id).not.toBe(first.order.id);
      expect(
        await testPrisma.checkoutRequest.count({
          where: { tenantId, idempotencyKey: key },
        }),
      ).toBe(2);
    });

    it('allows the same user/key to check out independently in another tenant', async () => {
      const first = await attempt();
      const name = `${fixture}-${crypto.randomUUID()}`;
      const other = await testPrisma.tenant.create({
        data: { name, slug: name, code: name, defaultCurrency: 'USD' },
      });
      extraTenants.push(other.id);
      const category = await testPrisma.category.create({
        data: { tenantId: other.id, name, slug: name },
      });
      const tax = await testPrisma.taxCategory.create({
        data: { tenantId: other.id, code: name, name },
      });
      const product = await testPrisma.product.create({
        data: {
          tenantId: other.id,
          categoryId: category.id,
          name,
          slug: name,
          basePrice: '10',
          status: 'ACTIVE',
        },
      });
      const variant = await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: name,
          combinationKey: 'default',
          taxCategoryId: tax.id,
        },
      });
      await createInventoryFixture({
        data: { variantId: variant.id, quantity: 10 },
      });
      const cart = await createCartFixture({
        data: { tenantId: other.id, userId },
      });
      await testPrisma.cartItem.create({
        data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
      });
      await testPrisma.taxProfile.create({
        data: {
          tenantId: other.id,
          countryCode,
          currency: 'USD',
          defaultTaxCategoryId: tax.id,
          pricesIncludeTax: false,
        },
      });
      await testPrisma.taxRule.create({
        data: { taxCategoryId: tax.id, countryCode, rate: '5' },
      });
      const profile = await createShippingProfileFixture({
        data: {
          tenantId: other.id,
          countryCode,
          currency: 'USD',
          originLatitude: '30',
          originLongitude: '31',
        },
      });
      const zone = await testPrisma.shippingZone.create({
        data: { profileId: profile.id, name, code: name, countryCode },
      });
      const method = await testPrisma.shippingMethod.create({
        data: { zoneId: zone.id, name, code: name },
      });
      await testPrisma.shippingRule.create({
        data: { methodId: method.id, flatRate: '1', maxDistanceKm: '50' },
      });
      const secondInput = {
        shippingAddressId: addressId,
        billingSameAsShipping: true,
        paymentMethod: PaymentMethod.CARD,
        shippingMethodCode: name,
      };
      const second = await new CheckoutService().checkout(secondInput, {
        ...context(),
        tenantId: other.id,
      });
      expect(second.order.id).not.toBe(first.order.id);
      expect(second.order.currency).toBe('USD');
      expect((await attempt()).order.id).toBe(first.order.id);
      expect(
        (
          await new CheckoutService().checkout(secondInput, {
            ...context(),
            tenantId: other.id,
          })
        ).order.id,
      ).toBe(second.order.id);
    });

    it('replays persisted state in a separate Node process', async () => {
      const first = await attempt();
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(
            new URL('./helpers/checkout-replay.worker.ts', import.meta.url),
          ),
          JSON.stringify(input()),
          JSON.stringify(context()),
        ],
        {
          env: { ...process.env, DATABASE_URL: env.TEST_DATABASE_URL },
          timeout: 15000,
        },
      );
      expect(JSON.parse(stdout.trim())).toEqual({ ...first, idempotent: true });
      await expectOne();
    }, 20000);

    it('treats different keys as independent attempts', async () => {
      const first = await attempt();
      await testPrisma.cartItem.create({
        data: { cartId, variantId, quantity: 1 },
      });
      const second = await new CheckoutService().checkout(input(), {
        ...context(),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(second.idempotent).toBe(false);
      expect(second.order.id).not.toBe(first.order.id);
      expect(await testPrisma.order.count({ where: { tenantId } })).toBe(2);
    });

    it('replays without saved addresses, inventory availability or any checkout writes', async () => {
      const first = await attempt();
      await testPrisma.address.delete({ where: { id: addressId } });
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { reservedQuantity: 10 },
      });
      const replayOnly = new CheckoutService(() => {
        throw new Error('Checkout writes must not run on replay');
      });
      expect(await attempt({}, replayOnly)).toEqual({
        ...first,
        idempotent: true,
      });
      expect(
        await testPrisma.inventoryTransaction.count({ where: { inventoryId } }),
      ).toBe(1);
    });

    it('rejects unverifiable legacy fingerprints without inventing history', async () => {
      const first = await attempt();
      await testPrisma.checkoutRequest.updateMany({
        where: { orderId: first.order.id },
        data: { requestFingerprint: null },
      });
      await expect(attempt()).rejects.toMatchObject({
        statusCode: 409,
        code: 'IDEMPOTENCY_LEGACY_REQUEST',
      });
      await expectOne();
    });

    const httpApp = () => {
      const app = express();
      app.use(express.json());
      app.use('/checkout', checkoutRoutes);
      app.use(errorMiddleware);
      return app;
    };
    it('preserves the HTTP envelope and 201/200 creation/replay semantics', async () => {
      await testPrisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
      const app = httpApp();
      const token = await createAccessToken(userId);
      const send = (body = input()) =>
        request(app)
          .post('/checkout')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-Slug', fixture)
          .set('Idempotency-Key', key)
          .send(body);
      const first = await send();
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        success: true,
        message: null,
        data: { idempotent: false },
      });
      const replay = await send();
      expect(replay.status).toBe(200);
      expect(replay.body.data).toEqual({
        ...first.body.data,
        idempotent: true,
      });
      const conflict = await send({ ...input(), couponCode: 'OTHER' });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        success: false,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        data: null,
      });
      await expectOne();
    });

    it.each(['', 'a b', 'a'.repeat(256), 'é'])(
      'rejects invalid idempotency key %j before checkout writes',
      async (invalidKey) => {
        await expect(
          new CheckoutService().checkout(input(), {
            ...context(),
            idempotencyKey: invalidKey,
          }),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expectRolledBack();
      },
    );
  });
  describe('payment integration boundary (Point 11)', () => {
    let key: string;
    let calls: PaymentProviderCreateInput[];
    let respond: (
      input: PaymentProviderCreateInput,
    ) => Promise<PaymentProviderCreateResult>;
    let adapter: PaymentProviderAdapter;
    let service: PaymentService;
    afterEach(async () => {
      await testPrisma.tenantMember.deleteMany({ where: { tenantId, userId } });
    });
    const requestInput = () => ({
      shippingAddressId: addressId,
      billingSameAsShipping: true,
      couponCode: `${fixture}-coupon`.toUpperCase(),
      paymentMethod: PaymentMethod.CARD,
      paymentProvider: PaymentProvider.NONE,
      shippingMethodCode: `${fixture}-standard`,
    });
    const createCheckout = () =>
      new CheckoutService().checkout(requestInput(), {
        tenantId,
        userId,
        idempotencyKey: key,
      });
    beforeEach(async () => {
      await ensureFixtureMembership(tenantId, userId);
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { quantity: 10 },
      });
      key = crypto.randomUUID();
      calls = [];
      respond = async () => ({
        status: 'PENDING',
        providerPaymentId: 'neutral-intent',
      });
      adapter = {
        provider: PaymentProvider.NONE,
        supportsIdempotentInitiation: true,
        createPayment: async (input) => {
          calls.push(input);
          return respond(input);
        },
        cancelPayment: async () => ({ status: 'CANCELLED' }),
        refundPayment: async () => ({ status: 'REFUNDED' }),
      };
      class BoundaryRegistry extends PaymentProviderRegistry {
        override resolveProviderForMethod() {
          return PaymentProvider.NONE;
        }
        override getProvider() {
          return adapter;
        }
      }
      service = new PaymentService(undefined, new BoundaryRegistry());
    });
    const initiate = (id: string) =>
      service.initiatePayment(tenantId, userId, id);
    const local = async (id: string) =>
      testPrisma.payment.findUniqueOrThrow({ where: { id } });
    const snapshot = async (id: string) => {
      const order = await new OrderService().getMyOrder(tenantId, userId, id);
      const immutable: Partial<typeof order> = { ...order };
      delete immutable.payments;
      delete immutable.status;
      delete immutable.paymentStatus;
      delete immutable.updatedAt;
      return immutable;
    };
    const expectReservation = async (
      quantity: number,
      reserved: number,
      sales: number,
      releases: number,
    ) => {
      expect(
        await testPrisma.inventory.findUniqueOrThrow({
          where: { id: inventoryId },
        }),
      ).toMatchObject({ quantity, reservedQuantity: reserved });
      expect(
        await testPrisma.inventoryTransaction.count({
          where: { inventoryId, type: 'SALE' },
        }),
      ).toBe(sales);
      expect(
        await testPrisma.inventoryTransaction.count({
          where: { inventoryId, type: 'RELEASE' },
        }),
      ).toBe(releases);
    };

    it('creates one local pending payment without calling the provider during checkout', async () => {
      const result = await createCheckout();
      expect(calls).toHaveLength(0);
      expect(await local(result.payment!.id)).toMatchObject({
        orderId: result.order.id,
        status: 'PENDING',
        initiationState: 'NOT_STARTED',
      });
      expect(
        await testPrisma.payment.count({ where: { orderId: result.order.id } }),
      ).toBe(1);
    });

    it('calls the adapter only after checkout and initiation claim transactions commit', async () => {
      const result = await createCheckout();
      respond = async () => {
        const independent = new pg.Client({
          connectionString: env.TEST_DATABASE_URL,
        });
        await independent.connect();
        try {
          expect(
            (
              await independent.query(
                'SELECT "initiationState" FROM "Payment" WHERE id=$1',
                [result.payment!.id],
              )
            ).rows[0].initiationState,
          ).toBe('IN_PROGRESS');
          await independent.query('BEGIN');
          // A held checkout/claim order lock would cause NOWAIT to fail.
          expect(
            (
              await independent.query(
                'SELECT id FROM "Order" WHERE id=$1 FOR UPDATE NOWAIT',
                [result.order.id],
              )
            ).rowCount,
          ).toBe(1);
          await independent.query('ROLLBACK');
        } finally {
          await independent.end();
        }
        return { status: 'PENDING', providerPaymentId: 'committed-intent' };
      };
      await initiate(result.payment!.id);
      expect(calls).toHaveLength(1);
    });

    it('uses the persisted order amount/currency after catalog and tenant changes', async () => {
      const result = await createCheckout();
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '9999' },
      });
      await testPrisma.tenant.update({
        where: { id: tenantId },
        data: { defaultCurrency: 'USD' },
      });
      await initiate(result.payment!.id);
      expect(calls[0]).toMatchObject({
        amount: result.order.totalAmount,
        currency: 'EGP',
        paymentId: result.payment!.id,
        orderId: result.order.id,
        idempotencyKey: `payment:${result.payment!.id}`,
      });
    });

    it.each([{ amount: '0.01' }, { currency: 'USD' }, { status: 'PAID' }])(
      'rejects client-controlled initiation fields %j',
      async (body) => {
        const result = await createCheckout();
        const app = express();
        app.use(express.json());
        app.use('/payments', paymentRoutes);
        app.use(errorMiddleware);
        const token = await createAccessToken(userId);
        const response = await request(app)
          .post(`/payments/${result.payment!.id}/initiate`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-Slug', fixture)
          .send(body);
        expect(response.status).toBe(400);
        expect(calls).toHaveLength(0);
        expect((await local(result.payment!.id)).initiationState).toBe(
          'NOT_STARTED',
        );
      },
    );

    it('preserves committed checkout, payment, cart clearing, coupon and reservation on provider exception', async () => {
      const result = await createCheckout();
      const before = await snapshot(result.order.id);
      respond = async () => {
        throw new Error('Provider transport failure');
      };
      await expect(initiate(result.payment!.id)).rejects.toMatchObject({
        statusCode: 503,
        code: 'PAYMENT_INITIATION_UNKNOWN',
      });
      expect(await local(result.payment!.id)).toMatchObject({
        status: 'PENDING',
        initiationState: 'UNKNOWN',
      });
      expect(
        await testPrisma.payment.count({ where: { orderId: result.order.id } }),
      ).toBe(1);
      expect(await testPrisma.order.count({ where: { tenantId } })).toBe(1);
      expect(await testPrisma.cartItem.count({ where: { cartId } })).toBe(0);
      expect(
        (await testPrisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
          .usageCount,
      ).toBe(1);
      await expectReservation(10, 2, 0, 0);
      expect(await snapshot(result.order.id)).toEqual(before);
    });

    it('retries unknown outcomes with a stable key only when the adapter guarantees idempotency', async () => {
      const result = await createCheckout();
      const externalIntents = new Map<string, string>();
      respond = async (input) => {
        if (!externalIntents.has(input.idempotencyKey))
          externalIntents.set(input.idempotencyKey, 'single-neutral-intent');
        if (calls.length === 1)
          throw new Error('Timeout after provider accepted request');
        return {
          status: 'PENDING',
          providerPaymentId: externalIntents.get(input.idempotencyKey)!,
        };
      };
      await expect(initiate(result.payment!.id)).rejects.toMatchObject({
        code: 'PAYMENT_INITIATION_UNKNOWN',
      });
      const retry = await initiate(result.payment!.id);
      expect(retry.providerPaymentId).toBe('single-neutral-intent');
      expect(externalIntents.size).toBe(1);
      expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
      await initiate(result.payment!.id);
      expect(calls).toHaveLength(2);
      await expectReservation(10, 2, 0, 0);
    });

    it('requires reconciliation for unknown outcomes without provider idempotency', async () => {
      Object.assign(adapter, { supportsIdempotentInitiation: false });
      const result = await createCheckout();
      respond = async () => {
        throw new Error('Unknown network outcome');
      };
      await expect(initiate(result.payment!.id)).rejects.toMatchObject({
        code: 'PAYMENT_INITIATION_UNKNOWN',
      });
      await expect(initiate(result.payment!.id)).rejects.toMatchObject({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect(calls).toHaveLength(1);
      await expectReservation(10, 2, 0, 0);
    });

    it('does not issue concurrent provider calls for the same pending payment', async () => {
      const result = await createCheckout();
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      respond = async () => {
        entered();
        await gate;
        return { status: 'PENDING', providerPaymentId: 'one-intent' };
      };
      const first = initiate(result.payment!.id);
      try {
        await started;
        await expect(initiate(result.payment!.id)).rejects.toMatchObject({
          code: 'PAYMENT_INITIATION_IN_PROGRESS',
        });
      } finally {
        release();
        await first;
      }
      expect(calls).toHaveLength(1);
      expect((await initiate(result.payment!.id)).providerPaymentId).toBe(
        'one-intent',
      );
    });

    it('commits sale once on successful provider result and duplicate confirmation', async () => {
      const result = await createCheckout();
      respond = async () => ({
        status: 'PAID',
        providerPaymentId: 'paid-neutral-intent',
      });
      expect((await initiate(result.payment!.id)).status).toBe('PAID');
      await initiate(result.payment!.id);
      await expect(
        service.updatePaymentStatus(tenantId, result.payment!.id, {
          status: 'PAID',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
      });
      expect(calls).toHaveLength(1);
      await expectReservation(8, 0, 1, 0);
    });

    it('releases reservation once on explicit provider failure and duplicate failure', async () => {
      const result = await createCheckout();
      respond = async () => ({ status: 'FAILED', failureCode: 'DECLINED' });
      expect((await initiate(result.payment!.id)).status).toBe('FAILED');
      await initiate(result.payment!.id);
      await service.updatePaymentStatus(tenantId, result.payment!.id, {
        status: 'FAILED',
      });
      expect(calls).toHaveLength(1);
      await expectReservation(10, 0, 0, 1);
    });

    it('scopes initiation and status reads to the tenant and authenticated owner', async () => {
      const result = await createCheckout();
      await expect(
        service.initiatePayment(
          crypto.randomUUID(),
          userId,
          result.payment!.id,
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
      await expect(
        service.initiatePayment(
          tenantId,
          crypto.randomUUID(),
          result.payment!.id,
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
      await expect(
        service.getPaymentForUser(
          tenantId,
          crypto.randomUUID(),
          result.payment!.id,
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
      await expect(
        service.getOrderPaymentsForUser(
          tenantId,
          crypto.randomUUID(),
          result.order.id,
        ),
      ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
      expect(
        (await service.getPaymentForUser(tenantId, userId, result.payment!.id))
          .id,
      ).toBe(result.payment!.id);
      expect(calls).toHaveLength(0);
    });

    it('rejects another customer at the payment initiation and retrieval HTTP boundary', async () => {
      const result = await createCheckout();
      const app = express();
      app.use(express.json());
      app.use('/payments', paymentRoutes);
      app.use(errorMiddleware);
      const token = await createAccessToken(foreignAccessUserId);
      const initiated = await request(app)
        .post(`/payments/${result.payment!.id}/initiate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', fixture)
        .send({});
      expect(initiated.status).toBe(404);
      const status = await request(app)
        .get(`/payments/${result.payment!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', fixture);
      expect(status.status).toBe(404);
      expect(calls).toHaveLength(0);
    });

    it('does not trust customer-supplied success notifications', async () => {
      const result = await createCheckout();
      await ensureFixtureMembership(tenantId, userId);
      const app = express();
      app.use(express.json());
      app.use('/payments', paymentRoutes);
      app.use(errorMiddleware);
      const token = await createAccessToken(userId);
      const response = await request(app)
        .patch(`/payments/${result.payment!.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', fixture)
        .send({ status: 'PAID' });
      expect(response.status).toBe(403);
      expect((await local(result.payment!.id)).status).toBe('PENDING');
      await expectReservation(10, 2, 0, 0);
    });

    it('does not automatically initiate or reinitiate payment on checkout replay', async () => {
      const result = await createCheckout();
      expect((await createCheckout()).idempotent).toBe(true);
      expect(calls).toHaveLength(0);
      await initiate(result.payment!.id);
      expect((await createCheckout()).payment!.id).toBe(result.payment!.id);
      expect(calls).toHaveLength(1);
      expect(
        await testPrisma.payment.count({ where: { orderId: result.order.id } }),
      ).toBe(1);
    });

    it('keeps authoritative local metadata separate from provider metadata', async () => {
      const result = await createCheckout();
      respond = async () => ({
        status: 'PENDING',
        metadata: { shippingAmount: '0.01' },
      });
      const payment = await initiate(result.payment!.id);
      expect(payment.metadata).toMatchObject({
        shippingAmount: '3.00',
        providerMetadata: { shippingAmount: '0.01' },
      });
    });

    it('preserves checkout snapshots across payment initiation and confirmation', async () => {
      const result = await createCheckout();
      const before = await snapshot(result.order.id);
      respond = async () => ({
        status: 'PAID',
        providerPaymentId: 'snapshot-intent',
      });
      await initiate(result.payment!.id);
      expect(await snapshot(result.order.id)).toEqual(before);
    });

    it('does not claim that unconfigured card providers can collect real payments', async () => {
      const result = await createCheckout();
      await expect(
        new PaymentService().initiatePayment(
          tenantId,
          userId,
          result.payment!.id,
        ),
      ).rejects.toMatchObject({ code: 'CARD_PAYMENT_NOT_CONFIGURED' });
      expect((await local(result.payment!.id)).initiationState).toBe(
        'NOT_STARTED',
      );
      await expectReservation(10, 2, 0, 0);
    });

    it('leaves a crashed in-progress initiation blocked for reconciliation rather than duplicating it', async () => {
      const result = await createCheckout();
      await testPrisma.payment.update({
        where: { id: result.payment!.id },
        data: { initiationState: 'IN_PROGRESS' },
      });
      await expect(initiate(result.payment!.id)).rejects.toMatchObject({
        code: 'PAYMENT_INITIATION_IN_PROGRESS',
      });
      expect(calls).toHaveLength(0);
      await expectReservation(10, 2, 0, 0);
    });

    it('reconciles an uncertain initiation through trusted confirmation without another provider call', async () => {
      const result = await createCheckout();
      const origPayment = await testPrisma.payment.findUniqueOrThrow({
        where: { id: result.payment!.id },
      });
      await testPrisma.payment.delete({ where: { id: origPayment.id } });
      const mfPayment = await testPrisma.payment.create({
        data: {
          orderId: origPayment.orderId,
          provider: PaymentProvider.MYFATOORAH,
          method: origPayment.method,
          status: origPayment.status,
          amount: origPayment.amount,
          currency: origPayment.currency,
          initiationState: 'IN_PROGRESS',
        },
      });
      await service.applyTrustedPaymentStatus(
        tenantId,
        mfPayment.id,
        {
          status: 'PAID',
          providerPaymentId: 'verified-outcome',
        },
        {
          kind: 'PROVIDER_VERIFICATION',
          provider: PaymentProvider.MYFATOORAH,
          providerPaymentId: 'verified-outcome',
        },
      );
      expect((await initiate(mfPayment.id)).status).toBe('PAID');
      expect(calls).toHaveLength(0);
      await expectReservation(8, 0, 1, 0);
    });

    it('blocks unsafe legacy initiation when the original provider outcome is unverified', async () => {
      const result = await createCheckout();
      Object.assign(adapter, { supportsIdempotentInitiation: false });
      await testPrisma.payment.update({
        where: { id: result.payment!.id },
        data: { initiationState: 'UNKNOWN' },
      });
      await expect(initiate(result.payment!.id)).rejects.toMatchObject({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect(calls).toHaveLength(0);
    });

    it('rejects a corrupted local amount or currency before any provider call', async () => {
      const result = await createCheckout();
      await testPrisma.payment.update({
        where: { id: result.payment!.id },
        data: { amount: '0.01', currency: 'USD' },
      });
      await expect(initiate(result.payment!.id)).rejects.toMatchObject({
        code: 'PAYMENT_ORDER_MISMATCH',
      });
      expect(calls).toHaveLength(0);
    });

    it('exposes the local no-op initiation/status API without fabricating online payment', async () => {
      const result = await new CheckoutService().checkout(
        { ...requestInput(), paymentMethod: PaymentMethod.CASH_ON_DELIVERY },
        { tenantId, userId, idempotencyKey: key },
      );
      const app = express();
      app.use(express.json());
      app.use('/payments', paymentRoutes);
      app.use(errorMiddleware);
      const token = await createAccessToken(userId);
      const initiateResponse = await request(app)
        .post(`/payments/${result.payment!.id}/initiate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', fixture)
        .send({});
      expect(initiateResponse.status).toBe(200);
      expect(initiateResponse.body).toMatchObject({
        success: true,
        message: null,
        data: {
          id: result.payment!.id,
          status: 'PENDING',
          initiationState: 'INITIATED',
        },
      });
      const status = await request(app)
        .get(`/payments/${result.payment!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', fixture);
      expect(status.status).toBe(200);
      expect(status.body.data.status).toBe('PENDING');
      await expectReservation(10, 2, 0, 0);
    });
  });
  describe('order/payment transition hardening (Point 12)', () => {
    const orderMatrix: Record<OrderStatus, OrderStatus[]> = {
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PROCESSING', 'CANCELLED'],
      PROCESSING: ['SHIPPED'],
      SHIPPED: ['DELIVERED'],
      DELIVERED: ['COMPLETED'],
      CANCELLED: [],
      COMPLETED: [],
    };
    const paymentMatrix: Record<PaymentStatus, PaymentStatus[]> = {
      PENDING: ['REQUIRES_ACTION', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
      REQUIRES_ACTION: ['AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
      AUTHORIZED: ['PAID', 'FAILED', 'CANCELLED'],
      PAID: ['REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'],
      FAILED: ['CANCELLED'],
      CANCELLED: [],
      REFUND_PENDING: ['PARTIALLY_REFUNDED', 'REFUNDED'],
      PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
      REFUNDED: [],
    };
    const orders = new OrderService();
    const payments = new PaymentService();
    let result: CheckoutResult;
    let key: string;
    beforeEach(async () => {
      await ensureFixtureMembership(tenantId, userId);
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { quantity: 10 },
      });
      key = crypto.randomUUID();
      result = await new CheckoutService().checkout(
        {
          shippingAddressId: addressId,
          billingSameAsShipping: true,
          couponCode: `${fixture}-coupon`.toUpperCase(),
          paymentMethod: PaymentMethod.CARD,
          paymentProvider: PaymentProvider.MYFATOORAH,
          shippingMethodCode: `${fixture}-standard`,
        },
        { tenantId, userId, idempotencyKey: key },
      );
    });
    const isRefundStatus = (status: PaymentStatus): boolean =>
      status === PaymentStatus.REFUND_PENDING ||
      status === PaymentStatus.PARTIALLY_REFUNDED ||
      status === PaymentStatus.REFUNDED;
    const pay = async (status: PaymentStatus) => {
      if (isRefundStatus(status)) {
        const ledgerRow = await testPrisma.paymentRefund.create({
          data: {
            tenantId,
            paymentId: result.payment!.id,
            orderId: result.order.id,
            provider: PaymentProvider.MYFATOORAH,
            method: PaymentMethod.CARD,
            amount:
              status === PaymentStatus.REFUNDED
                ? result.order.totalAmount
                : '1',
            currency: result.order.currency,
            status:
              status === PaymentStatus.REFUND_PENDING
                ? 'REQUESTED'
                : 'SUCCEEDED',
            idempotencyKey: `matrix-${result.payment!.id}-${status}-${randomUUID()}`,
            requestFingerprint: `fp-${randomUUID()}`,
            ...(status === PaymentStatus.REFUND_PENDING
              ? {}
              : {
                  providerRefundId: `ref-${status}-${randomUUID()}`,
                  submittedAt: new Date(),
                  completedAt: new Date(),
                }),
            reason: `Matrix transition fixture to ${status}`,
            requestedByUserId: userId,
          },
        });
        return payments.applyTrustedPaymentStatus(
          tenantId,
          result.payment!.id,
          {
            status,
            refundId: ledgerRow.id,
            ...(status === PaymentStatus.PARTIALLY_REFUNDED
              ? {
                  refundAmount: '1',
                  providerTransactionId: `ref-partial-${result.payment!.id}`,
                }
              : {}),
          },
          { kind: 'PAYMENT_REFUND', refundId: ledgerRow.id },
        );
      }
      return payments.applyTrustedPaymentStatus(
        tenantId,
        result.payment!.id,
        { status },
        {
          kind: 'PROVIDER_VERIFICATION',
          provider: PaymentProvider.MYFATOORAH,
          providerPaymentId: `verified-${result.payment!.id}`,
        },
      );
    };
    const order = (status: OrderStatus) =>
      orders.updateStatus(tenantId, result.order.id, { status });
    const state = async () =>
      testPrisma.order.findUniqueOrThrow({
        where: { id: result.order.id },
        include: { payments: true },
      });
    const ledger = (type: 'SALE' | 'RELEASE') =>
      testPrisma.inventoryTransaction.count({
        where: { inventoryId, referenceId: result.order.id, type },
      });
    const expectConsistent = async () => {
      const current = await state();
      expect(current.paymentStatus).toBe(current.payments[0]!.status);
      const inventory = await testPrisma.inventory.findUniqueOrThrow({
        where: { id: inventoryId },
      });
      const sales = await ledger('SALE');
      const releases = await ledger('RELEASE');
      expect(sales + releases).toBeLessThanOrEqual(1);
      expect(inventory).toMatchObject({
        quantity: sales ? 8 : 10,
        reservedQuantity: sales || releases ? 0 : 2,
      });
    };

    const orderPairs = Object.values(OrderStatus).flatMap((from) =>
      Object.values(OrderStatus).map((to) => ({ from, to })),
    );
    it.each(orderPairs)(
      'enforces Order $from -> $to through the transactional service',
      async ({ from, to }) => {
        if (to !== 'CANCELLED' && from !== 'CANCELLED') await pay('PAID');
        if (from === 'CANCELLED') {
          await pay('CANCELLED');
        }
        await testPrisma.order.update({
          where: { id: result.order.id },
          data: { status: from },
        });
        if (from === to || orderMatrix[from].includes(to)) {
          expect((await order(to)).status).toBe(to);
        } else {
          await expect(order(to)).rejects.toMatchObject({ statusCode: 409 });
          expect((await state()).status).toBe(from);
        }
      },
    );

    const paymentPairs = Object.values(PaymentStatus).flatMap((from) =>
      Object.values(PaymentStatus).map((to) => ({ from, to })),
    );
    it.each(paymentPairs)(
      'enforces Payment $from -> $to through the transactional service',
      async ({ from, to }) => {
        // Construct valid historical fixtures, including the appropriate ledger.
        if (
          ['PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(
            from,
          )
        )
          await pay('PAID');
        else if (['FAILED', 'CANCELLED'].includes(from)) await pay('FAILED');
        await testPrisma.payment.update({
          where: { id: result.payment!.id },
          data: { status: from },
        });
        await testPrisma.order.update({
          where: { id: result.order.id },
          data: { paymentStatus: from },
        });
        const noOpNegative = from === 'CANCELLED' && to === 'FAILED';
        if (from === to || paymentMatrix[from].includes(to) || noOpNegative) {
          expect((await pay(to)).status).toBe(noOpNegative ? 'CANCELLED' : to);
        } else {
          await expect(pay(to)).rejects.toMatchObject({ statusCode: 409 });
          expect((await state()).paymentStatus).toBe(from);
        }
      },
    );

    it('rejects untrusted refund statuses, unverified provider refund transitions, and invalid partial refund amounts without mutating state', async () => {
      await pay('PAID');
      const notifCountBefore = await testPrisma.notification.count({
        where: { tenantId, data: { path: ['orderId'], equals: result.order.id } },
      });

      // Untrusted merchant status updates cannot fabricate refund transitions
      for (const refundStatus of [
        PaymentStatus.REFUND_PENDING,
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ]) {
        await expect(
          payments.updatePaymentStatusByMerchant(tenantId, result.payment!.id, {
            status: refundStatus,
            refundAmount: '1',
          }),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
        });

        // PROVIDER_VERIFICATION cannot emit refund statuses without a refund workflow
        await expect(
          payments.applyTrustedPaymentStatus(
            tenantId,
            result.payment!.id,
            { status: refundStatus, refundAmount: '1' },
            {
              kind: 'PROVIDER_VERIFICATION',
              provider: PaymentProvider.MYFATOORAH,
              providerPaymentId: `verified-${result.payment!.id}`,
            },
          ),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: 'PAYMENT_REFUND_VERIFICATION_REQUIRED',
        });
      }

      // Trusted PAYMENT_REFUND to PARTIALLY_REFUNDED requires a valid positive amount strictly less than payment.amount
      for (const invalidAmount of [
        undefined,
        '',
        '   ',
        '0',
        '-1',
        result.order.totalAmount.toString(),
        '999999',
        '1.1234',
      ]) {
        await expect(
          payments.applyTrustedPaymentStatus(
            tenantId,
            result.payment!.id,
            {
              status: PaymentStatus.PARTIALLY_REFUNDED,
              ...(invalidAmount === undefined
                ? {}
                : { refundAmount: invalidAmount }),
            },
            { kind: 'PAYMENT_REFUND' },
          ),
        ).rejects.toMatchObject({ statusCode: 400 });
      }

      const afterState = await state();
      expect(afterState.paymentStatus).toBe(PaymentStatus.PAID);
      expect(afterState.payments[0]!.status).toBe(PaymentStatus.PAID);
      expect(
        await testPrisma.notification.count({
          where: {
            tenantId,
            data: { path: ['orderId'], equals: result.order.id },
          },
        }),
      ).toBe(notifCountBefore);
    });

    it('keeps successful payment after duplicate success and stale failure', async () => {
      await pay('PAID');
      await pay('PAID');
      await expect(pay('FAILED')).rejects.toMatchObject({
        code: 'INVALID_PAYMENT_STATUS_TRANSITION',
      });
      expect((await state()).paymentStatus).toBe('PAID');
      await expectConsistent();
    });
    it('keeps released inventory after duplicate failure and stale success', async () => {
      await pay('FAILED');
      await pay('FAILED');
      await expect(pay('PAID')).rejects.toMatchObject({ statusCode: 409 });
      await expectConsistent();
      expect(await ledger('RELEASE')).toBe(1);
    });
    it.each([
      'two successes',
      'success versus failure',
      'success versus cancellation',
      'success versus expiry',
    ])('resolves concurrent %s atomically', async (label) => {
      let competitor: () => Promise<unknown>;
      if (label === 'two successes') competitor = () => pay('PAID');
      else if (label === 'success versus failure')
        competitor = () => pay('FAILED');
      else if (label === 'success versus cancellation')
        competitor = () => order('CANCELLED');
      else
        competitor = () => orders.expirePendingOrder(tenantId, result.order.id);
      const blocker = new pg.Client({
        connectionString: env.TEST_DATABASE_URL,
      });
      await blocker.connect();
      let results: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM "Order" WHERE id=$1 FOR UPDATE', [
          result.order.id,
        ]);
        results = Promise.allSettled([pay('PAID'), competitor()]);
        const deadline = Date.now() + 3500;
        let count = 0;
        while (Date.now() < deadline) {
          const waiting = await testPrisma.$queryRaw<
            Array<{ count: number }>
          >`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Order"%'`;
          count = waiting[0]!.count;
          if (count >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(count).toBeGreaterThanOrEqual(2);
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
      }
      const completed = await results!;
      expect(completed.some((r) => r.status === 'fulfilled')).toBe(true);
      if (label === 'two successes')
        expect(completed.filter((r) => r.status === 'fulfilled')).toHaveLength(
          2,
        );
      for (const r of completed)
        if (r.status === 'rejected') expect(r.reason.statusCode).toBe(409);
      await expectConsistent();
    });
    it('rejects paid cancellation and safely repeats unpaid cancellation', async () => {
      await order('CANCELLED');
      await order('CANCELLED');
      expect((await state()).paymentStatus).toBe('CANCELLED');
      await expect(pay('PAID')).rejects.toMatchObject({ statusCode: 409 });
      await expectConsistent();
    });
    it('rejects cancellation after payment without inventing a refund', async () => {
      await pay('PAID');
      await expect(order('CANCELLED')).rejects.toMatchObject({
        code: 'PAID_ORDER_CANCELLATION_REQUIRES_REFUND',
      });
      await expect(
        payments.cancelPayment(tenantId, result.payment!.id),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_CANNOT_BE_CANCELLED',
      });
      await expectConsistent();
    });
    it('hardens the explicit payment cancellation entry point and duplicate requests', async () => {
      await payments.cancelPayment(tenantId, result.payment!.id);
      await payments.cancelPayment(tenantId, result.payment!.id);
      expect((await state()).paymentStatus).toBe('CANCELLED');
      expect(await ledger('RELEASE')).toBe(1);
      await expectConsistent();
    });

    it('expires an unknown payment locally and rejects late confirmation without rewriting its unknown outcome', async () => {
      await testPrisma.payment.update({
        where: { id: result.payment!.id },
        data: { initiationState: 'UNKNOWN' },
      });
      expect((await state()).paymentStatus).toBe('PENDING');
      expect(await ledger('RELEASE')).toBe(0);
      await orders.expirePendingOrder(tenantId, result.order.id);
      await expect(pay('PAID')).rejects.toMatchObject({ statusCode: 409 });
      expect((await state()).payments[0]!.initiationState).toBe('UNKNOWN');
      await expectConsistent();
    });
    it('does not release authorized stock on a stale failure after fulfillment begins', async () => {
      await pay('AUTHORIZED');
      await order('CONFIRMED');
      await order('PROCESSING');
      await expect(pay('FAILED')).rejects.toMatchObject({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect((await state()).paymentStatus).toBe('AUTHORIZED');
      await expectConsistent();
    });
    it('rolls back Payment and Order when inventory sale cannot be committed', async () => {
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { reservedQuantity: 0 },
      });
      await expect(pay('PAID')).rejects.toMatchObject({ statusCode: 409 });
      expect((await state()).paymentStatus).toBe('PENDING');
      expect((await state()).payments[0]!.status).toBe('PENDING');
      expect(await ledger('SALE')).toBe(0);
    });
    it('cannot bypass domain rules through public repository writers', async () => {
      await pay('PAID');
      const repository = new PaymentRepository();
      await expect(
        repository.updateStatus(tenantId, result.payment!.id, {
          status: 'FAILED',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        testPrisma.$transaction((tx) =>
          repository.updateStatusWithClient(
            tenantId,
            result.payment!.id,
            { status: 'FAILED' },
            tx,
          ),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        new OrderRepository(testPrisma).updateStatus(
          tenantId,
          result.order.id,
          'CANCELLED',
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      await expectConsistent();
    });
    it('runs inventory side effects even through repository transaction-client status updates and fails closed on manual PAID', async () => {
      await expect(
        testPrisma.$transaction((tx) =>
          new PaymentRepository().updateStatusWithClient(
            tenantId,
            result.payment!.id,
            { status: 'PAID' },
            tx,
          ),
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
      });
      await expect(
        new PaymentRepository().updateStatus(tenantId, result.payment!.id, {
          status: 'PAID',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
      });
      expect(await ledger('SALE')).toBe(0);
      await testPrisma.$transaction((tx) =>
        new PaymentRepository().updateStatusWithClient(
          tenantId,
          result.payment!.id,
          { status: 'FAILED' },
          tx,
        ),
      );
      await new PaymentRepository().updateStatus(tenantId, result.payment!.id, {
        status: 'FAILED',
      });
      expect(await ledger('RELEASE')).toBe(1);
      await expectConsistent();
    });
    it('rolls back cancellation when reservation release fails', async () => {
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { reservedQuantity: 0 },
      });
      await expect(order('CANCELLED')).rejects.toMatchObject({
        statusCode: 409,
      });
      expect((await state()).status).toBe('PENDING');
      expect((await state()).paymentStatus).toBe('PENDING');
      expect((await state()).payments[0]!.status).toBe('PENDING');
      expect(await ledger('RELEASE')).toBe(0);
    });
    it('rejects multiple historical payments rather than guessing an aggregate', async () => {
      await testPrisma.payment.create({
        data: {
          orderId: result.order.id,
          provider: 'NONE',
          method: 'CARD',
          amount: result.order.totalAmount,
          currency: 'EGP',
        },
      });
      await expect(pay('PAID')).rejects.toMatchObject({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect((await state()).paymentStatus).toBe('PENDING');
      expect(await ledger('SALE')).toBe(0);
    });
    it('uses the order-specific RELEASE ledger to reject legacy resurrection even if stock is reserved elsewhere', async () => {
      // Model a legacy outstanding payment with a recorded stock release while
      // leaving the checkout-created payment in its original PENDING state.
      await testPrisma.$transaction((tx) =>
        inventoryService.releaseOrderReservation(tenantId, result.order.id, tx),
      );
      expect((await state()).payments[0]!.status).toBe('PENDING');
      expect(await ledger('RELEASE')).toBe(1);
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { reservedQuantity: 2 },
      });
      await expect(pay('PAID')).rejects.toMatchObject({
        code: 'ORDER_INVENTORY_RESERVATION_RELEASED',
      });
      expect(await ledger('SALE')).toBe(0);
      expect(
        (
          await testPrisma.inventory.findUniqueOrThrow({
            where: { id: inventoryId },
          })
        ).reservedQuantity,
      ).toBe(2);
    });
    it('does not let a stale fulfillment update overwrite cancellation', async () => {
      await pay('AUTHORIZED');
      await order('CONFIRMED');
      const results = await Promise.allSettled([
        order('PROCESSING'),
        order('CANCELLED'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(['PROCESSING', 'CANCELLED']).toContain((await state()).status);
      await expectConsistent();
    });

    it('scopes all service and repository mutations to the tenant', async () => {
      const foreign = crypto.randomUUID();
      await expect(
        payments.updatePaymentStatus(foreign, result.payment!.id, {
          status: 'PAID',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        payments.cancelPayment(foreign, result.payment!.id),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        orders.updateStatus(foreign, result.order.id, { status: 'CANCELLED' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        orders.expirePendingOrder(foreign, result.order.id),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        new PaymentRepository().updateStatus(foreign, result.payment!.id, {
          status: 'PAID',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        new OrderRepository(testPrisma).updateStatus(
          foreign,
          result.order.id,
          'CONFIRMED',
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expectConsistent();
    });
    it('preserves immutable snapshots, coupon usage and current operational states on checkout replay', async () => {
      const before = await orders.getMyOrder(tenantId, userId, result.order.id);
      await pay('PAID');
      await order('CONFIRMED');
      const replay = await new CheckoutService().checkout(
        {
          shippingAddressId: addressId,
          billingSameAsShipping: true,
          couponCode: `${fixture}-coupon`.toUpperCase(),
          paymentMethod: PaymentMethod.CARD,
          paymentProvider: PaymentProvider.MYFATOORAH,
          shippingMethodCode: `${fixture}-standard`,
        },
        { tenantId, userId, idempotencyKey: key },
      );
      expect(replay.order.status).toBe('CONFIRMED');
      expect(replay.payment!.status).toBe('PAID');
      const after = await orders.getMyOrder(tenantId, userId, result.order.id);
      expect(after.items).toEqual(before.items);
      expect(after.couponSnapshot).toEqual(before.couponSnapshot);
      expect(after.shippingAddress).toEqual(before.shippingAddress);
      expect(after.totalAmount).toBe(before.totalAmount);
      expect(await testPrisma.couponUsage.count({ where: { couponId } })).toBe(
        1,
      );
      expect(
        (await testPrisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
          .usageCount,
      ).toBe(1);
      await expectConsistent();
    });
    it('rejects contradictory legacy aggregates without rewriting them', async () => {
      await testPrisma.order.update({
        where: { id: result.order.id },
        data: { paymentStatus: 'PAID' },
      });
      await expect(pay('FAILED')).rejects.toMatchObject({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      await expect(order('CONFIRMED')).rejects.toMatchObject({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect((await state()).paymentStatus).toBe('PAID');
      expect((await state()).payments[0]!.status).toBe('PENDING');
    });
    it('requires existing tenant roles for administrative mutations and owner checks for customers', async () => {
      const app = express();
      app.use(express.json());
      app.use('/orders', orderRoutes);
      app.use('/payments', paymentRoutes);
      app.use(errorMiddleware);
      await ensureFixtureMembership(tenantId, userId);
      try {
        const token = await createAccessToken(userId);
        expect(
          (
            await request(app)
              .patch(`/orders/${result.order.id}/status`)
              .set('Authorization', `Bearer ${token}`)
              .set('X-Tenant-Slug', fixture)
              .send({ status: 'CANCELLED' })
          ).status,
        ).toBe(403);
        expect(
          (
            await request(app)
              .patch(`/payments/${result.payment!.id}/status`)
              .set('Authorization', `Bearer ${token}`)
              .set('X-Tenant-Slug', fixture)
              .send({ status: 'PAID' })
          ).status,
        ).toBe(403);
        const other = await createAccessToken(foreignAccessUserId);
        expect(
          (
            await request(app)
              .get(`/orders/my/${result.order.id}`)
              .set('Authorization', `Bearer ${other}`)
              .set('X-Tenant-Slug', fixture)
          ).status,
        ).toBe(404);
        await testPrisma.tenantMember.update({
          where: { tenantId_userId: { tenantId, userId } },
          data: { role: 'ADMIN' },
        });
        expect(
          (
            await request(app)
              .patch(`/payments/${result.payment!.id}/status`)
              .set('Authorization', `Bearer ${token}`)
              .set('X-Tenant-Slug', fixture)
              .send({ status: 'PAID' })
          ).status,
        ).toBe(409);
        expect(
          (
            await request(app)
              .patch(`/payments/${result.payment!.id}/status`)
              .set('Authorization', `Bearer ${token}`)
              .set('X-Tenant-Slug', fixture)
              .send({ status: 'FAILED' })
          ).status,
        ).toBe(200);
        await expectConsistent();
      } finally {
        await testPrisma.tenantMember.deleteMany({
          where: { tenantId, userId },
        });
      }
    });
  });
  describe('tax edge cases and calculation hardening (Point 13)', () => {
    let categoryId: string;
    let savedRule: TaxRule;
    let savedProfile: TaxProfile;
    let taxKey: string;
    const products: string[] = [];
    const categories: string[] = [];
    const rules: string[] = [];
    const profiles: string[] = [];
    const tenants: string[] = [];
    const taxInput = () => ({
      shippingAddressId: addressId,
      billingSameAsShipping: true,
      paymentMethod: PaymentMethod.CARD,
      paymentProvider: PaymentProvider.NONE,
      shippingMethodCode: `${fixture}-standard`,
    });
    const checkoutTax = async (coupon = false) => {
      const result = await new CheckoutService().checkout(
        {
          ...taxInput(),
          ...(coupon ? { couponCode: `${fixture}-coupon`.toUpperCase() } : {}),
        },
        { tenantId, userId, idempotencyKey: taxKey },
      );
      return testPrisma.order.findUniqueOrThrow({
        where: { id: result.order.id },
        include: { items: true, payments: true },
      });
    };
    beforeEach(async () => {
      await ensureFixtureMembership(tenantId, userId);
      categoryId = (
        await testPrisma.productVariant.findUniqueOrThrow({
          where: { id: variantId },
        })
      ).taxCategoryId!;
      savedRule = await testPrisma.taxRule.findFirstOrThrow({
        where: { taxCategoryId: categoryId },
      });
      savedProfile = await testPrisma.taxProfile.findUniqueOrThrow({
        where: { id: taxProfileId },
      });
      taxKey = crypto.randomUUID();
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '100' },
      });
      await testPrisma.cartItem.updateMany({
        where: { cartId },
        data: { quantity: 1 },
      });
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '10' },
      });
    });
    afterEach(async () => {
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { taxCategoryId: categoryId, price: null },
      });
      await testPrisma.product.update({
        where: { id: productId },
        data: { taxCategoryId: null },
      });
      await testPrisma.taxProfile.deleteMany({
        where: { id: { in: profiles } },
      });
      await testPrisma.taxProfile.upsert({
        where: { id: taxProfileId },
        create: savedProfile,
        update: savedProfile,
      });
      await testPrisma.taxRule.deleteMany({ where: { id: { in: rules } } });
      await testPrisma.taxRule.upsert({
        where: { id: savedRule.id },
        create: savedRule,
        update: savedRule,
      });
      await testPrisma.product.deleteMany({ where: { id: { in: products } } });
      await testPrisma.taxCategory.deleteMany({
        where: { id: { in: categories } },
      });
      await deleteFixtureTenants({ where: { id: { in: tenants } } });
      await testPrisma.taxCategory.update({
        where: { id: categoryId },
        data: { isActive: true, treatment: 'STANDARD' },
      });
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { discountValue: '2', discountType: 'FIXED_AMOUNT' },
      });
      await testPrisma.address.update({
        where: { id: addressId },
        data: { state: null },
      });
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { quantity: 10, reservedQuantity: 0 },
      });
      products.length =
        categories.length =
        rules.length =
        profiles.length =
        tenants.length =
          0;
    });
    const addRule = async (data: Partial<TaxRule>) => {
      const row = await testPrisma.taxRule.create({
        data: { taxCategoryId: categoryId, countryCode, rate: '20', ...data },
      });
      rules.push(row.id);
      return row;
    };
    const addLine = async (
      price: string,
      rate: string,
      treatment: 'STANDARD' | 'EXEMPT' | 'ZERO_RATED' = 'STANDARD',
    ) => {
      const code = crypto.randomUUID();
      const tax = await testPrisma.taxCategory.create({
        data: { tenantId, code, name: code, treatment },
      });
      categories.push(tax.id);
      const rule = await testPrisma.taxRule.create({
        data: { taxCategoryId: tax.id, countryCode, rate },
      });
      rules.push(rule.id);
      const parent = await testPrisma.product.findUniqueOrThrow({
        where: { id: productId },
      });
      const product = await testPrisma.product.create({
        data: {
          tenantId,
          categoryId: parent.categoryId,
          name: code,
          slug: code,
          basePrice: price,
          status: 'ACTIVE',
        },
      });
      products.push(product.id);
      const variant = await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: code,
          combinationKey: 'default',
          taxCategoryId: tax.id,
        },
      });
      await createInventoryFixture({
        data: { variantId: variant.id, quantity: 100 },
      });
      await testPrisma.cartItem.create({
        data: { cartId, variantId: variant.id, quantity: 1 },
      });
      return variant;
    };
    const expectBreakdown = async (
      order: Awaited<ReturnType<typeof checkoutTax>>,
    ) => {
      const tax = order.items.reduce(
        (sum, line) => sum.plus(line.taxAmount),
        new Prisma.Decimal(0),
      );
      const discounted = order.items.reduce(
        (sum, line) =>
          sum
            .plus(line.taxableAmount)
            .plus(order.pricesIncludeTax ? line.taxAmount : 0),
        new Prisma.Decimal(0),
      );
      expect(tax.equals(order.taxAmount)).toBe(true);
      expect(
        discounted.equals(order.subtotal.minus(order.discountAmount)),
      ).toBe(true);
      expect(
        order.subtotal
          .minus(order.discountAmount)
          .plus(order.shippingAmount)
          .plus(order.pricesIncludeTax ? 0 : order.taxAmount)
          .equals(order.totalAmount),
      ).toBe(true);
      expect(order.payments[0]!.amount.equals(order.totalAmount)).toBe(true);
      expect(order.payments[0]!.currency).toBe(order.currency);
    };

    it('adds exclusive tax once on the persisted discounted merchandise base', async () => {
      const order = await checkoutTax();
      expect(order.taxAmount.toString()).toBe('10');
      expect(order.totalAmount.toString()).toBe('113');
      expect(order.items[0]!.taxableAmount.toString()).toBe('100');
      await expectBreakdown(order);
    });
    it('extracts inclusive tax without adding it again to gross checkout totals', async () => {
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { pricesIncludeTax: true },
      });
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '110' },
      });
      const order = await checkoutTax();
      expect(order.taxAmount.toString()).toBe('10');
      expect(order.items[0]!.taxableAmount.toString()).toBe('100');
      expect(order.totalAmount.toString()).toBe('113');
      expect(order.pricesIncludeTax).toBe(true);
      await expectBreakdown(order);
    });
    it('applies product discounts before computing tax', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { discountType: 'PERCENTAGE', discountValue: '10' },
      });
      const order = await checkoutTax();
      expect(order.subtotal.toString()).toBe('90');
      expect(order.taxAmount.toString()).toBe('9');
      await expectBreakdown(order);
    });
    it('uses the variant override price before coupon and tax', async () => {
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { price: '50' },
      });
      const order = await checkoutTax(true);
      expect(order.subtotal.toString()).toBe('50');
      expect(order.items[0]!.taxableAmount.toString()).toBe('48');
      expect(order.taxAmount.toString()).toBe('4.8');
      await expectBreakdown(order);
    });
    it.each([false, true])(
      'applies coupons before tax (inclusive %s)',
      async (inclusive) => {
        await testPrisma.taxProfile.update({
          where: { id: taxProfileId },
          data: { pricesIncludeTax: inclusive },
        });
        await testPrisma.product.update({
          where: { id: productId },
          data: { basePrice: inclusive ? '110' : '100' },
        });
        await testPrisma.coupon.update({
          where: { id: couponId },
          data: { discountValue: '10' },
        });
        const order = await checkoutTax(true);
        expect(order.discountAmount.toString()).toBe('10');
        expect(order.taxAmount.toString()).toBe(inclusive ? '9.09' : '9');
        await expectBreakdown(order);
      },
    );
    it('keeps independent rates and line rounding in a multi-category basket', async () => {
      await addLine('100', '20');
      const order = await checkoutTax();
      expect(order.taxAmount.toString()).toBe('30');
      expect(order.items).toHaveLength(2);
      await expectBreakdown(order);
    });
    it.each(['EXEMPT', 'ZERO_RATED'] as const)(
      'preserves taxable lines alongside %s categories',
      async (treatment) => {
        const extra = await addLine('100', '20', treatment);
        const order = await checkoutTax();
        expect(order.taxAmount.toString()).toBe('10');
        const exempt = order.items.find((i) => i.variantId === extra.id)!;
        expect(exempt.taxTreatment).toBe(treatment);
        expect(exempt.taxAmount.isZero()).toBe(true);
        await expectBreakdown(order);
      },
    );
    it('allocates a coupon deterministically without placing the remainder on a zero-price line', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '0.01' },
      });
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '100' },
      });
      await addLine('0.01', '50');
      await addLine('0', '100');
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { discountValue: '0.01' },
      });
      const first = await checkoutTax(true);
      await expectBreakdown(first);
      expect(first.items.every((i) => i.taxableAmount.gte(0))).toBe(true);
      const contents = first.items
        .map((i) => ({ cartId, variantId: i.variantId, quantity: 1 }))
        .reverse();
      await testPrisma.cartItem.createMany({ data: contents });
      taxKey = crypto.randomUUID();
      const second = await checkoutTax(true);
      const values = (order: typeof first) =>
        order.items
          .map((i) => ({
            variantId: i.variantId,
            taxable: i.taxableAmount.toString(),
            tax: i.taxAmount.toString(),
          }))
          .sort((a, b) => a.variantId.localeCompare(b.variantId));
      expect(values(second)).toEqual(values(first));
      await expectBreakdown(second);
    });
    it('allocates discounts proportionally across different rates with exact total conservation', async () => {
      await addLine('50', '20');
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { discountValue: '15' },
      });
      const order = await checkoutTax(true);
      expect(order.taxAmount.toString()).toBe('18');
      expect(order.discountAmount.toString()).toBe('15');
      await expectBreakdown(order);
    });
    it('selects higher priority overlapping rules without stacking them', async () => {
      const selected = await addRule({
        rate: new Prisma.Decimal('20'),
        priority: 10,
      });
      const order = await checkoutTax();
      expect(order.items[0]!.taxRuleId).toBe(selected.id);
      expect(order.taxAmount.toString()).toBe('20');
    });
    it('matches the stored country and ignores misleading client tax locations', async () => {
      await addRule({
        countryCode: 'ZZ',
        rate: new Prisma.Decimal('90'),
        priority: 999,
      });
      const input = {
        ...taxInput(),
        countryCode: 'ZZ',
        regionCode: 'FAKE',
        taxRate: '0',
      };
      const result = await new CheckoutService().checkout(input, {
        tenantId,
        userId,
        idempotencyKey: taxKey,
      });
      const order = await testPrisma.order.findUniqueOrThrow({
        where: { id: result.order.id },
        include: { items: true },
      });
      expect(order.items[0]!.taxRuleId).toBe(savedRule.id);
      expect(order.taxCountryCode).toBe(countryCode);
    });
    it('prefers normalized region-specific rules over a higher-priority country fallback', async () => {
      await testPrisma.address.update({
        where: { id: addressId },
        data: { state: ' cairo ' },
      });
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { priority: 99 },
      });
      const regional = await addRule({
        regionCode: 'CAIRO',
        rate: new Prisma.Decimal('15'),
        priority: 0,
      });
      const order = await checkoutTax();
      expect(order.items[0]!.taxRuleId).toBe(regional.id);
      expect(order.taxProfileSnapshot).toMatchObject({
        rules: [{ id: regional.id, regionCode: 'CAIRO' }],
      });
      expect(order.taxAmount.toString()).toBe('15');
    });
    it('uses region-specific tax profile settings and snapshots the actual selected profile', async () => {
      await testPrisma.address.update({
        where: { id: addressId },
        data: { state: ' cairo ' },
      });
      const profile = await testPrisma.taxProfile.create({
        data: {
          tenantId,
          countryCode,
          regionCode: 'CAIRO',
          currency: 'EGP',
          pricesIncludeTax: true,
          defaultTaxCategoryId: categoryId,
        },
      });
      profiles.push(profile.id);
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '110' },
      });
      const order = await checkoutTax();
      expect(order.pricesIncludeTax).toBe(true);
      expect(order.taxAmount.toString()).toBe('10');
      expect(order.taxProfileSnapshot).toMatchObject({
        profileId: profile.id,
        profileRegionCode: 'CAIRO',
      });
      await expectBreakdown(order);
    });
    it('uses a stable rule ID tie-breaker after equal priority and effective start', async () => {
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { isActive: false },
      });
      const start = new Date('2020-01-01T00:00:00Z');
      const a = await addRule({ effectiveFrom: start, priority: 10 });
      const b = await addRule({
        effectiveFrom: start,
        priority: 10,
        rate: new Prisma.Decimal('25'),
      });
      const order = await checkoutTax();
      expect(order.items[0]!.taxRuleId).toBe([a.id, b.id].sort()[0]);
    });
    it('prefers the latest bounded effective start over an unbounded rule at equal priority', async () => {
      const selected = await addRule({
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });
      const order = await checkoutTax();
      expect(order.items[0]!.taxRuleId).toBe(selected.id);
    });
    it('treats effectiveFrom as inclusive and effectiveTo as exclusive', async () => {
      const now = new Date('2026-10-29T12:00:00Z');
      await addRule({
        priority: 100,
        effectiveTo: now,
        rate: new Prisma.Decimal('90'),
      });
      const selected = await addRule({
        priority: 99,
        effectiveFrom: now,
        rate: new Prisma.Decimal('15'),
      });
      const result = await new TaxService(
        new TaxRepository(testPrisma),
      ).calculateForAmount({
        tenantId,
        currency: 'EGP',
        scopeKey: 'GLOBAL',
        amountCents: 10000n,
        address: { countryCode },
        category: { variantTaxCategoryId: categoryId },
        now,
      });
      expect(result.taxRuleId).toBe(selected.id);
      expect(result.taxAmountCents).toBe(1500n);
    });
    it('excludes inactive, future, expired, and other-region rules', async () => {
      await addRule({ priority: 99, isActive: false });
      await addRule({
        priority: 99,
        effectiveFrom: new Date(Date.now() + 86400000),
      });
      await addRule({
        priority: 99,
        effectiveTo: new Date(Date.now() - 86400000),
      });
      await addRule({ priority: 99, regionCode: 'OTHER' });
      const order = await checkoutTax();
      expect(order.items[0]!.taxRuleId).toBe(savedRule.id);
    });
    it.each(['0', '100'])(
      'supports the boundary rate %s percent',
      async (rate) => {
        await testPrisma.taxRule.update({
          where: { id: savedRule.id },
          data: { rate },
        });
        const order = await checkoutTax();
        expect(order.taxAmount.toString()).toBe(rate);
        await expectBreakdown(order);
      },
    );
    it('handles zero-priced merchandise without allocating a negative taxable base', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '0' },
      });
      const order = await checkoutTax();
      expect(order.taxAmount.isZero()).toBe(true);
      expect(order.items[0]!.taxableAmount.isZero()).toBe(true);
      await expectBreakdown(order);
    });
    it.each(['product', 'coupon'])(
      'handles a 100 percent %s discount',
      async (mode) => {
        if (mode === 'product')
          await testPrisma.product.update({
            where: { id: productId },
            data: { discountType: 'PERCENTAGE', discountValue: '100' },
          });
        else
          await testPrisma.coupon.update({
            where: { id: couponId },
            data: { discountType: 'PERCENTAGE', discountValue: '100' },
          });
        const order = await checkoutTax(mode === 'coupon');
        expect(order.taxAmount.isZero()).toBe(true);
        expect(order.items[0]!.taxableAmount.isZero()).toBe(true);
        await expectBreakdown(order);
      },
    );
    it('rounds half-up per line rather than rounding the combined tax base', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '0.05' },
      });
      await addLine('0.05', '10');
      const order = await checkoutTax();
      expect(order.taxAmount.toString()).toBe('0.02');
      expect(order.items.every((i) => i.taxAmount.equals('0.01'))).toBe(true);
      await expectBreakdown(order);
    });
    it('keeps high quantity calculations in integer cents with exact fractional rates', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '0.03' },
      });
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { quantity: 300001 },
      });
      await testPrisma.cartItem.updateMany({
        where: { cartId },
        data: { quantity: 300001 },
      });
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '17.50' },
      });
      const order = await checkoutTax();
      expect(order.subtotal.toString()).toBe('9000.03');
      expect(order.taxAmount.toString()).toBe('1575.01');
      expect(order.items[0]!.taxRate!.toString()).toBe('17.5');
      await expectBreakdown(order);
    });
    it('rejects a total including tax that exceeds persisted Decimal precision before any checkout write', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '6000000000.00' },
      });
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '100' },
      });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'CHECKOUT_AMOUNT_OUT_OF_RANGE',
        statusCode: 400,
      });
      await expectRolledBack();
    });

    it('snapshots fractional percent rates without floating-point conversion', async () => {
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '0.29' },
      });
      const order = await checkoutTax();
      expect(order.items[0]!.taxRate!.toString()).toBe('0.29');
      expect(order.taxAmount.toString()).toBe('0.29');
      await expectBreakdown(order);
    });
    it('leaves shipping untaxed because no shipping taxability configuration exists', async () => {
      const order = await checkoutTax();
      expect(order.shippingAmount.toString()).toBe('3');
      expect(order.taxAmount.toString()).toBe('10');
      await expectBreakdown(order);
    });
    it('fails cleanly when the tax profile is missing', async () => {
      await testPrisma.taxProfile.delete({ where: { id: taxProfileId } });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_PROFILE_NOT_CONFIGURED',
        statusCode: 400,
      });
      await expectRolledBack();
    });
    it('fails cleanly after the only tax rule is deleted', async () => {
      await testPrisma.taxRule.delete({ where: { id: savedRule.id } });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_RULE_NOT_CONFIGURED',
      });
      await expectRolledBack();
    });
    it('resolves tax configuration through the supplied transaction client without leaking rolled-back changes', async () => {
      await expect(
        testPrisma.$transaction(async (tx) => {
          await tx.taxRule.update({
            where: { id: savedRule.id },
            data: { rate: '33.33' },
          });
          const result = await new TaxService(
            new TaxRepository(tx),
          ).calculateForAmount({
            tenantId,
            currency: 'EGP',
            scopeKey: 'GLOBAL',
            amountCents: 10000n,
            address: { countryCode },
            category: { variantTaxCategoryId: categoryId },
          });
          expect(result.taxAmountCents).toBe(3333n);
          throw new Error('Roll back tax configuration');
        }),
      ).rejects.toThrow('Roll back tax configuration');
      expect((await checkoutTax()).taxAmount.toString()).toBe('10');
    });
    it('uses fresh configuration for a new key while replaying the original tax for the old key', async () => {
      const originalKey = taxKey;
      const first = await checkoutTax();
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '20' },
      });
      await testPrisma.cartItem.create({
        data: { cartId, variantId, quantity: 1 },
      });
      taxKey = crypto.randomUUID();
      const second = await checkoutTax();
      expect(second.taxAmount.toString()).toBe('20');
      const replay = await new CheckoutService().checkout(taxInput(), {
        tenantId,
        userId,
        idempotencyKey: originalKey,
      });
      expect(
        new Prisma.Decimal(replay.order.taxAmount).equals(first.taxAmount),
      ).toBe(true);
      expect(replay.order.id).toBe(first.id);
    });
    it('preserves a one-cent inclusive gross amount at the maximum supported rate', async () => {
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { pricesIncludeTax: true },
      });
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '100' },
      });
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '0.01' },
      });
      const order = await checkoutTax();
      expect(order.items[0]!.taxableAmount.isZero()).toBe(true);
      expect(order.taxAmount.toString()).toBe('0.01');
      expect(order.totalAmount.toString()).toBe('3.01');
      await expectBreakdown(order);
    });

    it('fails cleanly when all destination rules are inactive', async () => {
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { isActive: false },
      });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_RULE_NOT_CONFIGURED',
      });
      await expectRolledBack();
    });
    it('fails cleanly when the selected category is inactive', async () => {
      await testPrisma.taxCategory.update({
        where: { id: categoryId },
        data: { isActive: false },
      });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_CATEGORY_NOT_CONFIGURED',
      });
      await expectRolledBack();
    });
    it('requires a configured category when no override or default exists', async () => {
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { taxCategoryId: null },
      });
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { defaultTaxCategoryId: null },
      });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_CATEGORY_NOT_CONFIGURED',
      });
      await expectRolledBack();
    });
    it.each(['product', 'default'])(
      'uses the %s tax category fallback correctly',
      async (layer) => {
        await testPrisma.productVariant.update({
          where: { id: variantId },
          data: { taxCategoryId: null },
        });
        if (layer === 'product') {
          await testPrisma.product.update({
            where: { id: productId },
            data: { taxCategoryId: categoryId },
          });
          await testPrisma.taxProfile.update({
            where: { id: taxProfileId },
            data: { defaultTaxCategoryId: null },
          });
        }
        const order = await checkoutTax();
        expect(order.items[0]!.taxCategoryId).toBe(categoryId);
        expect(order.taxAmount.toString()).toBe('10');
      },
    );
    it.each(['-1', '100.01'])(
      'rejects invalid stored rate %s without committing checkout',
      async (rate) => {
        await testPrisma.taxRule.update({
          where: { id: savedRule.id },
          data: { rate },
        });
        await expect(checkoutTax()).rejects.toMatchObject({
          code: 'INVALID_TAX_RATE',
          statusCode: 500,
        });
        await expectRolledBack();
      },
    );
    it('rejects ambiguous active profiles instead of choosing arbitrary tax mode', async () => {
      const extra = await testPrisma.taxProfile.create({
        data: {
          tenantId,
          countryCode,
          currency: 'EGP',
          pricesIncludeTax: true,
          defaultTaxCategoryId: categoryId,
        },
      });
      profiles.push(extra.id);
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_PROFILE_AMBIGUOUS',
      });
      await expectRolledBack();
    });
    it('does not use foreign tenant categories, exemptions or rules', async () => {
      const id = crypto.randomUUID();
      const tenant = await testPrisma.tenant.create({
        data: { name: id, slug: id, code: id, defaultCurrency: 'USD' },
      });
      tenants.push(tenant.id);
      const foreign = await testPrisma.taxCategory.create({
        data: { tenantId: tenant.id, code: id, name: id, treatment: 'EXEMPT' },
      });
      categories.push(foreign.id);
      const rule = await testPrisma.taxRule.create({
        data: {
          taxCategoryId: foreign.id,
          countryCode,
          rate: '0',
          priority: 999,
        },
      });
      rules.push(rule.id);
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { taxCategoryId: foreign.id },
      });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_RULE_NOT_CONFIGURED',
      });
      await expectRolledBack();
    });
    it('retains original taxes and profile/rule snapshots after edits and idempotent replay', async () => {
      const order = await checkoutTax(true);
      const before = await new OrderService().getMyOrder(
        tenantId,
        userId,
        order.id,
      );
      await testPrisma.taxRule.update({
        where: { id: savedRule.id },
        data: { rate: '90', isActive: false },
      });
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { pricesIncludeTax: true, isActive: false },
      });
      const replay = await new CheckoutService().checkout(
        { ...taxInput(), couponCode: `${fixture}-coupon`.toUpperCase() },
        { tenantId, userId, idempotencyKey: taxKey },
      );
      expect(replay.idempotent).toBe(true);
      expect(
        new Prisma.Decimal(replay.order.taxAmount).equals(order.taxAmount),
      ).toBe(true);
      expect(
        await new OrderService().getMyOrder(tenantId, userId, order.id),
      ).toEqual(before);
      expect(order.taxProfileSnapshot).toMatchObject({
        profileId: taxProfileId,
        currency: 'EGP',
        roundingPolicy: 'HALF_UP_PER_LINE',
      });
    });
    it('uses the authoritative tenant/order currency for tax and rejects profile mismatch', async () => {
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { currency: 'USD' },
      });
      await expect(checkoutTax()).rejects.toMatchObject({
        code: 'TAX_CURRENCY_MISMATCH',
      });
      await expectRolledBack();
    });
  });
  describe('read-only checkout preview (Point 14)', () => {
    const service = new CheckoutService();
    let key: string;
    let taxCategoryId: string;
    let savedRules: TaxRule[];
    let savedProfile: TaxProfile;
    let savedShipping: ShippingProfile;
    let savedShippingRules: ShippingRule[];
    const addedProducts: string[] = [];
    const addedCategories: string[] = [];
    const addedTenants: string[] = [];
    const addedUsers: string[] = [];
    const input = (): CheckoutPreviewInput => ({
      shippingAddressId: addressId,
      billingSameAsShipping: true,
      shippingMethodCode: `${fixture}-standard`,
      couponCode: `${fixture}-coupon`.toUpperCase(),
    });
    const context = () => ({ tenantId, userId });
    beforeEach(async () => {
      await ensureFixtureMembership(tenantId, userId);
      key = crypto.randomUUID();
      taxCategoryId = (
        await testPrisma.productVariant.findUniqueOrThrow({
          where: { id: variantId },
        })
      ).taxCategoryId!;
      savedRules = await testPrisma.taxRule.findMany({
        where: { taxCategory: { tenantId } },
      });
      savedProfile = await testPrisma.taxProfile.findUniqueOrThrow({
        where: { id: taxProfileId },
      });
      savedShipping = await testPrisma.shippingProfile.findUniqueOrThrow({
        where: { id: shippingProfileId },
      });
      savedShippingRules = await testPrisma.shippingRule.findMany({
        where: { method: { zone: { profileId: shippingProfileId } } },
      });
      await testPrisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
    });
    afterEach(async () => {
      await testPrisma.cartItem.deleteMany({ where: { cartId } });
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { price: null, taxCategoryId, isActive: true },
      });
      await testPrisma.product.update({
        where: { id: productId },
        data: { status: 'ACTIVE' },
      });
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: savedProfile,
      });
      for (const rule of savedRules)
        await testPrisma.taxRule.update({ where: { id: rule.id }, data: rule });
      await testPrisma.shippingProfile.update({
        where: { id: shippingProfileId },
        data: savedShipping,
      });
      for (const rule of savedShippingRules)
        await testPrisma.shippingRule.update({
          where: { id: rule.id },
          data: rule,
        });
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: {
          isActive: true,
          startsAt: null,
          endsAt: null,
          usageLimit: 100,
          perUserLimit: null,
          usageCount: 0,
          minimumOrderAmount: null,
          maximumDiscountAmount: null,
          discountType: 'FIXED_AMOUNT',
          discountValue: '2',
        },
      });
      await testPrisma.taxRule.deleteMany({
        where: { taxCategoryId: { in: addedCategories } },
      });
      await testPrisma.product.deleteMany({
        where: { id: { in: addedProducts } },
      });
      await testPrisma.taxCategory.deleteMany({
        where: { id: { in: addedCategories } },
      });
      for (const id of addedTenants) {
        await testPrisma.taxRule.deleteMany({
          where: { taxCategory: { tenantId: id } },
        });
        await deleteFixtureTenant({ where: { id } });
      }
      await testPrisma.cart.deleteMany({
        where: { userId: { in: addedUsers } },
      });
      await testPrisma.address.deleteMany({
        where: { userId: { in: addedUsers } },
      });
      await testPrisma.user.deleteMany({ where: { id: { in: addedUsers } } });
      await testPrisma.address.update({
        where: { id: addressId },
        data: { latitude: '30', longitude: '31' },
      });
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { quantity: 10, reservedQuantity: 0 },
      });
      addedProducts.length =
        addedCategories.length =
        addedTenants.length =
        addedUsers.length =
          0;
    });
    const databaseState = async (
      scopeTenant = tenantId,
      scopeUser = userId,
    ) => {
      const [
        orders,
        items,
        payments,
        requests,
        coupons,
        usage,
        inventory,
        transactions,
        carts,
      ] = await Promise.all([
        testPrisma.order.findMany({
          where: { tenantId: scopeTenant },
          orderBy: { id: 'asc' },
        }),
        testPrisma.orderItem.findMany({
          where: { order: { tenantId: scopeTenant } },
          orderBy: { id: 'asc' },
        }),
        testPrisma.payment.findMany({
          where: { order: { tenantId: scopeTenant } },
          orderBy: { id: 'asc' },
        }),
        testPrisma.checkoutRequest.findMany({
          where: { tenantId: scopeTenant },
          orderBy: { id: 'asc' },
        }),
        testPrisma.coupon.findMany({
          where: { tenantId: scopeTenant },
          orderBy: { id: 'asc' },
        }),
        testPrisma.couponUsage.findMany({
          where: { coupon: { tenantId: scopeTenant } },
          orderBy: { id: 'asc' },
        }),
        testPrisma.inventory.findMany({
          where: { variant: { product: { tenantId: scopeTenant } } },
          orderBy: { id: 'asc' },
        }),
        testPrisma.inventoryTransaction.findMany({
          where: {
            inventory: { variant: { product: { tenantId: scopeTenant } } },
          },
          orderBy: { id: 'asc' },
        }),
        testPrisma.cart.findMany({
          where: { tenantId: scopeTenant, userId: scopeUser },
          include: { items: { orderBy: { variantId: 'asc' } } },
          orderBy: { id: 'asc' },
        }),
      ]);
      return {
        orders,
        items,
        payments,
        requests,
        coupons,
        usage,
        inventory,
        transactions,
        carts,
      };
    };
    const preview = async (patch: Partial<CheckoutPreviewInput> = {}) => {
      const before = await databaseState();
      const result = await service.preview({ ...input(), ...patch }, context());
      expect(await databaseState()).toEqual(before);
      return result;
    };
    const reject = async (
      code: string,
      patch: Partial<CheckoutPreviewInput> = {},
    ) => {
      const before = await databaseState();
      await expect(
        service.preview({ ...input(), ...patch }, context()),
      ).rejects.toMatchObject({ code });
      expect(await databaseState()).toEqual(before);
    };
    const compareCheckout = async (
      patch: Partial<CheckoutPreviewInput> = {},
    ) => {
      const estimate = await preview(patch);
      const checkout = await service.checkout(
        {
          ...input(),
          ...patch,
          paymentMethod: PaymentMethod.CARD,
          paymentProvider: PaymentProvider.NONE,
        },
        { ...context(), idempotencyKey: key },
      );
      expect(estimate.currency).toBe(checkout.order.currency);
      for (const field of [
        'subtotal',
        'shippingAmount',
        'taxAmount',
        'totalAmount',
      ] as const)
        expect(estimate[field]).toBe(checkout.order[field]);
      expect(estimate.couponDiscount).toBe(checkout.order.discountAmount);
      for (const line of estimate.items) {
        const actual = checkout.order.items.find(
          (i) => i.variantId === line.variantId,
        )!;
        expect(line).toMatchObject({
          unitPrice: actual.unitPrice,
          finalUnitPrice: actual.finalUnitPrice,
          totalPrice: actual.totalPrice,
          quantity: actual.quantity,
          itemDiscountAmount: actual.itemDiscountAmount,
        });
      }
      const persisted = await testPrisma.orderItem.findMany({
        where: { orderId: checkout.order.id },
      });
      for (const line of estimate.taxBreakdown) {
        const actual = persisted.find((i) => i.variantId === line.variantId)!;
        expect(line.taxAmount).toBe(actual.taxAmount.toString());
        expect(line.taxableAmount).toBe(actual.taxableAmount.toString());
        expect(line.taxRate).toBe(actual.taxRate!.toString());
      }
      expect(checkout.idempotent).toBe(false);
      return { estimate, checkout };
    };
    const app = () => {
      const result = express();
      result.use(express.json());
      result.use('/checkout', checkoutRoutes);
      result.use(errorMiddleware);
      return result;
    };
    const httpPreview = async (
      body: object = input(),
      headerKey?: string,
      owner = userId,
      slug = fixture,
    ) => {
      const token = await createAccessToken(owner);
      const req = request(app())
        .post('/checkout/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', slug);
      if (headerKey) req.set('Idempotency-Key', headerKey);
      return req.send(body);
    };
    const foreignAddress = async () => {
      const user = await testPrisma.user.create({
        data: {
          email: `${crypto.randomUUID()}@example.test`,
          passwordHash: 'test',
          firstName: 'Other',
          lastName: 'Customer',
          emailVerifiedAt: new Date(),
        },
      });
      addedUsers.push(user.id);
      return testPrisma.address.create({
        data: {
          userId: user.id,
          firstName: 'Other',
          lastName: 'Customer',
          addressLine1: 'Street',
          city: 'Other',
          countryCode,
          latitude: '30',
          longitude: '31',
        },
      });
    };
    const foreignTenant = async () => {
      const name = crypto.randomUUID();
      const tenant = await testPrisma.tenant.create({
        data: { name, slug: name, code: name, defaultCurrency: 'USD' },
      });
      addedTenants.push(tenant.id);
      const cat = await testPrisma.category.create({
        data: { tenantId: tenant.id, name, slug: name },
      });
      const tax = await testPrisma.taxCategory.create({
        data: { tenantId: tenant.id, name, code: name },
      });
      const product = await testPrisma.product.create({
        data: {
          tenantId: tenant.id,
          categoryId: cat.id,
          name,
          slug: name,
          basePrice: '50',
          status: 'ACTIVE',
        },
      });
      const variant = await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: name,
          combinationKey: 'default',
          taxCategoryId: tax.id,
        },
      });
      await createInventoryFixture({
        data: { variantId: variant.id, quantity: 10 },
      });
      const cart = await createCartFixture({
        data: { tenantId: tenant.id, userId },
      });
      await testPrisma.cartItem.create({
        data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
      });
      await testPrisma.taxProfile.create({
        data: {
          tenantId: tenant.id,
          countryCode,
          currency: 'USD',
          defaultTaxCategoryId: tax.id,
          pricesIncludeTax: false,
        },
      });
      await testPrisma.taxRule.create({
        data: { taxCategoryId: tax.id, countryCode, rate: '10' },
      });
      const profile = await createShippingProfileFixture({
        data: {
          tenantId: tenant.id,
          countryCode,
          currency: 'USD',
          originLatitude: '30',
          originLongitude: '30.5',
        },
      });
      const zone = await testPrisma.shippingZone.create({
        data: { profileId: profile.id, code: name, name, countryCode },
      });
      const method = await testPrisma.shippingMethod.create({
        data: { zoneId: zone.id, code: name, name },
      });
      await testPrisma.shippingRule.create({
        data: { methodId: method.id, flatRate: '4', maxDistanceKm: '50' },
      });
      return { tenant, variant, method };
    };

    it('returns current authoritative totals and leaves every business table unchanged', async () => {
      const result = await preview();
      expect(result).toMatchObject({
        estimated: true,
        currency: 'EGP',
        subtotal: '40',
        productDiscount: '0',
        couponDiscount: '2',
        shippingAmount: '3',
        taxAmount: '1.9',
        totalAmount: '42.9',
      });
      expect(result.items).toHaveLength(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      const after = await databaseState();
      expect(after.orders).toHaveLength(0);
      expect(after.items).toHaveLength(0);
      expect(after.payments).toHaveLength(0);
      expect(after.requests).toHaveLength(0);
      expect(after.usage).toHaveLength(0);
      expect(after.transactions).toHaveLength(0);
      expect(after.inventory[0]!.reservedQuantity).toBe(0);
      expect(after.carts[0]!.items).toHaveLength(1);
    });
    it('matches immediate checkout totals, item prices, shipping and tax exactly', async () => {
      await compareCheckout();
    });
    it('matches product-discounted checkout totals', async () => {
      await testPrisma.product.update({
        where: { id: productId },
        data: { discountType: 'PERCENTAGE', discountValue: '10' },
      });
      const { estimate } = await compareCheckout();
      expect(estimate.productDiscount).toBe('4');
    });
    it('matches variant override prices and product discount precedence', async () => {
      await testPrisma.productVariant.update({
        where: { id: variantId },
        data: { price: '30' },
      });
      const { estimate } = await compareCheckout();
      expect(estimate.subtotal).toBe('60');
    });
    it.each([false, true])(
      'matches tax mode inclusive=%s using the same engine',
      async (inclusive) => {
        await testPrisma.taxProfile.update({
          where: { id: taxProfileId },
          data: { pricesIncludeTax: inclusive },
        });
        const { estimate } = await compareCheckout();
        expect(estimate.pricesIncludeTax).toBe(inclusive);
      },
    );
    it.each(['STANDARD', 'EXEMPT', 'ZERO_RATED'] as const)(
      'matches multi-line coupon allocation and %s category tax breakdown',
      async (treatment) => {
        const name = crypto.randomUUID();
        const tax = await testPrisma.taxCategory.create({
          data: { tenantId, name, code: name, treatment },
        });
        addedCategories.push(tax.id);
        await testPrisma.taxRule.create({
          data: { taxCategoryId: tax.id, countryCode, rate: '20' },
        });
        const parent = await testPrisma.product.findUniqueOrThrow({
          where: { id: productId },
        });
        const product = await testPrisma.product.create({
          data: {
            tenantId,
            categoryId: parent.categoryId,
            name,
            slug: name,
            basePrice: '100',
            status: 'ACTIVE',
          },
        });
        addedProducts.push(product.id);
        const variant = await testPrisma.productVariant.create({
          data: {
            productId: product.id,
            sku: name,
            combinationKey: 'default',
            taxCategoryId: tax.id,
          },
        });
        await createInventoryFixture({
          data: { variantId: variant.id, quantity: 10 },
        });
        await testPrisma.cartItem.create({
          data: { cartId, variantId: variant.id, quantity: 1 },
        });
        const { estimate } = await compareCheckout();
        expect(estimate.items).toHaveLength(2);
        expect(
          estimate.items
            .reduce(
              (sum, line) => sum.plus(line.couponDiscount),
              new Prisma.Decimal(0),
            )
            .equals(estimate.couponDiscount),
        ).toBe(true);
        expect(
          estimate.taxBreakdown.find((i) => i.variantId === variant.id)!
            .taxTreatment,
        ).toBe(treatment);
      },
    );
    it.each(['999.99', '1000.00', '1000.01'])(
      'preserves the shipping minimum boundary for %s merchandise',
      async (price) => {
        await testPrisma.product.update({
          where: { id: productId },
          data: { basePrice: price },
        });
        await testPrisma.cartItem.updateMany({
          where: { cartId },
          data: { quantity: 1 },
        });
        const noCoupon = { ...input() };
        delete noCoupon.couponCode;
        const before = await databaseState();
        const estimate = await service.preview(noCoupon, context());
        expect(await databaseState()).toEqual(before);
        const checkout = await service.checkout(
          { ...noCoupon, paymentMethod: PaymentMethod.CARD },
          { ...context(), idempotencyKey: key },
        );
        expect(estimate.shippingAmount).toBe(checkout.order.shippingAmount);
        expect(estimate.shippingAmount).toBe(price === '999.99' ? '3' : '1');
      },
    );
    it('returns tenant currency and rejects client-authoritative money/location fields at HTTP validation', async () => {
      const before = await databaseState();
      const response = await httpPreview({
        ...input(),
        currency: 'USD',
        totalAmount: '0.01',
        shippingAmount: '0',
        distanceKm: 0,
        tenantId: crypto.randomUUID(),
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        code: 'VALIDATION_ERROR',
        data: null,
      });
      expect(await databaseState()).toEqual(before);
    });
    it('uses the standard success envelope without a payment method or idempotency key', async () => {
      const before = await databaseState();
      const response = await httpPreview();
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        message: null,
        data: { estimated: true, currency: 'EGP', totalAmount: '42.9' },
      });
      expect(await databaseState()).toEqual(before);
    });
    it('does not call any provider boundary', async () => {
      const spy = vi.spyOn(CashOnDeliveryProvider.prototype, 'createPayment');
      try {
        await preview();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
    it('rejects an invalid address without writes', async () => {
      await reject('SHIPPING_ADDRESS_NOT_FOUND', {
        shippingAddressId: crypto.randomUUID(),
      });
    });
    it('rejects another customer address, including one presented under a foreign tenant context', async () => {
      const other = await foreignAddress();
      await reject('SHIPPING_ADDRESS_NOT_FOUND', {
        shippingAddressId: other.id,
      });
    });
    it('rejects another customer billing address', async () => {
      const other = await foreignAddress();
      await reject('BILLING_ADDRESS_NOT_FOUND', {
        billingSameAsShipping: false,
        billingAddressId: other.id,
      });
    });
    it('rejects an empty cart without creating an order or idempotency claim', async () => {
      await testPrisma.cartItem.deleteMany({ where: { cartId } });
      await reject('CART_EMPTY');
    });
    it.each(['product', 'variant'])(
      'rejects unavailable %s data without writes',
      async (kind) => {
        if (kind === 'product')
          await testPrisma.product.update({
            where: { id: productId },
            data: { status: 'DRAFT' },
          });
        else
          await testPrisma.productVariant.update({
            where: { id: variantId },
            data: { isActive: false },
          });
        await reject(
          kind === 'product'
            ? 'PRODUCT_NOT_AVAILABLE'
            : 'VARIANT_NOT_AVAILABLE',
        );
      },
    );
    it('rejects unavailable inventory without reserving stock', async () => {
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { reservedQuantity: 9 },
      });
      await reject('INSUFFICIENT_STOCK');
    });
    it('rejects exhausted coupons without consuming them', async () => {
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { usageLimit: 0 },
      });
      await reject('COUPON_USAGE_LIMIT_REACHED');
    });
    it.each(['inactive', 'expired', 'future', 'minimum'])(
      'validates %s coupon eligibility without writes',
      async (kind) => {
        if (kind === 'inactive')
          await testPrisma.coupon.update({
            where: { id: couponId },
            data: { isActive: false },
          });
        if (kind === 'expired')
          await testPrisma.coupon.update({
            where: { id: couponId },
            data: { endsAt: new Date(Date.now() - 86400000) },
          });
        if (kind === 'future')
          await testPrisma.coupon.update({
            where: { id: couponId },
            data: { startsAt: new Date(Date.now() + 86400000) },
          });
        if (kind === 'minimum')
          await testPrisma.coupon.update({
            where: { id: couponId },
            data: { minimumOrderAmount: '1000' },
          });
        await reject(
          {
            inactive: 'COUPON_INACTIVE',
            expired: 'COUPON_EXPIRED',
            future: 'COUPON_NOT_STARTED',
            minimum: 'COUPON_MINIMUM_ORDER_NOT_MET',
          }[kind]!,
        );
      },
    );
    it('checks per-user coupon usage without changing an existing order/payment state', async () => {
      await service.checkout(
        { ...input(), paymentMethod: PaymentMethod.CARD },
        { ...context(), idempotencyKey: key },
      );
      await testPrisma.cartItem.create({
        data: { cartId, variantId, quantity: 1 },
      });
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { perUserLimit: 1 },
      });
      await reject('COUPON_USER_USAGE_LIMIT_REACHED');
    });
    it('uses the existing percentage coupon maximum discount', async () => {
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: {
          discountType: 'PERCENTAGE',
          discountValue: '50',
          maximumDiscountAmount: '3',
        },
      });
      const { estimate } = await compareCheckout();
      expect(estimate.couponDiscount).toBe('3');
    });
    it('rejects invalid shipping methods without writes', async () => {
      await reject('SHIPPING_METHOD_NOT_AVAILABLE', {
        shippingMethodCode: 'missing',
      });
    });
    it('rejects unsupported shipping distance without writes', async () => {
      await testPrisma.address.update({
        where: { id: addressId },
        data: { latitude: '0', longitude: '0' },
      });
      await reject('SHIPPING_NOT_AVAILABLE');
    });
    it('rejects missing delivery coordinates without writes', async () => {
      await testPrisma.address.update({
        where: { id: addressId },
        data: { latitude: null, longitude: null },
      });
      await reject('DELIVERY_COORDINATES_REQUIRED');
    });
    it('rejects invalid tax configuration without writes', async () => {
      await testPrisma.taxProfile.update({
        where: { id: taxProfileId },
        data: { isActive: false },
      });
      await reject('TAX_PROFILE_NOT_CONFIGURED');
    });
    it('reflects fresh product prices on every preview', async () => {
      const first = await preview();
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '50' },
      });
      const second = await preview();
      expect(second.subtotal).toBe('100');
      expect(second.totalAmount).not.toBe(first.totalAmount);
    });
    it('reflects fresh tax rules on every preview', async () => {
      const first = await preview();
      await testPrisma.taxRule.update({
        where: { id: savedRules[0]!.id },
        data: { rate: '20' },
      });
      const second = await preview();
      expect(second.taxAmount).toBe('7.6');
      expect(second.taxAmount).not.toBe(first.taxAmount);
    });
    it('reflects fresh shipping configuration on every preview', async () => {
      await preview();
      await testPrisma.shippingRule.updateMany({
        where: { method: { zone: { profileId: shippingProfileId } } },
        data: { flatRate: '9' },
      });
      const second = await preview();
      expect(second.shippingAmount).toBe('9');
    });
    it('revalidates stock after a prior successful preview', async () => {
      await preview();
      await testPrisma.inventory.update({
        where: { id: inventoryId },
        data: { reservedQuantity: 10 },
      });
      await reject('INSUFFICIENT_STOCK');
    });
    it('does not consume a supplied idempotency key or replay an old checkout', async () => {
      const before = await databaseState();
      const estimate = await httpPreview(input(), key);
      expect(estimate.status).toBe(200);
      expect(await databaseState()).toEqual(before);
      const checkout = await service.checkout(
        { ...input(), paymentMethod: PaymentMethod.CARD },
        { ...context(), idempotencyKey: key },
      );
      expect(checkout.idempotent).toBe(false);
      expect(
        await testPrisma.checkoutRequest.count({
          where: { tenantId, userId, idempotencyKey: key },
        }),
      ).toBe(1);
      const empty = await httpPreview(input(), key);
      expect(empty.status).toBe(400);
      expect(empty.body.code).toBe('CART_EMPTY');
      await testPrisma.cartItem.create({
        data: { cartId, variantId, quantity: 1 },
      });
      await testPrisma.product.update({
        where: { id: productId },
        data: { basePrice: '50' },
      });
      const after = await databaseState();
      const fresh = await httpPreview(input(), key);
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.subtotal).toBe('50');
      expect(await databaseState()).toEqual(after);
    });
    it('does not block behind a coupon write lock or acquire its own coupon lock', async () => {
      const blocker = new pg.Client({
        connectionString: env.TEST_DATABASE_URL,
      });
      await blocker.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM "Coupon" WHERE id=$1 FOR UPDATE', [
          couponId,
        ]);
        expect((await preview()).couponDiscount).toBe('2');
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
      }
    });
    it('does not reserve against uncommitted stock changes, and checkout revalidates after commit', async () => {
      const blocker = new pg.Client({
        connectionString: env.TEST_DATABASE_URL,
      });
      await blocker.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'UPDATE "Inventory" SET "reservedQuantity"="quantity" WHERE id=$1',
          [inventoryId],
        );
        await preview();
        await blocker.query('COMMIT');
      } finally {
        await blocker.end();
      }
      await reject('INSUFFICIENT_STOCK');
      const before = await databaseState();
      await expect(
        service.checkout(
          { ...input(), paymentMethod: PaymentMethod.CARD },
          { ...context(), idempotencyKey: key },
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      expect(await databaseState()).toEqual(before);
    });
    it('does not consume a coupon that may be exhausted before the actual checkout', async () => {
      await preview();
      await testPrisma.coupon.update({
        where: { id: couponId },
        data: { usageCount: 100 },
      });
      const before = await databaseState();
      await expect(
        service.checkout(
          { ...input(), paymentMethod: PaymentMethod.CARD },
          { ...context(), idempotencyKey: key },
        ),
      ).rejects.toMatchObject({ code: 'COUPON_USAGE_LIMIT_REACHED' });
      expect(await databaseState()).toEqual(before);
    });
    it('reads one consistent snapshot even when catalog, tax and shipping change mid-preview', async () => {
      const original = await preview();
      const blocker = new pg.Client({
        connectionString: env.TEST_DATABASE_URL,
      });
      await blocker.connect();
      let pending: ReturnType<typeof service.preview> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'LOCK TABLE "ShippingProfile" IN ACCESS EXCLUSIVE MODE',
        );
        pending = service.preview(input(), context());
        void pending.catch(() => {});
        const deadline = Date.now() + 3500;
        let blocked = false;
        while (Date.now() < deadline) {
          const rows = await testPrisma.$queryRaw<
            Array<{ blocked: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ShippingProfile%') AS blocked`;
          if (rows[0]!.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await blocker.query(
          'UPDATE "Product" SET "basePrice"=100 WHERE id=$1',
          [productId],
        );
        await blocker.query(
          'UPDATE "TaxRule" SET rate=20 WHERE "taxCategoryId"=$1',
          [taxCategoryId],
        );
        await blocker.query(
          'UPDATE "ShippingRule" SET "flatRate"=9 WHERE "methodId" IN (SELECT m.id FROM "ShippingMethod" m JOIN "ShippingZone" z ON z.id=m."zoneId" WHERE z."profileId"=$1)',
          [shippingProfileId],
        );
        await blocker.query('COMMIT');
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
      }
      expect(await pending!).toEqual(original);
      const fresh = await preview();
      expect(fresh.subtotal).toBe('200');
      expect(fresh.shippingAmount).toBe('9');
      expect(fresh.taxAmount).toBe('39.6');
    });
    it('isolates another tenant cart, currency, shipping and tax while sharing the same authenticated owner', async () => {
      const other = await foreignTenant();
      const before = await databaseState(other.tenant.id, userId);
      const result = await service.preview(
        {
          shippingAddressId: addressId,
          billingSameAsShipping: true,
          shippingMethodCode: other.method.code,
        },
        { tenantId: other.tenant.id, userId },
      );
      expect(result).toMatchObject({
        currency: 'USD',
        subtotal: '50',
        shippingAmount: '4',
        taxAmount: '5',
        totalAmount: '59',
      });
      expect(result.items[0]!.variantId).toBe(other.variant.id);
      expect(await databaseState(other.tenant.id, userId)).toEqual(before);
      expect((await preview()).currency).toBe('EGP');
    });
    it('rejects a foreign coupon and a foreign product inserted into the current tenant cart', async () => {
      const other = await foreignTenant();
      const coupon = await testPrisma.coupon.create({
        data: {
          tenantId: other.tenant.id,
          code: 'FOREIGN-PREVIEW',
          discountType: 'FIXED_AMOUNT',
          discountValue: '10',
        },
      });
      await reject('COUPON_NOT_FOUND', { couponCode: coupon.code });
      await testPrisma.cartItem.create({
        data: { cartId, variantId: other.variant.id, quantity: 1 },
      });
      await reject('CART_TENANT_MISMATCH');
    });
    it('never selects another user cart, and rejects a client cart selector', async () => {
      const other = await foreignAddress();
      const before = await databaseState();
      await expect(
        ensureFixtureMembership(tenantId, other.userId).then(() =>
          service.preview(input(), { tenantId, userId: other.userId }),
        ),
      ).rejects.toMatchObject({ code: 'CART_EMPTY' });
      const response = await httpPreview(
        { ...input(), cartId },
        undefined,
        other.userId,
      );
      expect(response.status).toBe(400);
      expect(await databaseState()).toEqual(before);
    });
    it('requires authentication and resolved tenant context', async () => {
      const before = await databaseState();
      const noAuth = await request(app())
        .post('/checkout/preview')
        .set('X-Tenant-Slug', fixture)
        .send(input());
      expect(noAuth.status).toBe(401);
      const token = await createAccessToken(userId);
      const noTenant = await request(app())
        .post('/checkout/preview')
        .set('Authorization', `Bearer ${token}`)
        .send(input());
      expect(noTenant.status).toBe(401);
      expect(await databaseState()).toEqual(before);
    });
    it('retains actual checkout snapshots after an informational preview', async () => {
      const { estimate, checkout } = await compareCheckout();
      const detail = await new OrderService().getMyOrder(
        tenantId,
        userId,
        checkout.order.id,
      );
      expect(detail.shippingAddress).toMatchObject({ countryCode });
      expect(detail.couponSnapshot).toMatchObject({
        discountAmount: new Prisma.Decimal(estimate.couponDiscount).toFixed(2),
      });
      expect(detail.taxProfileSnapshot).toMatchObject({
        currency: 'EGP',
        roundingPolicy: 'HALF_UP_PER_LINE',
      });
      expect(detail.items[0]!.taxAmount).toBe(
        estimate.taxBreakdown[0]!.taxAmount,
      );
    });
  });
});
