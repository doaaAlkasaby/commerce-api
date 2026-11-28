import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { testPrisma } from '../../src/config/test-database.js';
import { evaluateCommercePromotions } from '../../src/modules/promotions/promotion-commerce.service.js';
import { PromotionRepository } from '../../src/modules/promotions/promotion.repository.js';
import { PromotionService } from '../../src/modules/promotions/promotion.service.js';

const suite =
  process.env.RUN_TENANT_INTEGRATION === '1' ? describe : describe.skip;

suite('promotion commerce advisory cart', () => {
  const service = new PromotionService(new PromotionRepository(testPrisma));
  let store: Awaited<ReturnType<typeof fixture>>;
  let foreign: Awaited<ReturnType<typeof fixture>>;
  let localPromotion: string;
  let foreignPromotion: string;
  let spendPromotion: string;

  async function fixture() {
    const name = randomUUID();
    const tenant = await testPrisma.tenant.create({
      data: { name, slug: name, code: name, defaultCurrency: 'KWD' },
    });
    const user = await testPrisma.user.create({
      data: {
        email: `${name}@example.test`,
        passwordHash: 'test',
        firstName: 'Test',
        lastName: 'User',
        emailVerifiedAt: new Date(),
      },
    });
    await testPrisma.tenantMember.create({
      data: { tenantId: tenant.id, userId: user.id },
    });
    const category = await testPrisma.category.create({
      data: { tenantId: tenant.id, name, slug: name },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        name,
        slug: name,
        status: 'ACTIVE',
        basePrice: '1.001',
      },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: name,
        combinationKey: 'default',
        isDefault: true,
      },
    });
    const cart = await testPrisma.cart.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        items: { create: { variantId: variant.id, quantity: 1 } },
      },
      include: { items: true },
    });
    return {
      tenant,
      user,
      product,
      variant,
      cart,
      token: await createAccessToken(user.id),
    };
  }

  async function publish(f: typeof store, spend = false) {
    const record = await service.createPromotion(f.tenant.id, {
      titleAr: 'عرض',
      titleEn: 'Offer',
      selectors: spend
        ? []
        : [
            {
              kind: 'VARIANT',
              key: 'sku',
              productId: f.product.id,
              variantId: f.variant.id,
            },
          ],
      ...(spend ? {} : { globalLimit: 2, perCustomerLimit: 1 }),
      configuration: {
        version: 1,
        template: spend ? 'SPEND_GET' : 'BUNDLE',
        condition: spend
          ? { kind: 'SPEND', minimum: '1.200' }
          : { kind: 'ALL_REQUIRED', items: [{ selector: 'sku', quantity: 1 }] },
        reward: { kind: 'FIXED_AMOUNT', amount: '0.001' },
      },
    });
    await service.changePromotionPublication(f.tenant.id, record.id, 'PUBLISH');
    return record.id;
  }

  beforeAll(async () => {
    const [database] = await testPrisma.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (!/^commerce_api_test_phase1b_[a-f0-9]{32}$/.test(database?.name ?? ''))
      throw new Error('Disposable database required');
    store = await fixture();
    foreign = await fixture();
    localPromotion = await publish(store);
    foreignPromotion = await publish(foreign);
    spendPromotion = await publish(store, true);
  });

  afterEach(() => vi.unstubAllEnvs());

  function getCart(f: typeof store, token = f.token) {
    return request(app)
      .get('/api/v1/cart')
      .set('X-Tenant-Slug', f.tenant.slug)
      .set('Authorization', `Bearer ${token}`);
  }

  it('preserves the ordinary cart shape by default', async () => {
    vi.stubEnv('PROMOTION_CART_GUIDANCE_TENANT_IDS', '');
    const response = await getCart(store).expect(200);
    expect(response.body.data).toMatchObject({
      subtotal: '1.001',
      itemCount: 1,
    });
    expect(response.body.data).not.toHaveProperty('promotionGuidance');
  });

  it('returns bounded advisory savings without changing financial or paid line identity', async () => {
    vi.stubEnv('PROMOTION_CART_GUIDANCE_TENANT_IDS', store.tenant.id);
    const response = await getCart(store).expect(200);
    expect(response.body.data).toMatchObject({
      subtotal: '1.001',
      itemCount: 1,
      items: [{ id: store.cart.items[0]!.id, quantity: 1 }],
      promotionGuidance: {
        status: 'ADVISORY',
        currency: 'KWD',
        potentialMerchandiseSavings: '0.001',
        offers: [{ promotionId: localPromotion, applications: 1 }],
        recommendations: [],
      },
    });
    expect(response.text).not.toContain(foreignPromotion);
    expect(response.text).not.toContain(spendPromotion);
    expect((await getCart(foreign).expect(200)).body.data).not.toHaveProperty(
      'promotionGuidance',
    );
    const unauthorized = await getCart(store, foreign.token).expect(401);
    expect(unauthorized.body).not.toHaveProperty('data.promotionGuidance');
  });

  it('uses supplied authoritative gross and blocks promotion savings for a validated coupon', async () => {
    const facts = {
      tenantId: store.tenant.id,
      userId: store.user.id,
      currency: 'KWD',
      now: new Date(),
      hasAuthoritativeMerchandiseGross: true,
      lines: [
        {
          id: store.cart.items[0]!.id,
          productId: store.product.id,
          variantId: store.variant.id,
          categoryId: store.product.categoryId,
          brandId: null,
          quantity: 1,
          saleUnitMinor: 1001n,
          saleMerchandiseGrossMinor: 1200n,
        },
      ],
    };
    const result = await evaluateCommercePromotions(testPrisma, {
      ...facts,
      coupon: 'VALID',
    });
    expect(result).toMatchObject({
      evaluation: {
        applied: [],
        rejected: [
          { reason: 'COUPON_PRECEDENCE' },
          { reason: 'COUPON_PRECEDENCE' },
        ],
      },
    });
    expect(
      await evaluateCommercePromotions(testPrisma, {
        ...facts,
        coupon: 'NONE',
      }),
    ).toMatchObject({
      evaluation: {
        applied: [{ applications: 1 }],
        confirmedMerchandiseSavingsMinor: 1n,
      },
    });
  });

  it('re-evaluates the cart after removing the qualifying item', async () => {
    vi.stubEnv('PROMOTION_CART_GUIDANCE_TENANT_IDS', store.tenant.id);
    const response = await request(app)
      .delete(`/api/v1/cart/items/${store.variant.id}`)
      .set('X-Tenant-Slug', store.tenant.slug)
      .set('Authorization', `Bearer ${store.token}`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      items: [],
      itemCount: 0,
      subtotal: '0.000',
      promotionGuidance: {
        potentialMerchandiseSavings: '0.000',
        offers: [],
        recommendations: [
          { promotionId: localPromotion, reason: 'MISSING_PRODUCTS' },
        ],
      },
    });
    expect(
      await testPrisma.promotionRedemption.count({
        where: { tenantId: store.tenant.id },
      }),
    ).toBe(0);
  });
  it('bounds integrated cart guidance and declines to rank an incomplete definition set', async () => {
    vi.stubEnv('PROMOTION_CART_GUIDANCE_TENANT_IDS', foreign.tenant.id);
    async function addShippingOffers(count: number) {
      await testPrisma.promotion.createMany({
        data: Array.from({ length: count }, () => ({
          tenantId: foreign.tenant.id,
          titleAr: 'شحن مجاني',
          titleEn: 'Free shipping',
          publication: 'PUBLISHED',
          publishedAt: new Date(),
          currency: 'KWD',
          template: 'FREE_SHIPPING',
          configuration: {
            version: 1,
            template: 'FREE_SHIPPING',
            reward: { kind: 'FREE_SHIPPING' },
          },
        })),
      });
    }
    await addShippingOffers(20);
    for (let sample = 0; sample < 5; sample++) {
      const response = await getCart(foreign).expect(200);
      expect(response.body.data.promotionGuidance.recommendations).toHaveLength(
        15,
      );
      expect(response.body.data.promotionGuidance.recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'SHIPPING_UNKNOWN' }),
        ]),
      );
    }
    await addShippingOffers(30);
    const response = await getCart(foreign).expect(200);
    expect(response.body.data).toMatchObject({
      subtotal: '1.001',
      promotionGuidance: { status: 'CAPACITY_EXCEEDED' },
    });
  });
});
