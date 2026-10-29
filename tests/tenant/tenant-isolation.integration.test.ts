import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { testPrisma } from '../../src/config/test-database.js';
import { ProductRepository } from '../../src/modules/products/product.repository.js';
import { ProductVariantRepository } from '../../src/modules/product-variants/product-variant.repository.js';
import { ProductVariantImageRepository } from '../../src/modules/product-variant-images/product-variant-image.repository.js';
import { ProductAttributeRepository } from '../../src/modules/product-attributes/product-attribute.repository.js';
import { createProductImageRepository } from '../../src/modules/product-images/product-image.repository.js';
import { ProductReviewRepository } from '../../src/modules/product-reviews/product-review.repository.js';
import { CartRepository } from '../../src/modules/cart/cart.repository.js';
import { CouponRepository } from '../../src/modules/coupons/coupon.repository.js';
import { TaxRepository } from '../../src/common/tax/tax.repository.js';
import { ShippingRepository } from '../../src/common/shipping/shipping.repository.js';
import { PaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';
import { BannerRepository } from '../../src/modules/banners/banner.repository.js';
import { AppSettingRepository } from '../../src/modules/app-settings/app-setting.repository.js';
import { TenantRepository } from '../../src/modules/tenants/tenant.repository.js';
import { requireTenantRoles } from '../../src/middleware/tenant-role.middleware.js';
import { tenantMemberMiddleware } from '../../src/middleware/tenant-member.middleware.js';
import { OrderRepository } from '../../src/modules/orders/order.repository.js';

const enabled = process.env.RUN_TENANT_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
const fixture = `tenant-it-${crypto.randomUUID()}`;

suite('tenant isolation against PostgreSQL', () => {
  const products = new ProductRepository(testPrisma);
  const variants = new ProductVariantRepository(testPrisma);
  const variantImages = new ProductVariantImageRepository(testPrisma);
  const attributes = new ProductAttributeRepository(testPrisma);
  const productImages = createProductImageRepository(testPrisma);
  const reviews = new ProductReviewRepository(testPrisma);
  const carts = new CartRepository(testPrisma);
  const coupons = new CouponRepository(testPrisma);
  const tax = new TaxRepository();
  const shipping = new ShippingRepository();
  const payments = new PaymentRepository();
  const inventory = new InventoryRepository(testPrisma);
  const banners = new BannerRepository(testPrisma);
  const settings = new AppSettingRepository(testPrisma);
  const memberships = new TenantRepository(testPrisma);
  const orders = new OrderRepository(testPrisma);

  let tenantA: string;
  let tenantB: string;
  let userId: string;
  let productA: string;
  let productB: string;
  let variantB: string;
  let attributeB: string;
  let valueB: string;
  let variantImageB: string;
  let productImageB: string;
  let reviewB: string;
  let couponB: string;
  let variantA: string;
  let inventoryA: string;
  let inventoryB: string;
  let taxCategoryB: string;
  let profileA: string;
  let profileB: string;
  let paymentA: string;
  let paymentB: string;
  let orderA: string;
  let orderB: string;
  let bannerB: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;
  let userDId: string;
  let userEId: string;
  let countryCode: string;
  let bannerA: string;

  beforeAll(async () => {
    const user = await testPrisma.user.create({
      data: {
        email: `${fixture}@example.test`,
        passwordHash: 'integration-test',
        firstName: 'Tenant',
        lastName: 'Tester',
      },
    });
    userId = user.id;
    const a = await testPrisma.tenant.create({
      data: { name: 'Tenant A', slug: `${fixture}-a`, code: `${fixture}-a`, defaultCurrency: 'EGP' },
    });
    const b = await testPrisma.tenant.create({
      data: { name: 'Tenant B', slug: `${fixture}-b`, code: `${fixture}-b`, defaultCurrency: 'USD' },
    });
    tenantA = a.id;
    tenantB = b.id;

    const [userA, userB, userC, userD, userE] = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((label) =>
        testPrisma.user.create({
          data: {
            email: `${fixture}-${label}@example.test`,
            passwordHash: 'integration-test',
            firstName: label,
            lastName: 'Member',
          },
        }),
      ),
    );
    userAId = userA.id;
    userBId = userB.id;
    userCId = userC.id;
    userDId = userD.id;
    userEId = userE.id;
    await Promise.all([
      testPrisma.tenantMember.create({
        data: { tenantId: tenantA, userId: userAId, role: 'OWNER' },
      }),
      testPrisma.tenantMember.create({
        data: { tenantId: tenantA, userId: userCId, role: 'MANAGER' },
      }),
      testPrisma.tenantMember.create({
        data: { tenantId: tenantA, userId: userEId, role: 'ADMIN' },
      }),
      testPrisma.tenantMember.create({
        data: { tenantId: tenantB, userId: userBId, role: 'OWNER' },
      }),
    ]);
    await testPrisma.tenantMember.create({
      data: { tenantId: tenantA, userId, role: 'CUSTOMER' },
    });

    countryCode = `I${fixture.slice(-7).replaceAll('-', '').toUpperCase()}`;
    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: 'Integration Country',
        currencyCode: 'USD',
      },
    });

    const categoryA = await testPrisma.category.create({
      data: { tenantId: tenantA, name: 'Category A', slug: 'shared-category' },
    });
    const categoryB = await testPrisma.category.create({
      data: { tenantId: tenantB, name: 'Category B', slug: 'shared-category' },
    });
    const [aProduct, bProduct] = await Promise.all([
      testPrisma.product.create({
        data: {
          tenantId: tenantA,
          categoryId: categoryA.id,
          name: 'Product A',
          slug: 'shared-product',
          basePrice: 10,
          status: 'ACTIVE',
        },
      }),
      testPrisma.product.create({
        data: {
          tenantId: tenantB,
          categoryId: categoryB.id,
          name: 'Product B',
          slug: 'shared-product',
          basePrice: 20,
          status: 'ACTIVE',
        },
      }),
    ]);
    productA = aProduct.id;
    productB = bProduct.id;
    const variantForA = await testPrisma.productVariant.create({
      data: {
        productId: productA,
        sku: `${fixture}-sku-a`,
        combinationKey: 'default-a',
        isActive: true,
      },
    });
    variantA = variantForA.id;
    const attribute = await testPrisma.productAttribute.create({
      data: { productId: productB, name: 'Color' },
    });
    attributeB = attribute.id;
    const value = await testPrisma.productAttributeValue.create({
      data: { attributeId: attributeB, value: 'Blue' },
    });
    valueB = value.id;
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: productB,
        sku: `${fixture}-sku-b`,
        combinationKey: 'blue',
        isActive: true,
      },
    });
    variantB = variant.id;
    const variantImage = await testPrisma.productVariantImage.create({
      data: {
        variantId: variantB,
        storageKey: `${fixture}/variant.png`,
        url: 'https://example.test/variant.png',
      },
    });
    variantImageB = variantImage.id;
    const productImage = await testPrisma.productImage.create({
      data: {
        productId: productB,
        storageKey: `${fixture}/product.png`,
        url: 'https://example.test/product.png',
      },
    });
    productImageB = productImage.id;
    const review = await testPrisma.productReview.create({
      data: {
        productId: productB,
        userId,
        rating: 5,
        title: 'Review',
        comment: 'Test fixture',
      },
    });
    reviewB = review.id;
    const coupon = await testPrisma.coupon.create({
      data: {
        tenantId: tenantB,
        code: 'SHARED-CODE',
        discountType: 'PERCENTAGE',
        discountValue: 10,
      },
    });
    couponB = coupon.id;

    const [stockA, stockB] = await Promise.all([
      inventory.create(tenantA, variantA, 11),
      inventory.create(tenantB, variantB, 22),
    ]);
    inventoryA = stockA.id;
    inventoryB = stockB.id;

    const [taxA, taxB] = await Promise.all([
      testPrisma.taxCategory.create({
        data: { tenantId: tenantA, code: 'STANDARD', name: 'A standard' },
      }),
      testPrisma.taxCategory.create({
        data: { tenantId: tenantB, code: 'STANDARD', name: 'B standard' },
      }),
    ]);
    taxCategoryB = taxB.id;
    await Promise.all([
      testPrisma.taxProfile.create({
        data: {
          tenantId: tenantA,
          countryCode,
          currency: 'USD',
          defaultTaxCategoryId: taxA.id,
        },
      }),
      testPrisma.taxProfile.create({
        data: {
          tenantId: tenantB,
          countryCode,
          currency: 'USD',
          defaultTaxCategoryId: taxB.id,
        },
      }),
      testPrisma.taxRule.create({
        data: { taxCategoryId: taxA.id, countryCode, rate: 5 },
      }),
      testPrisma.taxRule.create({
        data: { taxCategoryId: taxB.id, countryCode, rate: 20 },
      }),
    ]);
    const [shippingA, shippingB] = await Promise.all([
      testPrisma.shippingProfile.create({
        data: { tenantId: tenantA, countryCode, currency: 'USD' },
      }),
      testPrisma.shippingProfile.create({
        data: { tenantId: tenantB, countryCode, currency: 'USD' },
      }),
    ]);
    profileA = shippingA.id;
    profileB = shippingB.id;
    for (const [profileId, suffix] of [
      [profileA, 'a'],
      [profileB, 'b'],
    ] as const) {
      const zone = await testPrisma.shippingZone.create({
        data: {
          profileId,
          code: `${fixture}-${suffix}`,
          name: `Zone ${suffix}`,
          countryCode,
        },
      });
      const method = await testPrisma.shippingMethod.create({
        data: {
          zoneId: zone.id,
          code: `standard-${suffix}`,
          name: `Standard ${suffix}`,
        },
      });
      await testPrisma.shippingRule.create({
        data: {
          methodId: method.id,
          flatRate: suffix === 'a' ? 3 : 9,
          minOrderAmount: suffix === 'a' ? 1000 : 500,
        },
      });
    }

    const orderData = (tenantId: string, orderNumber: string) => ({
      tenantId,
      orderNumber,
      userId,
      subtotal: 10,
      discountAmount: 0,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: 10,
      shippingAddress: { countryCode },
      billingAddress: { countryCode },
      status: 'DELIVERED' as const,
    });
    const [orderForA, orderForB] = await Promise.all([
      testPrisma.order.create({
        data: orderData(tenantA, `${fixture}-order-a`),
      }),
      testPrisma.order.create({
        data: orderData(tenantB, `${fixture}-order-b`),
      }),
    ]);
    orderA = orderForA.id;
    orderB = orderForB.id;
    const [paymentForA, paymentForB] = await Promise.all([
      testPrisma.payment.create({
        data: {
          orderId: orderA,
          provider: 'NONE',
          method: 'CASH_ON_DELIVERY',
          amount: 10,
          currency: 'USD',
        },
      }),
      testPrisma.payment.create({
        data: {
          orderId: orderB,
          provider: 'NONE',
          method: 'CASH_ON_DELIVERY',
          amount: 10,
          currency: 'USD',
        },
      }),
    ]);
    paymentA = paymentForA.id;
    paymentB = paymentForB.id;
    for (const [orderId, productId, variantId, sku] of [
      [orderA, productA, variantA, `${fixture}-sku-a`],
      [orderB, productB, variantB, `${fixture}-sku-b`],
    ] as const) {
      await testPrisma.orderItem.create({
        data: {
          orderId,
          productId,
          variantId,
          productName: sku,
          sku,
          quantity: 1,
          unitPrice: 10,
          itemDiscountAmount: 0,
          finalUnitPrice: 10,
          totalPrice: 10,
          taxableAmount: 10,
          taxAmount: 0,
          variantSnapshot: {},
        },
      });
    }

    const [banner, ownBanner] = await Promise.all([
      testPrisma.banner.create({
        data: {
          tenantId: tenantB,
          imageStorageKey: `${fixture}/banner.png`,
          imageUrl: 'https://example.test/banner.png',
        },
      }),
      testPrisma.banner.create({
        data: {
          tenantId: tenantA,
          imageStorageKey: `${fixture}/banner-a.png`,
          imageUrl: 'https://example.test/banner-a.png',
        },
      }),
    ]);
    bannerB = banner.id;
    bannerA = ownBanner.id;
    await Promise.all([
      settings.create(tenantA, {
        key: 'tenant-label',
        value: 'A',
        isPublic: true,
      }),
      settings.create(tenantB, {
        key: 'tenant-label',
        value: 'B',
        isPublic: true,
      }),
    ]);
  });

  afterAll(async () => {
    if (paymentA || paymentB)
      await testPrisma.payment.deleteMany({
        where: { id: { in: [paymentA, paymentB].filter(Boolean) } },
      });
    if (orderA || orderB)
      await testPrisma.order.deleteMany({
        where: { id: { in: [orderA, orderB].filter(Boolean) } },
      });
    if (tenantA || tenantB) {
      await testPrisma.taxProfile.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB].filter(Boolean) } },
      });
      await testPrisma.taxRule.deleteMany({
        where: {
          taxCategory: { tenantId: { in: [tenantA, tenantB].filter(Boolean) } },
        },
      });
      await testPrisma.product.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB].filter(Boolean) } },
      });
      await testPrisma.category.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB].filter(Boolean) } },
      });
    }
    if (tenantA)
      await testPrisma.tenant.deleteMany({
        where: { id: { in: [tenantA, tenantB] } },
      });
    if (userId || userAId || userBId || userCId || userDId || userEId)
      await testPrisma.user.deleteMany({
        where: {
          id: {
            in: [userId, userAId, userBId, userCId, userDId, userEId].filter(
              Boolean,
            ),
          },
        },
      });
    if (countryCode)
      await testPrisma.country.deleteMany({ where: { code: countryCode } });
  });

  it('isolates product lookup by ID and slug, while listing only the current tenant', async () => {
    expect(await products.findById(productB, tenantA)).toBeNull();
    expect(await products.findBySlug('shared-product', tenantA)).toMatchObject({
      id: productA,
    });
    const result = await products.findList(
      tenantA,
      { page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' },
      0,
      50,
    );
    expect(result.items.every((product) => product.id !== productB)).toBe(true);
    await expect(
      products.update(tenantA, productB, { name: 'Compromised' }),
    ).rejects.toThrow();
    expect((await products.delete(tenantA, productB)).count).toBe(0);
  });

  it('isolates variants, attributes, attribute values, and child images', async () => {
    expect(await variants.findById(tenantA, variantB)).toBeNull();
    expect(await variants.findBySku(tenantA, `${fixture}-sku-b`)).toBeNull();
    expect(await attributes.findById(tenantA, attributeB)).toBeNull();
    expect(await attributes.findValueById(tenantA, valueB)).toBeNull();
    expect(
      await attributes.createValue(tenantA, {
        attributeId: attributeB,
        value: 'Red',
        sortOrder: 0,
      }),
    ).toBeNull();
    await expect(
      variants.create({
        tenantId: tenantA,
        productId: productA,
        sku: `${fixture}-bad`,
        isActive: true,
        combinationKey: 'foreign',
        attributeValueIds: [valueB],
      }),
    ).rejects.toThrow();
    expect(await variantImages.findById(tenantA, variantImageB)).toBeNull();
    expect(
      await variantImages.update(tenantA, variantImageB, {
        altText: 'changed',
      }),
    ).toBeNull();
    expect(await variantImages.setPrimary(tenantA, variantImageB)).toBeNull();
    expect(await variantImages.delete(tenantA, variantImageB)).toBeNull();
    expect(
      await productImages.update(tenantA, productImageB, {
        altText: 'changed',
      }),
    ).toBeNull();
    expect(
      await productImages.setPrimary(tenantA, productImageB, productA),
    ).toBeNull();
    expect((await productImages.delete(tenantA, productImageB)).count).toBe(0);
  });

  it('isolates reviews, carts and coupons and permits tenant-local coupon codes', async () => {
    expect(await reviews.findById(tenantA, reviewB)).toBeNull();
    await expect(
      reviews.update(tenantA, reviewB, { title: 'changed' }),
    ).rejects.toThrow();
    await expect(reviews.delete(tenantA, reviewB)).rejects.toThrow();
    const cartA = await carts.getOrCreateCart(tenantA, userId);
    const cartB = await carts.getOrCreateCart(tenantB, userId);
    expect(cartA.id).not.toBe(cartB.id);
    await expect(carts.addItem(tenantA, userId, variantB, 1)).rejects.toThrow();
    expect(await coupons.findById(tenantA, couponB)).toBeNull();
    expect(await coupons.findByCode(tenantA, 'SHARED-CODE')).toBeNull();
    await expect(
      coupons.update(tenantA, couponB, { code: 'CHANGED' }),
    ).rejects.toThrow();
    expect((await coupons.delete(tenantA, couponB)).count).toBe(0);
    const couponA = await testPrisma.coupon.create({
      data: {
        tenantId: tenantA,
        code: 'SHARED-CODE',
        discountType: 'PERCENTAGE',
        discountValue: 5,
      },
    });
    expect(couponA.code).toBe('SHARED-CODE');
  });

  it('allows tenant-local product/category/collection slugs while retaining global SKU uniqueness', async () => {
    expect(
      await testPrisma.product.findUnique({
        where: { id: productA, tenantId: tenantA },
      }),
    ).toMatchObject({ slug: 'shared-product' });
    expect(
      await testPrisma.product.findUnique({
        where: { id: productB, tenantId: tenantB },
      }),
    ).toMatchObject({ slug: 'shared-product' });
    expect(
      await testPrisma.category.findFirst({
        where: { tenantId: tenantA, slug: 'shared-category' },
      }),
    ).not.toBeNull();
    expect(
      await testPrisma.category.findFirst({
        where: { tenantId: tenantB, slug: 'shared-category' },
      }),
    ).not.toBeNull();
    const [brandA, brandB] = await Promise.all([
      testPrisma.brand.create({
        data: { tenantId: tenantA, name: 'Brand A', slug: 'shared-brand' },
      }),
      testPrisma.brand.create({
        data: { tenantId: tenantB, name: 'Brand B', slug: 'shared-brand' },
      }),
    ]);
    expect(brandA.slug).toBe(brandB.slug);
    await testPrisma.productCollection.create({
      data: {
        tenantId: tenantA,
        name: 'Collection A',
        slug: 'shared-collection',
      },
    });
    await expect(
      testPrisma.productCollection.create({
        data: {
          tenantId: tenantB,
          name: 'Collection B',
          slug: 'shared-collection',
        },
      }),
    ).resolves.toHaveProperty('tenantId', tenantB);
    await expect(
      testPrisma.productVariant.create({
        data: {
          productId: productA,
          sku: `${fixture}-sku-b`,
          combinationKey: 'duplicate-sku',
        },
      }),
    ).rejects.toThrow();
  });

  it('isolates tax profiles and rules by tenant', async () => {
    expect(await tax.findTaxProfile(tenantA, countryCode)).toMatchObject({
      tenantId: tenantA,
    });
    expect(await tax.findTaxProfile(tenantB, countryCode)).toMatchObject({
      tenantId: tenantB,
    });
    expect(
      await tax.findTaxRule(tenantA, {
        taxCategoryId: taxCategoryB,
        countryCode,
      }),
    ).toBeNull();
    const ownCategory = await testPrisma.taxCategory.findFirstOrThrow({
      where: { tenantId: tenantA, code: 'STANDARD' },
    });
    expect(
      await tax.findTaxRule(tenantA, {
        taxCategoryId: ownCategory.id,
        countryCode,
      }),
    ).toMatchObject({ taxCategoryId: ownCategory.id });
  });

  it('resolves only the current tenant shipping profile and nested configuration', async () => {
    const profile = await shipping.findProfile(tenantA, countryCode);
    expect(profile?.id).toBe(profileA);
    expect(profile?.zones).toHaveLength(1);
    expect(profile?.zones[0]?.methods).toHaveLength(1);
    expect(profile?.zones[0]?.methods[0]?.rules).toHaveLength(1);
    expect(profile?.zones[0]?.profileId).toBe(profileA);
    expect(profile?.id).not.toBe(profileB);
    expect(
      profile?.zones[0]?.methods[0]?.rules[0]?.minOrderAmount?.toString(),
    ).toBe('1000');
    const otherTenantProfile = await shipping.findProfile(tenantB, countryCode);
    expect(
      otherTenantProfile?.zones[0]?.methods[0]?.rules[0]?.minOrderAmount?.toString(),
    ).toBe('500');
  });

  it('isolates payments through their owning orders, including transaction-client updates', async () => {
    expect(await payments.findById(tenantA, paymentA)).toMatchObject({
      id: paymentA,
    });
    expect(await payments.findById(tenantA, paymentB)).toBeNull();
    await expect(
      payments.updateStatus(tenantA, paymentB, { status: 'PAID' }),
    ).rejects.toThrow();
    await expect(
      testPrisma.$transaction((tx) =>
        payments.updateStatusWithClient(
          tenantA,
          paymentB,
          { status: 'PAID' },
          tx,
        ),
      ),
    ).rejects.toThrow();
    expect(
      await testPrisma.payment.findUniqueOrThrow({ where: { id: paymentB } }),
    ).toMatchObject({ status: 'PENDING' });
  });

  it('isolates orders by tenant and user', async () => {
    expect(await orders.findById(tenantA, orderA)).toMatchObject({
      id: orderA,
      tenantId: tenantA,
    });
    expect(await orders.findById(tenantA, orderB)).toBeNull();
    expect(await orders.findByIdForUser(tenantA, orderB, userId)).toBeNull();
    expect(
      (await orders.findManyByUserId(tenantA, userId, 1, 20)).orders.map(
        (order) => order.id,
      ),
    ).toContain(orderA);
    expect(
      (await orders.findManyByUserId(tenantA, userId, 1, 20)).orders.map(
        (order) => order.id,
      ),
    ).not.toContain(orderB);
  });

  it('isolates inventory reads, writes, and low-stock raw SQL results', async () => {
    expect(await inventory.findById(tenantA, inventoryA)).toMatchObject({
      id: inventoryA,
    });
    expect(await inventory.findById(tenantA, inventoryB)).toBeNull();
    const scoped = await inventory.findMany(tenantA, { page: 1, limit: 50 });
    expect(scoped.items.map((item) => item.id)).toContain(inventoryA);
    expect(scoped.items.map((item) => item.id)).not.toContain(inventoryB);
    const lowStock = await inventory.findMany(tenantA, {
      page: 1,
      limit: 50,
      lowStock: 100,
    });
    expect(lowStock.items.map((item) => item.id)).toContain(inventoryA);
    expect(lowStock.items.map((item) => item.id)).not.toContain(inventoryB);
    expect(await inventory.stockIn(tenantA, inventoryB, 7)).toBe(0);
    expect(await inventory.stockOut(tenantA, inventoryB, 7)).toBe(0);
    expect(await inventory.adjustment(tenantA, inventoryB, 7)).toBe(0);
    expect(await inventory.reserve(tenantA, inventoryB, 7)).toBe(0);
    expect(await inventory.release(tenantA, inventoryB, 7)).toBe(0);
    expect(await inventory.sale(tenantA, inventoryB, 7)).toBe(0);
    expect(
      await testPrisma.inventory.findUniqueOrThrow({
        where: { id: inventoryB },
      }),
    ).toMatchObject({ quantity: 22 });
  });

  it('scopes the best-seller raw SQL results to the requested tenant', async () => {
    const result = await products.findBestSellers(tenantA, 0, 50);
    expect(result.items.map((product) => product.id)).toContain(productA);
    expect(result.items.map((product) => product.id)).not.toContain(productB);
  });

  it('enforces tenant membership and the existing tenant role matrix', async () => {
    expect(await memberships.findMembership(tenantA, userAId)).toMatchObject({
      role: 'OWNER',
      status: 'ACTIVE',
    });
    expect(await memberships.findMembership(tenantB, userAId)).toBeNull();
    expect(await memberships.findMembership(tenantA, userBId)).toBeNull();
    expect(await memberships.findMembership(tenantA, userEId)).toMatchObject({
      role: 'ADMIN',
    });
    expect(await memberships.findMembership(tenantA, userCId)).toMatchObject({
      role: 'MANAGER',
    });
    expect(await memberships.findMembership(tenantA, userId)).toMatchObject({
      role: 'CUSTOMER',
    });
    expect(await memberships.findMembership(tenantA, userDId)).toBeNull();

    const checkMembership = (userId: string, tenantId: string) =>
      new Promise<unknown>((resolve) => {
        tenantMemberMiddleware(
          { user: { userId }, tenant: { tenantId } } as unknown as Request,
          {} as Response,
          ((error?: unknown) => resolve(error)) as NextFunction,
        );
      });
    expect(await checkMembership(userAId, tenantA)).toBeUndefined();
    expect(await checkMembership(userAId, tenantB)).toBeInstanceOf(Error);
    expect(await checkMembership(userBId, tenantB)).toBeUndefined();
    expect(await checkMembership(userBId, tenantA)).toBeInstanceOf(Error);
    expect(await checkMembership(userDId, tenantA)).toBeInstanceOf(Error);

    const checkRole = (
      role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'CUSTOMER' | undefined,
    ) => {
      let nextError: unknown;
      let proceeded = false;
      const next = ((error?: unknown) => {
        nextError = error;
        proceeded = error === undefined;
      }) as NextFunction;
      requireTenantRoles('OWNER', 'ADMIN', 'MANAGER')(
        {
          tenant: role ? { tenantId: tenantA, memberRole: role } : undefined,
        } as unknown as Request,
        {} as Response,
        next,
      );
      return { nextError, proceeded };
    };
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const)
      expect(checkRole(role).proceeded).toBe(true);
    expect(checkRole('CUSTOMER').proceeded).toBe(false);
    expect(checkRole(undefined).proceeded).toBe(false);
  });

  it('isolates banner and app-setting reads and mutations', async () => {
    expect(await banners.findById(tenantA, bannerA)).toMatchObject({
      id: bannerA,
    });
    expect(await banners.findById(tenantA, bannerB)).toBeNull();
    expect(
      (await banners.findMany(tenantA)).map((banner) => banner.id),
    ).toContain(bannerA);
    expect(
      (await banners.findMany(tenantA)).map((banner) => banner.id),
    ).not.toContain(bannerB);
    await expect(
      banners.update(tenantA, bannerB, { title: 'Cross tenant' }),
    ).rejects.toThrow();
    expect((await banners.delete(tenantA, bannerB)).count).toBe(0);
    expect(await settings.findByKey(tenantA, 'tenant-label')).toMatchObject({
      value: 'A',
    });
    expect(await settings.findByKey(tenantB, 'tenant-label')).toMatchObject({
      value: 'B',
    });
    await settings.update(tenantA, 'tenant-label', { value: 'changed' });
    expect(await settings.findByKey(tenantA, 'tenant-label')).toMatchObject({
      value: 'changed',
    });
    expect(await settings.findByKey(tenantB, 'tenant-label')).toMatchObject({
      value: 'B',
    });
    await settings.delete(tenantA, 'tenant-label');
    expect(await settings.findByKey(tenantA, 'tenant-label')).toBeNull();
    expect(await settings.findByKey(tenantB, 'tenant-label')).toMatchObject({
      value: 'B',
    });
  });
});
