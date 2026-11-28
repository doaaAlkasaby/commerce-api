import { evaluatePromotions } from '../../src/modules/promotions/promotion.evaluator.js';
import { preparePromotionDefinition } from '../../src/modules/promotions/promotion.preparation.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import { PromotionRepository } from '../../src/modules/promotions/promotion.repository.js';
import { PromotionService } from '../../src/modules/promotions/promotion.service.js';

const draft = {
  titleAr: 'عرض',
  titleEn: 'Offer',
  configuration: {
    version: 1,
    template: 'FREE_SHIPPING',
    reward: { kind: 'FREE_SHIPPING' },
  },
};
const prefix = `promotion-${crypto.randomUUID()}`;
const suite =
  process.env.RUN_TENANT_INTEGRATION === '1' ? describe : describe.skip;

suite('promotion foundation against isolated PostgreSQL', () => {
  let now = new Date('2026-11-28T09:00:00Z');
  const service = new PromotionService(
    new PromotionRepository(testPrisma),
    () => now,
  );
  let tenantA: string;
  let tenantB: string;
  let customerA: string;
  let customerB: string;
  let campaignB: string;
  let productA: string;
  let productB: string;
  let variantA: string;
  let variantB: string;
  let categoryB: string;
  let brandB: string;

  beforeAll(async () => {
    const [database] = await testPrisma.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (
      !/^commerce_api_test_phase1b_[a-f0-9]{32}$/.test(database?.name ?? '')
    ) {
      throw new Error(
        'Run promotion integration tests through the disposable PostgreSQL runner',
      );
    }
    async function createFixture(suffix: string) {
      const identity = `${prefix}-${suffix}`;
      const tenant = await testPrisma.tenant.create({
        data: {
          name: identity,
          slug: identity,
          code: identity,
          defaultCurrency: 'KWD',
        },
      });
      const customer = await testPrisma.user.create({
        data: {
          email: `${identity}@example.test`,
          passwordHash: 'test',
          firstName: 'First',
          lastName: 'Last',
        },
      });
      await testPrisma.tenantMember.create({
        data: { tenantId: tenant.id, userId: customer.id },
      });
      const category = await testPrisma.category.create({
        data: { tenantId: tenant.id, name: identity, slug: identity },
      });
      const brand = await testPrisma.brand.create({
        data: { tenantId: tenant.id, name: identity, slug: identity },
      });
      const product = await testPrisma.product.create({
        data: {
          tenantId: tenant.id,
          categoryId: category.id,
          brandId: brand.id,
          name: identity,
          slug: identity,
          basePrice: '1.001',
          status: 'ACTIVE',
        },
      });
      const variant = await testPrisma.productVariant.create({
        data: {
          productId: product.id,
          sku: identity,
          combinationKey: 'default',
          isDefault: true,
        },
      });
      return {
        tenant: tenant.id,
        customer: customer.id,
        category: category.id,
        brand: brand.id,
        product: product.id,
        variant: variant.id,
      };
    }
    ({
      tenant: tenantA,
      customer: customerA,
      product: productA,
      variant: variantA,
    } = await createFixture('a'));
    ({
      tenant: tenantB,
      customer: customerB,
      category: categoryB,
      brand: brandB,
      product: productB,
      variant: variantB,
    } = await createFixture('b'));
    campaignB = (
      await service.createCampaign(tenantB, {
        titleAr: 'حملة',
        titleEn: 'Campaign',
      })
    ).id;
  });

  it('round-trips a three-decimal definition and scopes reads by tenant', async () => {
    const record = await service.createPromotion(tenantA, {
      ...draft,
      configuration: {
        version: 1,
        template: 'SPEND_GET',
        condition: { kind: 'SPEND', minimum: '1.001' },
        reward: { kind: 'FIXED_AMOUNT', amount: '0.001' },
      },
      audience: { kind: 'SELECTED', customerIds: [customerA] },
    });
    expect(record.currency).toBe('KWD');
    expect(record.configuration).toMatchObject({ reward: { amount: '0.001' } });
    await expect(
      service.getPromotion(tenantA, record.id),
    ).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(
      service.getPromotion(tenantB, record.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getCampaign(tenantA, campaignB)).rejects.toMatchObject(
      { statusCode: 404 },
    );
  });

  it('rejects cross-tenant campaign and customer references without leaving partial definitions', async () => {
    const before = await testPrisma.promotion.count({
      where: { tenantId: tenantA },
    });
    await expect(
      service.createPromotion(tenantA, { ...draft, campaignId: campaignB }),
    ).rejects.toMatchObject({ code: 'INVALID_PROMOTION_REFERENCE' });
    await expect(
      service.createPromotion(tenantA, {
        ...draft,
        audience: { kind: 'SELECTED', customerIds: [customerB] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROMOTION_REFERENCE' });
    expect(
      await testPrisma.promotion.count({ where: { tenantId: tenantA } }),
    ).toBe(before);
  });

  it('rejects mismatched variants and foreign tenant catalog selectors at the database boundary', async () => {
    const record = await service.createPromotion(tenantA, draft);
    for (const target of [
      { productId: productB },
      { productId: productA, variantId: variantB },
      { categoryId: categoryB },
      { brandId: brandB },
    ]) {
      await expect(
        testPrisma.promotionSelector.create({
          data: {
            tenantId: tenantA,
            promotionId: record.id,
            key: 'foreign',
            ...target,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    }
    await expect(
      testPrisma.promotionCustomer.create({
        data: { tenantId: tenantA, promotionId: record.id, userId: customerB },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('publishes once under concurrency and locks material terms and target rows', async () => {
    const record = await service.createPromotion(tenantA, {
      ...draft,
      startsAt: '2026-11-28T10:00:00Z',
      endsAt: '2026-11-28T11:00:00Z',
      configuration: {
        ...draft.configuration,
        condition: {
          kind: 'ALL_REQUIRED',
          items: [{ selector: 'sku', quantity: 2 }],
        },
      },
      selectors: [
        {
          kind: 'VARIANT',
          key: 'sku',
          productId: productA,
          variantId: variantA,
        },
      ],
    });
    const outcomes = await Promise.allSettled([
      service.changePromotionPublication(tenantA, record.id, 'PUBLISH'),
      service.changePromotionPublication(tenantA, record.id, 'PUBLISH'),
    ]);
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    await expect(
      service.getPromotion(tenantA, record.id),
    ).resolves.toMatchObject({ status: 'SCHEDULED' });
    await expect(
      testPrisma.promotion.update({
        where: { id: record.id },
        data: { priority: 100 },
      }),
    ).rejects.toThrow();
    await expect(
      testPrisma.promotionSelector.deleteMany({
        where: { promotionId: record.id },
      }),
    ).rejects.toThrow();
    await expect(
      testPrisma.promotion.delete({ where: { id: record.id } }),
    ).rejects.toThrow();
    now = new Date('2026-11-28T10:00:00Z');
    await expect(
      service.getPromotion(tenantA, record.id),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(
      service.changePromotionPublication(tenantA, record.id, 'PAUSE'),
    ).resolves.toMatchObject({ status: 'PAUSED' });
    await expect(
      service.changePromotionPublication(tenantA, record.id, 'RESUME'),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    now = new Date('2026-11-28T11:00:00Z');
    await expect(
      service.getPromotion(tenantA, record.id),
    ).resolves.toMatchObject({ status: 'ENDED' });
    await expect(
      service.changePromotionPublication(tenantA, record.id, 'PAUSE'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('publishes a campaign independently of attached promotion lifecycle', async () => {
    const campaign = await service.createCampaign(tenantA, {
      titleAr: 'حملة',
      titleEn: 'Campaign',
    });
    const record = await service.createPromotion(tenantA, {
      ...draft,
      campaignId: campaign.id,
    });
    await expect(
      service.changeCampaignPublication(tenantA, campaign.id, 'PUBLISH'),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(
      service.getPromotion(tenantA, record.id),
    ).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(
      service.changeCampaignPublication(tenantA, campaign.id, 'END'),
    ).resolves.toMatchObject({ status: 'ENDED' });
    await expect(
      service.changeCampaignPublication(tenantA, campaign.id, 'RESUME'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('enforces redemption order ownership, order-item identity and immutable evidence', async () => {
    const promotion = await service.createPromotion(tenantA, draft);
    const orderData = {
      currency: 'KWD',
      subtotal: '1.001',
      discountAmount: '0',
      shippingAmount: '0',
      taxAmount: '0',
      totalAmount: '1.001',
      shippingAddress: {},
      billingAddress: {},
    };
    const order = await testPrisma.order.create({
      data: {
        ...orderData,
        tenantId: tenantA,
        userId: customerA,
        orderNumber: 'promo-1',
      },
    });
    const foreignOrder = await testPrisma.order.create({
      data: {
        ...orderData,
        tenantId: tenantB,
        userId: customerB,
        orderNumber: 'promo-1',
      },
    });
    const data = {
      tenantId: tenantA,
      promotionId: promotion.id,
      orderId: order.id,
      userId: customerA,
      applications: 1,
      currency: 'KWD',
      merchandiseSavings: '0.001',
      shippingSavings: '0',
      evidence: {},
    };
    await expect(
      testPrisma.promotionRedemption.create({
        data: { ...data, orderId: foreignOrder.id, userId: customerB },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      testPrisma.promotionRedemption.create({
        data: { ...data, userId: customerB },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const row = await testPrisma.promotionRedemption.create({ data });
    expect(row.merchandiseSavings.toString()).toBe('0.001');
    await expect(
      testPrisma.promotionRedemption.create({ data }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const foreignItem = await testPrisma.orderItem.create({
      data: {
        orderId: foreignOrder.id,
        productId: productB,
        variantId: variantB,
        productName: 'Product',
        sku: 'sku',
        quantity: 1,
        unitPrice: '1.001',
        itemDiscountAmount: 0,
        finalUnitPrice: '1.001',
        totalPrice: '1.001',
        taxableAmount: '1.001',
        taxAmount: 0,
        variantSnapshot: {},
      },
    });
    await expect(
      testPrisma.promotionAllocation.create({
        data: {
          tenantId: tenantA,
          promotionId: promotion.id,
          orderId: order.id,
          orderItemId: foreignItem.id,
          discountAmount: '0.001',
          evidence: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const where = {
      tenantId: tenantA,
      promotionId: promotion.id,
      orderId: order.id,
    };
    await expect(
      testPrisma.promotionRedemption.updateMany({
        where,
        data: { applications: 2 },
      }),
    ).rejects.toThrow();
    await expect(
      testPrisma.promotionRedemption.updateMany({
        where,
        data: { releasedAt: new Date(row.createdAt.getTime() + 1) },
      }),
    ).resolves.toEqual({ count: 1 });
    await expect(
      testPrisma.promotionRedemption.updateMany({
        where,
        data: { releasedAt: null },
      }),
    ).rejects.toThrow();
  });
  it('round-trips multi-product reward configuration and evaluates without database writes', async () => {
    const record = await service.createPromotion(tenantA, {
      ...draft,
      configuration: {
        version: 1,
        template: 'BUY_X_GET_Y',
        condition: {
          kind: 'ALL_REQUIRED',
          items: [{ selector: 'sku', quantity: 1 }],
        },
        reward: {
          kind: 'PRODUCT_REWARDS',
          items: [
            {
              selector: 'sku',
              quantity: 1,
              discount: { kind: 'FIXED_AMOUNT', amount: '0.001' },
            },
          ],
        },
      },
      selectors: [
        {
          kind: 'VARIANT',
          key: 'sku',
          productId: productA,
          variantId: variantA,
        },
      ],
    });
    const published = await service.changePromotionPublication(
      tenantA,
      record.id,
      'PUBLISH',
    );
    const evidenceWhere = { tenantId: tenantA, promotionId: record.id };
    const before = await testPrisma.promotionRedemption.count({
      where: evidenceWhere,
    });
    const definition = preparePromotionDefinition(tenantA, published);
    const result = evaluatePromotions([definition], {
      tenantId: tenantA,
      now,
      currency: 'KWD',
      customer: null,
      coupon: 'NONE',
      lines: [
        {
          id: 'line',
          productId: productA,
          variantId: variantA,
          categoryId: 'category',
          brandId: null,
          quantity: 2,
          saleUnitMinor: 1001n,
          saleMerchandiseGrossMinor: 2002n,
        },
      ],
      sellables: [
        {
          tenantId: tenantA,
          productId: productA,
          variantId: variantA,
          isDefault: true,
          saleUnitMinor: 1001n,
        },
      ],
    });
    expect(result.confirmedMerchandiseSavingsMinor).toBe(1n);
    expect(
      await testPrisma.promotionRedemption.count({ where: evidenceWhere }),
    ).toBe(before);
    expect(await service.getPromotion(tenantA, record.id)).toEqual(published);
  });
});
