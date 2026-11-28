import { describe, expect, it } from 'vitest';
import { promotionStatus } from '../../src/modules/promotions/promotion.lifecycle.js';
import { validatePromotionDraft } from '../../src/modules/promotions/promotion.schemas.js';
import type { PromotionWindow } from '../../src/modules/promotions/promotion.types.js';

const presentation = { titleAr: 'عرض', titleEn: 'Offer' };
const all = { kind: 'ALL_REQUIRED', items: [{ selector: 'sku', quantity: 2 }] };
const mix = { kind: 'MIX_MATCH', selectors: ['sku'], quantity: 2 };
const spend = { kind: 'SPEND', minimum: '1.001' };
const free = { kind: 'FREE_PRODUCT', selector: 'sku', quantity: 1 };
const gift = { kind: 'SELECTED_GIFT', options: ['sku'], quantity: 1 };
const shipping = { kind: 'FREE_SHIPPING' };
const fixed = { kind: 'FIXED_AMOUNT', amount: '0.001' };
const rate = { kind: 'PERCENTAGE', basisPoints: 1250 };
const tiers = {
  kind: 'TIERS',
  tiers: [
    { minimumQuantity: 2, discount: rate },
    { minimumQuantity: 3, discount: fixed },
  ],
};
const quantity = { kind: 'QUANTITY', selectors: ['sku'] };

function draft(
  template: string,
  condition: unknown,
  reward: unknown,
  selectors = [
    { key: 'sku', kind: 'VARIANT', productId: 'product', variantId: 'variant' },
  ],
) {
  return {
    ...presentation,
    selectors,
    configuration: { version: 1, template, condition, reward },
  };
}

describe('promotion configuration', () => {
  it.each([
    ['BUY_X_GET_Y', all, free],
    ['ALL_REQUIRED', all, free],
    ['CROSS_PRODUCT', all, { ...rate, selectors: ['sku'] }],
    ['CROSS_PRODUCT', all, { ...fixed, selectors: ['sku'] }],
    ['BUNDLE', all, { kind: 'FIXED_PRICE', amount: '1.001' }],
    ['BUNDLE', all, rate],
    ['BUNDLE', all, fixed],
    ['SPEND_GET', { ...spend, selectors: ['sku'] }, free],
    ['MIX_MATCH', mix, rate],
    ['SELECT_GIFT', all, gift],
    ['TIERED_QUANTITY', quantity, tiers],
    ['FREE_SHIPPING', all, shipping],
  ])('validates the %s template', (template, condition, reward) => {
    expect(
      validatePromotionDraft(draft(template, condition, reward), 'KWD')
        .perOrderLimit,
    ).toBe(1);
  });

  it.each([0, -1, 1.5, 1_000_001])(
    'rejects required quantity %s',
    (invalid) => {
      const condition = {
        ...all,
        items: [{ selector: 'sku', quantity: invalid }],
      };
      expect(() =>
        validatePromotionDraft(draft('BUY_X_GET_Y', condition, free), 'KWD'),
      ).toThrow();
    },
  );

  it.each([0, -1, 10001, 1.5])(
    'rejects percentage basis points %s',
    (basisPoints) => {
      expect(() =>
        validatePromotionDraft(
          draft('BUNDLE', all, { ...rate, basisPoints }),
          'KWD',
        ),
      ).toThrow();
    },
  );

  it.each(['0', '-1', '0.0001', '10000000000', '1e-3', 0.001])(
    'rejects KWD discount %s',
    (amount) => {
      expect(() =>
        validatePromotionDraft(
          draft('BUNDLE', all, { ...fixed, amount }),
          'KWD',
        ),
      ).toThrow();
    },
  );

  it('uses tenant money precision for spend thresholds, rewards and tier discounts', () => {
    const spendShipping = draft('SPEND_GET', spend, shipping, []);
    expect(
      validatePromotionDraft(spendShipping, 'KWD').configuration.condition,
    ).toEqual(spend);
    expect(() => validatePromotionDraft(spendShipping, 'USD')).toThrow();
    expect(() =>
      validatePromotionDraft(draft('BUNDLE', all, fixed), 'USD'),
    ).toThrow();
    expect(() =>
      validatePromotionDraft(draft('TIERED_QUANTITY', quantity, tiers), 'USD'),
    ).toThrow();
  });

  it('permits multi-item groups and bounded repeats for unit-based offers', () => {
    const input = draft(
      'BUY_X_GET_Y',
      {
        ...all,
        items: [...all.items, { selector: 'second', quantity: 3 }],
      },
      free,
    );
    input.selectors.push({
      key: 'second',
      kind: 'VARIANT',
      productId: 'other',
      variantId: 'second',
    });
    expect(
      validatePromotionDraft({ ...input, perOrderLimit: 3 }, 'KWD')
        .perOrderLimit,
    ).toBe(3);
  });

  it('restricts shipping and spend rewards to one application', () => {
    expect(() =>
      validatePromotionDraft(
        { ...draft('SPEND_GET', spend, shipping, []), perOrderLimit: 2 },
        'KWD',
      ),
    ).toThrow();
    expect(() =>
      validatePromotionDraft(
        { ...draft('FREE_SHIPPING', all, shipping), perOrderLimit: 2 },
        'KWD',
      ),
    ).toThrow();
  });

  it('rejects duplicate, orphaned and unsupported selectors', () => {
    const input = draft('BUY_X_GET_Y', all, free);
    expect(() =>
      validatePromotionDraft({ ...input, selectors: [] }, 'KWD'),
    ).toThrow();
    expect(() =>
      validatePromotionDraft(
        { ...input, selectors: [...input.selectors, ...input.selectors] },
        'KWD',
      ),
    ).toThrow();
    expect(() =>
      validatePromotionDraft(
        {
          ...input,
          selectors: [{ kind: 'CATEGORY', key: 'sku', categoryId: 'category' }],
        },
        'KWD',
      ),
    ).toThrow();
  });

  it('rejects unsorted tiers, incompatible rewards and request-controlled values', () => {
    expect(() =>
      validatePromotionDraft(
        draft('TIERED_QUANTITY', quantity, {
          ...tiers,
          tiers: [...tiers.tiers].reverse(),
        }),
        'KWD',
      ),
    ).toThrow();
    expect(() =>
      validatePromotionDraft(draft('BUY_X_GET_Y', all, fixed), 'KWD'),
    ).toThrow();
    expect(() =>
      validatePromotionDraft(
        { ...draft('BUY_X_GET_Y', all, free), currency: 'USD' },
        'KWD',
      ),
    ).toThrow();
  });

  it('requires offset-bearing timestamps and a strictly increasing window', () => {
    const input = draft('FREE_SHIPPING', undefined, shipping, []);
    expect(() =>
      validatePromotionDraft(
        { ...input, startsAt: '2026-11-28T09:00:00' },
        'KWD',
      ),
    ).toThrow();
    expect(() =>
      validatePromotionDraft(
        {
          ...input,
          startsAt: '2026-11-28T09:00:00+02:00',
          endsAt: '2026-11-28T07:00:00Z',
        },
        'KWD',
      ),
    ).toThrow();
  });
});

describe('promotion lifecycle', () => {
  const startsAt = new Date('2026-11-28T10:00:00Z');
  const endsAt = new Date('2026-11-28T11:00:00Z');
  it.each([
    ['DRAFT', '2026-11-29T00:00:00Z', 'DRAFT'],
    ['PUBLISHED', '2026-11-28T09:59:59.999Z', 'SCHEDULED'],
    ['PUBLISHED', '2026-11-28T10:00:00Z', 'ACTIVE'],
    ['PUBLISHED', '2026-11-28T11:00:00Z', 'ENDED'],
    ['PAUSED', '2026-11-28T10:00:00Z', 'PAUSED'],
    ['PAUSED', '2026-11-28T11:00:00Z', 'ENDED'],
    ['ENDED', '2026-11-28T09:00:00Z', 'ENDED'],
  ] satisfies [PromotionWindow['publication'], string, string][])(
    'derives %s at %s as %s',
    (publication, now, status) => {
      expect(
        promotionStatus({ publication, startsAt, endsAt }, new Date(now)),
      ).toBe(status);
    },
  );
});
