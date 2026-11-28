import { describe, expect, it } from 'vitest';
import { evaluatePromotions } from '../../src/modules/promotions/promotion.evaluator.js';
import { preparePromotionDefinition } from '../../src/modules/promotions/promotion.preparation.js';
import { validatePromotionDraft } from '../../src/modules/promotions/promotion.schemas.js';
import type {
  PromotionCartLine,
  PromotionDefinition,
  PromotionEvaluationContext,
  PromotionSellable,
} from '../../src/modules/promotions/promotion.types.js';

const now = new Date('2026-11-28T12:00:00Z');
const presentation = { titleAr: 'عرض', titleEn: 'Offer' };
const tenantId = 'store';
const selector = (productId: string) => ({
  key: productId,
  kind: 'PRODUCT',
  productId,
});
const brand = { key: 'brand', kind: 'BRAND', brandId: 'brand' };
const category = { key: 'category', kind: 'CATEGORY', categoryId: 'category' };
const variant = {
  key: 'variant',
  kind: 'VARIANT',
  productId: 'a',
  variantId: 'a-red',
};
const all = (...items: [string, number][]) => ({
  kind: 'ALL_REQUIRED',
  items: items.map(([selector, quantity]) => ({ selector, quantity })),
});
const mix = (selectors: string[], quantity: number) => ({
  kind: 'MIX_MATCH',
  selectors,
  quantity,
});
const free = (selector: string, quantity = 1) => ({
  kind: 'FREE_PRODUCT',
  selector,
  quantity,
});
const fixed = (amount: string) => ({ kind: 'FIXED_AMOUNT', amount });
const rate = (basisPoints: number) => ({ kind: 'PERCENTAGE', basisPoints });
const productRewards = (...items: [string, number, object][]) => ({
  kind: 'PRODUCT_REWARDS',
  items: items.map(([selector, quantity, discount]) => ({
    selector,
    quantity,
    discount,
  })),
});
const term = (template: string, condition: unknown, reward: unknown) => ({
  version: 1,
  template,
  condition,
  reward,
});
const line = (
  productId: string,
  quantity: number,
  price = 100n,
  extra: Partial<PromotionCartLine> = {},
): PromotionCartLine => ({
  id: productId,
  productId,
  variantId: `${productId}-sku`,
  categoryId: 'category',
  brandId: 'brand',
  quantity,
  saleUnitMinor: price,
  saleMerchandiseGrossMinor: price * BigInt(quantity),
  ...extra,
});
const sellable = (
  productId: string,
  unit = 100n,
  extra: Partial<PromotionSellable> = {},
): PromotionSellable => ({
  tenantId,
  productId,
  variantId: `${productId}-sku`,
  saleUnitMinor: unit,
  isDefault: true,
  ...extra,
});
const def = (
  id: string,
  configuration: object,
  selectors: object[] = [],
  extra: Record<string, unknown> = {},
  currency = 'USD',
): PromotionDefinition => ({
  ...validatePromotionDraft(
    { ...presentation, configuration, selectors, ...extra },
    currency,
  ),
  id,
  tenantId,
  currency,
  startsAt: null,
  endsAt: null,
  publication: 'PUBLISHED',
});
const ctx = (
  lines: PromotionCartLine[],
  extra: Partial<PromotionEvaluationContext> = {},
): PromotionEvaluationContext => ({
  tenantId,
  now,
  currency: 'USD',
  lines,
  customer: null,
  coupon: 'NONE',
  ...extra,
});
const stock = (...items: [string, number][]) => ({
  fulfillmentId: 'warehouse',
  available: new Map(items.map(([sku, count]) => [`${sku}-sku`, count])),
});

describe('promotion engine', () => {
  it('consumes complete multi-product groups and reports the next shortfall', () => {
    const offer = def(
      'offer',
      term('BUY_X_GET_Y', all(['a', 4], ['b', 3]), free('c')),
      [selector('a'), selector('b'), selector('c')],
      { perOrderLimit: 5 },
    );
    const result = evaluatePromotions(
      [offer],
      ctx([line('a', 9), line('b', 8)], {
        sellables: [sellable('c')],
        inventory: stock(['c', 3]),
      }),
    );
    expect(result.applied[0]).toMatchObject({
      applications: 2,
      qualifyingUnits: [
        { lineId: 'a', quantity: 8 },
        { lineId: 'b', quantity: 6 },
      ],
      rewardUnits: [
        {
          variantId: 'c-sku',
          quantity: 2,
          source: 'AUTOMATIC',
          discountMinor: 200n,
        },
      ],
      merchandiseSavingsMinor: 0n,
    });
    expect(result.remainingUnits).toMatchObject([
      { lineId: 'a', quantity: 1 },
      { lineId: 'b', quantity: 2 },
    ]);
    expect(result.recommendations).toMatchObject([
      {
        reason: 'ADDITIONAL_GROUP',
        missing: [
          { selector: 'a', quantity: 3 },
          { selector: 'b', quantity: 1 },
        ],
      },
    ]);
  });

  it('reports missing products and leaves incomplete groups unconsumed', () => {
    const offer = def(
      'offer',
      term('ALL_REQUIRED', all(['a', 2], ['b', 1]), free('c')),
      [selector('a'), selector('b'), selector('c')],
    );
    const result = evaluatePromotions([offer], ctx([line('a', 1)]));
    expect(result.applied).toEqual([]);
    expect(result.recommendations[0]).toMatchObject({
      reason: 'MISSING_PRODUCTS',
      missing: [
        { selector: 'a', quantity: 1 },
        { selector: 'b', quantity: 1 },
      ],
    });
    expect(result.remainingUnits[0]?.quantity).toBe(1);
  });

  it('keeps same-SKU qualifiers and free cart quantities financially distinct', () => {
    const offer = def('offer', term('BUY_X_GET_Y', all(['a', 2]), free('a')), [
      selector('a'),
    ]);
    const result = evaluatePromotions(
      [offer],
      ctx([line('a', 3)], {
        sellables: [sellable('a')],
        inventory: stock(['a', 3]),
      }),
    );
    expect(result.applied[0]).toMatchObject({
      qualifyingUnits: [{ lineId: 'a', quantity: 2 }],
      rewardUnits: [{ lineId: 'a', quantity: 1, discountMinor: 100n }],
      merchandiseDiscounts: [{ lineId: 'a', quantity: 1, discountMinor: 100n }],
    });
    expect(result.remainingUnits).toEqual([]);
  });

  it('can propose a separate same-SKU unit and reserves capacity against all original paid units', () => {
    const offer = def('offer', term('BUY_X_GET_Y', all(['a', 2]), free('a')), [
      selector('a'),
    ]);
    const extra = { sellables: [sellable('a')], inventory: stock(['a', 3]) };
    expect(
      evaluatePromotions([offer], ctx([line('a', 2)], extra)).applied[0]
        ?.rewardUnits,
    ).toMatchObject([{ source: 'AUTOMATIC', quantity: 1 }]);
    expect(
      evaluatePromotions(
        [offer],
        ctx([line('a', 2)], { ...extra, inventory: stock(['a', 2]) }),
      ).rejected[0]?.reason,
    ).toBe('REWARD_UNAVAILABLE');
    expect(
      evaluatePromotions(
        [offer],
        ctx([line('a', 2)], { sellables: extra.sellables }),
      ).eligibleUnapplied[0]?.reason,
    ).toBe('REWARD_STOCK_UNKNOWN');
  });

  it('applies mixed free, percentage, and capped fixed rewards to multiple sellables', () => {
    const offer = def(
      'offer',
      term(
        'BUY_X_GET_Y',
        all(['a', 1]),
        productRewards(
          ['b', 1, rate(1250)],
          ['c', 1, fixed('12.00')],
          ['d', 1, { kind: 'FREE' }],
        ),
      ),
      ['a', 'b', 'c', 'd'].map(selector),
    );
    const result = evaluatePromotions(
      [offer],
      ctx([line('a', 1), line('b', 1, 101n), line('c', 1, 20n)], {
        sellables: ['b', 'c', 'd'].map((key) => sellable(key)),
        inventory: stock(['d', 1]),
      }),
    );
    expect(result.applied[0]?.rewardUnits).toMatchObject([
      { variantId: 'b-sku', discountMinor: 13n },
      { variantId: 'c-sku', discountMinor: 20n },
      { variantId: 'd-sku', source: 'AUTOMATIC' },
    ]);
    expect(result.confirmedMerchandiseSavingsMinor).toBe(33n);
  });

  it.each([rate(1000), fixed('0.30')])(
    'caps legacy cross-product rewards to distinct remaining units',
    (discount) => {
      const offer = def(
        'offer',
        term('CROSS_PRODUCT', all(['a', 2]), { ...discount, selectors: ['a'] }),
        [selector('a')],
      );
      const result = evaluatePromotions([offer], ctx([line('a', 3)]));
      expect(result.applied[0]?.rewardUnits).toMatchObject([
        { quantity: 1, source: 'CART' },
      ]);
      expect(result.remainingUnits).toEqual([]);
    },
  );

  it('supports free cross-product rewards and gives unavailable variants no benefit', () => {
    const offer = def(
      'offer',
      term('CROSS_PRODUCT', all(['a', 1]), free('b')),
      [selector('a'), selector('b')],
    );
    const available = ctx([line('a', 1)], {
      sellables: [sellable('b')],
      inventory: stock(['b', 1]),
    });
    expect(evaluatePromotions([offer], available).applied).toHaveLength(1);
    expect(
      evaluatePromotions([offer], {
        ...available,
        sellables: [sellable('b', 100n, { tenantId: 'foreign' })],
      }).rejected,
    ).toMatchObject([{ reason: 'REWARD_UNAVAILABLE' }]);
  });

  it.each([
    [{ kind: 'FIXED_PRICE', amount: '0.104' }, 100n],
    [rate(1250), 39n],
    [fixed('0.010'), 20n],
  ])(
    'allocates repeatable mixed-price KWD bundles exactly',
    (reward, expected) => {
      const offer = def(
        'offer',
        term('BUNDLE', all(['a', 1], ['b', 1]), reward),
        [selector('a'), selector('b')],
        { perOrderLimit: 2 },
        'KWD',
      );
      const result = evaluatePromotions(
        [offer],
        ctx(
          [
            line('a', 2, 51n, { taxClassId: 'standard' }),
            line('b', 2, 103n, { taxClassId: 'exempt' }),
          ],
          { currency: 'KWD', currencyPrecision: 3 },
        ),
      );
      const applied = result.applied[0]!;
      expect(applied.applications).toBe(2);
      expect(applied.merchandiseDiscounts).toMatchObject([
        { taxClassId: 'standard' },
        { taxClassId: 'exempt' },
      ]);
      expect(
        applied.merchandiseDiscounts.reduce(
          (sum, item) => sum + item.discountMinor,
          0n,
        ),
      ).toBe(expected);
    },
  );

  it('uses stable line identity to break allocation ties', () => {
    const offer = def(
      'offer',
      term('BUNDLE', all(['a', 1], ['b', 1]), fixed('0.01')),
      [selector('a'), selector('b')],
    );
    const lines = [line('b', 1), line('a', 1)];
    expect(
      evaluatePromotions([offer], ctx(lines)).applied[0]?.merchandiseDiscounts,
    ).toMatchObject([{ lineId: 'a', discountMinor: 1n }]);
    expect(evaluatePromotions([offer], ctx(lines))).toEqual(
      evaluatePromotions([offer], ctx([...lines].reverse())),
    );
  });

  it.each([0n, 100n])(
    'does not apply zero-saving or price-increasing bundles',
    (unit) => {
      const offer = def(
        'offer',
        term('BUNDLE', all(['a', 1]), { kind: 'FIXED_PRICE', amount: '1.00' }),
        [selector('a')],
      );
      expect(
        evaluatePromotions([offer], ctx([line('a', 1, unit)])).rejected[0]
          ?.reason,
      ).toBe('NO_SAVING');
    },
  );

  it('uses original merchandise gross and reports exact remaining spend', () => {
    const offer = def(
      'offer',
      term(
        'SPEND_GET',
        { kind: 'SPEND', minimum: '1.20', selectors: ['a'] },
        fixed('0.50'),
      ),
      [selector('a')],
    );
    const gross = [line('a', 1, 100n, { saleMerchandiseGrossMinor: 120n })];
    expect(
      evaluatePromotions(
        [offer],
        ctx(gross, { shipping: { eligibleChargeMinor: 500n } }),
      ).confirmedMerchandiseSavingsMinor,
    ).toBe(50n);
    expect(
      evaluatePromotions([offer], ctx([line('a', 1, 100n), line('b', 1, 200n)]))
        .recommendations,
    ).toMatchObject([{ reason: 'MISSING_SPEND', missingSpendMinor: 20n }]);
  });

  it('supports percentage and free-product spend rewards', () => {
    const condition = { kind: 'SPEND', minimum: '1.00' };
    const rateOffer = def('rate', term('SPEND_GET', condition, rate(1250)));
    expect(
      evaluatePromotions([rateOffer], ctx([line('a', 1)]))
        .confirmedMerchandiseSavingsMinor,
    ).toBe(13n);
    const freeOffer = def('free', term('SPEND_GET', condition, free('b')), [
      selector('b'),
    ]);
    expect(
      evaluatePromotions(
        [freeOffer],
        ctx([line('a', 1)], {
          sellables: [sellable('b')],
          inventory: stock(['b', 1]),
        }),
      ).applied[0]?.rewardUnits,
    ).toMatchObject([{ source: 'AUTOMATIC', variantId: 'b-sku' }]);
  });

  it('excludes cart units assigned as spend rewards from the spend threshold', () => {
    const offer = def(
      'spend',
      term('SPEND_GET', { kind: 'SPEND', minimum: '1.00' }, free('b')),
      [selector('b')],
    );
    const extra = { sellables: [sellable('b')], inventory: stock(['b', 1]) };
    const eligible = evaluatePromotions(
      [offer],
      ctx([line('a', 1), line('b', 1)], extra),
    );
    expect(eligible.applied[0]).toMatchObject({
      qualifyingUnits: [{ lineId: 'a', quantity: 1 }],
      rewardUnits: [{ lineId: 'b', quantity: 1, discountMinor: 100n }],
    });
    const short = evaluatePromotions(
      [offer],
      ctx([line('a', 1, 99n), line('b', 1)], extra),
    );
    expect(short.recommendations).toMatchObject([
      { reason: 'MISSING_SPEND', missingSpendMinor: 1n },
    ]);
  });

  it('mixes categories, brands and specific variants without counting overlapping matches twice', () => {
    const offer = def(
      'offer',
      term('MIX_MATCH', mix(['brand', 'category', 'variant'], 3), rate(1000)),
      [brand, category, variant],
    );
    const lines = [line('a', 1, 100n, { variantId: 'a-red' }), line('b', 1)];
    expect(
      evaluatePromotions([offer], ctx(lines)).recommendations,
    ).toMatchObject([{ reason: 'MISSING_MIX_QUANTITY', missingQuantity: 1 }]);
    expect(
      evaluatePromotions(
        [offer],
        ctx([...lines, line('c', 1, 100n, { categoryId: 'other' })]),
      ).confirmedMerchandiseSavingsMinor,
    ).toBe(30n);
    const filtered = ctx(lines, {
      mixSelections: new Map([['offer', ['variant']]]),
    });
    expect(
      evaluatePromotions([offer], filtered).recommendations[0]?.missingQuantity,
    ).toBe(2);
    expect(
      evaluatePromotions([offer], {
        ...filtered,
        mixSelections: new Map([['offer', ['b']]]),
      }).rejected[0]?.reason,
    ).toBe('MIX_SELECTION_INVALID');
  });

  it('reassigns broad matches to preserve units for narrower requirements', () => {
    const offer = def(
      'offer',
      term('BUNDLE', all(['category', 1], ['variant', 1]), fixed('0.50')),
      [category, variant],
    );
    const result = evaluatePromotions(
      [offer],
      ctx([line('a', 1, 100n, { variantId: 'a-red' }), line('b', 1)]),
    );
    expect(result.applied[0]?.qualifyingUnits).toMatchObject([
      { lineId: 'a', quantity: 1 },
      { lineId: 'b', quantity: 1 },
    ]);
  });

  it.each([fixed('0.50'), { kind: 'FIXED_PRICE', amount: '1.50' }, free('c')])(
    'evaluates configured Mix & Match reward shapes',
    (reward) => {
      const selectors =
        reward.kind === 'FREE_PRODUCT' ? [category, selector('c')] : [category];
      const offer = def(
        'offer',
        term('MIX_MATCH', mix(['category'], 2), reward),
        selectors,
      );
      expect(
        evaluatePromotions(
          [offer],
          ctx([line('a', 1), line('b', 1)], {
            sellables: [sellable('c')],
            inventory: stock(['c', 1]),
          }),
        ).applied,
      ).toHaveLength(1);
    },
  );

  it('chooses the highest tier and returns current and next tier guidance', () => {
    const offer = def(
      'offer',
      term(
        'TIERED_QUANTITY',
        { kind: 'QUANTITY', selectors: ['category'] },
        {
          kind: 'TIERS',
          tiers: [3, 5, 10].map((minimumQuantity, index) => ({
            minimumQuantity,
            discount: rate(500 * (index + 1)),
          })),
        },
      ),
      [category],
    );
    const result = evaluatePromotions([offer], ctx([line('a', 6)]));
    expect(result.applied[0]).toMatchObject({
      currentTier: 5,
      nextTier: 10,
      merchandiseSavingsMinor: 60n,
    });
    expect(result.recommendations[0]).toMatchObject({
      reason: 'NEXT_TIER',
      currentTier: 5,
      nextTier: 10,
      missingQuantity: 4,
    });
    expect(
      evaluatePromotions([offer], ctx([line('a', 1)])).recommendations[0],
    ).toMatchObject({ nextTier: 3, missingQuantity: 2 });
  });

  it('returns known shipping savings or a conditional benefit without inventing an amount', () => {
    const offer = def(
      'offer',
      term('FREE_SHIPPING', all(['a', 1]), { kind: 'FREE_SHIPPING' }),
      [selector('a')],
    );
    const result = evaluatePromotions([offer], ctx([line('a', 1)]));
    expect(result.eligibleUnapplied).toMatchObject([
      { reason: 'SHIPPING_UNKNOWN', conditionalBenefit: 'FREE_SHIPPING' },
    ]);
    expect(result.confirmedShippingSavingsMinor).toBe(0n);
    expect(
      evaluatePromotions(
        [offer],
        ctx([line('a', 1)], { shipping: { eligibleChargeMinor: 350n } }),
      ).confirmedShippingSavingsMinor,
    ).toBe(350n);
  });

  it('requires an explicit available gift and retains alternatives when it is invalidated', () => {
    const offer = def(
      'offer',
      term('SELECT_GIFT', all(['a', 1]), {
        kind: 'SELECTED_GIFT',
        options: ['b', 'c'],
        quantity: 1,
      }),
      ['a', 'b', 'c'].map(selector),
    );
    const base = ctx([line('a', 1)], {
      sellables: [sellable('b'), sellable('c')],
      inventory: stock(['b', 1], ['c', 1]),
    });
    const request = (key: string, variantId = `${key}-sku`, quantity = 1) =>
      new Map([['offer', { key, variantId, quantity }]]);
    expect(evaluatePromotions([offer], base).recommendations[0]).toMatchObject({
      reason: 'GIFT_SELECTION_REQUIRED',
      giftOptions: [{ key: 'b' }, { key: 'c' }],
    });
    expect(
      evaluatePromotions([offer], { ...base, selectedGiftKeys: request('b') })
        .applied[0]?.rewardUnits,
    ).toMatchObject([{ source: 'SELECTED_GIFT', variantId: 'b-sku' }]);
    expect(
      evaluatePromotions([offer], {
        ...base,
        selectedGiftKeys: request('b', 'wrong'),
      }).recommendations[0]?.reason,
    ).toBe('GIFT_SELECTION_INVALID');
    expect(
      evaluatePromotions([offer], {
        ...base,
        selectedGiftKeys: request('b', 'b-sku', 2),
      }).recommendations[0]?.reason,
    ).toBe('GIFT_SELECTION_INVALID');
    expect(
      evaluatePromotions([offer], {
        ...base,
        selectedGiftKeys: request('b'),
        inventory: stock(['b', 0], ['c', 1]),
      }).recommendations[0],
    ).toMatchObject({
      reason: 'GIFT_SELECTION_INVALID',
      giftOptions: [{ key: 'c' }],
    });
    expect(
      evaluatePromotions([offer], {
        ...base,
        selectedGiftKeys: request('b'),
        inventory: stock(['c', 1]),
      }).eligibleUnapplied[0],
    ).toMatchObject({
      reason: 'REWARD_STOCK_UNKNOWN',
      giftOptions: [
        { key: 'b', availability: 'PROVISIONAL' },
        { key: 'c', availability: 'AVAILABLE' },
      ],
    });
  });
});

const bundle = (
  id: string,
  product: string,
  amount: string,
  extra: Record<string, unknown> = {},
) =>
  def(
    id,
    term('BUNDLE', all([product, 1]), fixed(amount)),
    [selector(product)],
    extra,
  );

describe('eligibility, conflict resolution and robustness', () => {
  it.each([
    [1, '0.80', 'first'],
    [0, '0.80', 'second'],
    [0, '0.30', 'first'],
  ] as const)(
    'chooses priority %s, savings %s, then stable ID',
    (priority, saving, winner) => {
      const first = bundle('first', 'a', '0.30', { priority });
      const second = bundle('second', 'a', saving);
      const context = ctx([line('a', 1)]);
      const result = evaluatePromotions([second, first], context);
      expect(result.applied.map(({ promotionId }) => promotionId)).toEqual([
        winner,
      ]);
      expect(result.rejected[0]?.reason).toBe('UNIT_CONFLICT');
      expect(result).toEqual(evaluatePromotions([first, second], context));
    },
  );

  it('re-evaluates repeat counts against remaining units and permits independent candidates', () => {
    const first = bundle('first', 'a', '0.30', { priority: 10 });
    const repeat = bundle('repeat', 'a', '0.20', { perOrderLimit: 4 });
    const independent = bundle('independent', 'b', '0.10');
    const result = evaluatePromotions(
      [repeat, independent, first],
      ctx([line('a', 3), line('b', 1)]),
    );
    expect(
      result.applied.map(({ promotionId, applications }) => [
        promotionId,
        applications,
      ]),
    ).toEqual([
      ['first', 1],
      ['repeat', 2],
      ['independent', 1],
    ]);
  });

  it('enforces exclusive stacking, single shipping reward and coupon precedence', () => {
    const first = def(
      'first',
      {
        ...term('BUNDLE', all(['a', 1]), fixed('0.50')),
        stacking: 'EXCLUSIVE',
      },
      [selector('a')],
    );
    const second = bundle('second', 'b', '0.20');
    const context = ctx([line('a', 1), line('b', 1)]);
    expect(
      evaluatePromotions([first, second], context).rejected[0]?.reason,
    ).toBe('STACKING_RESTRICTED');
    expect(
      evaluatePromotions([first, second], {
        ...context,
        coupon: 'VALID',
      }).rejected.every(({ reason }) => reason === 'COUPON_PRECEDENCE'),
    ).toBe(true);
    expect(
      evaluatePromotions([first, second], { ...context, coupon: 'UNKNOWN' })
        .eligibleUnapplied,
    ).toHaveLength(2);
    const shipping = (id: string) =>
      def(id, term('FREE_SHIPPING', undefined, { kind: 'FREE_SHIPPING' }));
    expect(
      evaluatePromotions([shipping('a'), shipping('b')], {
        ...context,
        shipping: { eligibleChargeMinor: 100n },
      }).applied,
    ).toHaveLength(1);
  });

  it('keeps proposed rewards out of qualifiers and respects shared reward capacity', () => {
    const offers = ['a', 'b'].map((key) =>
      def(key, term('BUY_X_GET_Y', all([key, 1]), free('c')), [
        selector(key),
        selector('c'),
      ]),
    );
    const recurse = bundle('recursive', 'c', '0.50');
    const result = evaluatePromotions(
      [...offers, recurse],
      ctx([line('a', 1), line('b', 1)], {
        sellables: [sellable('c')],
        inventory: stock(['c', 1]),
      }),
    );
    expect(result.applied.map(({ promotionId }) => promotionId)).toEqual(['a']);
    expect(result.rejected).toMatchObject([
      { promotionId: 'b', reason: 'UNIT_CONFLICT' },
      { promotionId: 'recursive', reason: 'MISSING_PRODUCTS' },
    ]);
  });

  it('preserves alternate gift choices after a higher-priority offer consumes selected stock', () => {
    const first = def(
      'first',
      term('BUY_X_GET_Y', all(['a', 1]), free('c')),
      [selector('a'), selector('c')],
      { priority: 10 },
    );
    const gift = def(
      'gift',
      term('SELECT_GIFT', all(['b', 1]), {
        kind: 'SELECTED_GIFT',
        options: ['c', 'd'],
        quantity: 1,
      }),
      ['b', 'c', 'd'].map(selector),
    );
    const context = ctx([line('a', 1), line('b', 1)], {
      sellables: [sellable('c'), sellable('d')],
      inventory: stock(['c', 1], ['d', 1]),
      selectedGiftKeys: new Map([['gift', { key: 'c' }]]),
    });
    const result = evaluatePromotions([gift, first], context);
    expect(result.applied.map(({ promotionId }) => promotionId)).toEqual([
      'first',
    ]);
    expect(result.rejected).toMatchObject([
      { promotionId: 'gift', reason: 'UNIT_CONFLICT' },
    ]);
    expect(result.recommendations).toMatchObject([
      {
        promotionId: 'gift',
        reason: 'GIFT_SELECTION_INVALID',
        giftOptions: [{ key: 'd' }],
      },
    ]);
  });

  it('does not discount the same cart reward unit twice across cross-product offers', () => {
    const offers = ['a', 'b'].map((key) =>
      def(
        key,
        term(
          'CROSS_PRODUCT',
          all([key, 1]),
          productRewards(['c', 1, rate(2000)]),
        ),
        [selector(key), selector('c')],
      ),
    );
    const result = evaluatePromotions(
      offers,
      ctx([line('a', 1), line('b', 1), line('c', 1)], {
        sellables: [sellable('c')],
      }),
    );
    expect(result.confirmedMerchandiseSavingsMinor).toBe(20n);
    expect(result.rejected).toMatchObject([
      { promotionId: 'b', reason: 'UNIT_CONFLICT' },
    ]);
  });

  it('enforces all usage bounds and defers unavailable usage facts', () => {
    const offer = bundle('offer', 'a', '0.10', {
      perOrderLimit: 4,
      perCustomerLimit: 10,
      globalLimit: 20,
    });
    const customer = { id: 'customer', tenantId };
    const context = ctx([line('a', 10)], { customer });
    const run = (customerRemaining: number, globalRemaining: number) =>
      evaluatePromotions([offer], {
        ...context,
        usage: new Map([['offer', { customerRemaining, globalRemaining }]]),
      });
    expect(run(8, 9).applied[0]?.applications).toBe(4);
    expect(run(2, 9).applied[0]?.applications).toBe(2);
    expect(run(8, 1).applied[0]?.applications).toBe(1);
    expect(run(0, 9).rejected[0]?.reason).toBe('USAGE_EXHAUSTED');
    expect(run(8, 0).rejected[0]?.reason).toBe('USAGE_EXHAUSTED');
    expect(
      evaluatePromotions([offer], context).eligibleUnapplied[0]?.reason,
    ).toBe('USAGE_UNKNOWN');
  });

  it('evaluates verified membership and history and keeps ineligible audiences out of guidance', () => {
    const first = bundle('first', 'a', '0.10', {
      audience: { kind: 'FIRST_TIME' },
    });
    const returning = bundle('returning', 'b', '0.10', {
      audience: { kind: 'RETURNING' },
    });
    const selected = bundle('selected', 'c', '0.10', {
      audience: { kind: 'SELECTED', customerIds: ['customer'] },
    });
    const offers = [first, returning, selected];
    const base = ctx([line('a', 1), line('b', 1), line('c', 1)]);
    const customer = { id: 'customer', tenantId };
    expect(evaluatePromotions(offers, base).recommendations).toEqual([]);
    expect(
      evaluatePromotions(offers, {
        ...base,
        customer: { ...customer, hasQualifyingCompletedOrder: false },
      }).applied.map(({ promotionId }) => promotionId),
    ).toEqual(['first', 'selected']);
    expect(
      evaluatePromotions(offers, {
        ...base,
        customer: { ...customer, hasQualifyingCompletedOrder: true },
      }).applied.map(({ promotionId }) => promotionId),
    ).toEqual(['returning', 'selected']);
    expect(
      evaluatePromotions(offers, {
        ...base,
        customer: { ...customer, id: 'other' },
      }).rejected.map(({ reason }) => reason),
    ).toEqual([
      'CUSTOMER_HISTORY_UNKNOWN',
      'CUSTOMER_HISTORY_UNKNOWN',
      'AUDIENCE_MISMATCH',
    ]);
    expect(
      evaluatePromotions(offers, {
        ...base,
        customer: { ...customer, tenantId: 'other' },
      }).rejected.every(({ reason }) => reason === 'INACCESSIBLE'),
    ).toBe(true);
  });

  it('honors exact lifecycle boundaries and suppresses inaccessible and inactive guidance', () => {
    const offer = bundle('offer', 'a', '0.10');
    const context = ctx([line('a', 1)]);
    expect(
      evaluatePromotions([{ ...offer, startsAt: now }], context).applied,
    ).toHaveLength(1);
    for (const change of [
      { endsAt: now },
      { startsAt: new Date(now.getTime() + 1) },
      { publication: 'PAUSED' },
      { publication: 'DRAFT' },
      { publication: 'ENDED' },
      { tenantId: 'other' },
    ] as const) {
      const result = evaluatePromotions([{ ...offer, ...change }], {
        ...context,
        lines: [],
      });
      expect([
        result.applied,
        result.recommendations,
        result.eligibleUnapplied,
      ]).toEqual([[], [], []]);
    }
  });

  it('rejects malformed facts, handles empty carts and leaves frozen inputs intact', () => {
    const offer = Object.freeze(bundle('offer', 'a', '0.10'));
    expect(evaluatePromotions([], ctx([])).applied).toEqual([]);
    expect(
      evaluatePromotions([offer], ctx([])).recommendations[0]?.reason,
    ).toBe('MISSING_PRODUCTS');
    const lines = [Object.freeze(line('a', 1))];
    const context = Object.freeze(ctx(lines));
    Object.freeze(lines);
    expect(evaluatePromotions([offer], context)).toEqual(
      evaluatePromotions([offer], context),
    );
    expect(context.lines[0]?.quantity).toBe(1);
    expect(() =>
      evaluatePromotions([offer], ctx([line('a', 1), line('a', 2)])),
    ).toThrow('Invalid promotion cart line');
    expect(() =>
      evaluatePromotions([offer], { ...context, currencyPrecision: 3 }),
    ).toThrow('Invalid promotion evaluation context');
  });

  it('scales across large quantities and overlapping offers without expanding units', () => {
    const offers = Array.from({ length: 30 }, (_, index) =>
      bundle(String(index).padStart(2, '0'), 'a', '0.01', {
        perOrderLimit: 1_000_000,
      }),
    );
    const context = ctx([line('a', 2_147_483_647, 2n)]);
    const result = evaluatePromotions(offers, context);
    expect(result.applied).toHaveLength(30);
    expect(result.remainingUnits[0]?.quantity).toBe(2_117_483_647);
    expect(result.confirmedMerchandiseSavingsMinor).toBe(30_000_000n);
    expect(result).toEqual(evaluatePromotions([...offers].reverse(), context));
  }, 2000);

  it('preserves line capacities and exact caps across a grid of quantities and prices', () => {
    const offer = bundle('offer', 'a', '0.50', { perOrderLimit: 4 });
    for (const price of [0n, 1n, 50n, 51n, 100n]) {
      for (let quantity = 1; quantity <= 8; quantity++) {
        const result = evaluatePromotions(
          [offer],
          ctx([line('a', quantity, price)]),
        );
        const consumed = result.applied[0]?.qualifyingUnits[0]?.quantity ?? 0;
        expect(consumed + (result.remainingUnits[0]?.quantity ?? 0)).toBe(
          quantity,
        );
        expect(result.confirmedMerchandiseSavingsMinor).toBeLessThanOrEqual(
          price * BigInt(consumed),
        );
      }
    }
  });

  it('prepares accepted persisted definitions and rejects mismatched tenants', () => {
    const row = {
      ...presentation,
      id: 'offer',
      tenantId,
      currency: 'USD',
      publication: 'PUBLISHED' as const,
      startsAt: null,
      endsAt: null,
      configuration: term('BUNDLE', all(['a', 1]), fixed('0.10')),
      audience: 'ALL' as const,
      priority: 0,
      perOrderLimit: 1,
      globalLimit: null,
      perCustomerLimit: null,
      selectors: [
        {
          key: 'a',
          productId: 'a',
          variantId: null,
          categoryId: null,
          brandId: null,
        },
      ],
      customers: [],
    };
    expect(
      evaluatePromotions(
        [preparePromotionDefinition(tenantId, row)],
        ctx([line('a', 1)]),
      ).confirmedMerchandiseSavingsMinor,
    ).toBe(10n);
    expect(() => preparePromotionDefinition('other', row)).toThrow(
      'Promotion tenant mismatch',
    );
  });
});
