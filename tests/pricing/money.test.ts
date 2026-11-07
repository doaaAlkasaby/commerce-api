import { describe, expect, it } from 'vitest';
import {
  Money,
  fromMinorUnits,
  toMinorUnits,
  quantize,
  parseDecimal,
  validateAmount,
} from '../../src/common/pricing/money.js';
import {
  currencyPrecision,
  normalizeCurrency,
} from '../../src/common/pricing/currency.js';
import { calculateEffectivePrice } from '../../src/common/pricing/pricing.service.js';
import { calculateTax } from '../../src/common/tax/tax.calculator.js';
import { allocateCouponDiscount } from '../../src/common/tax/tax.allocation.js';

const none = { type: null, value: null, startsAt: null, endsAt: null };
describe('versioned currency money policy', () => {
  it.each([
    ['KWD', 3, '12.345', 12345n],
    ['USD', 2, '12.34', 1234n],
    ['SAR', 2, '12.34', 1234n],
    ['AED', 2, '12.34', 1234n],
    ['EGP', 2, '12.34', 1234n],
    ['JPY', 0, '1234', 1234n],
    ['CLF', 4, '0.0001', 1n],
    ['BHD', 3, '0.001', 1n],
  ])(
    'round-trips %s exact minor units',
    (currency, precision, value, units) => {
      expect(currencyPrecision(currency)).toBe(precision);
      expect(toMinorUnits(value, currency)).toBe(units);
      expect(fromMinorUnits(units, currency)).toBe(value);
      expect(new Money(value, currency).serialize()).toBe(value);
    },
  );
  it.each([
    ['USD', '12.345'],
    ['JPY', '1234.56'],
    ['KWD', '0.0001'],
    ['CLF', '0.00001'],
  ])('rejects invalid %s final price %s', (currency, value) => {
    expect(() => validateAmount(value, currency)).toThrow('precision');
  });
  it.each(['ZZZ', 'XXX', 'XAU', '', '12!'])(
    'rejects missing payable currency metadata %s',
    (currency) => {
      expect(() => currencyPrecision(currency)).toThrow();
    },
  );
  it.each(['NaN', 'Infinity', '1e3', '0x10', '1,234', '', ' 1', '.1'])(
    'rejects ambiguous decimal %s',
    (value) => {
      expect(() => parseDecimal(value)).toThrow();
    },
  );
  it('normalizes currency without inferring or converting it', () =>
    expect(normalizeCurrency(' kwd ')).toBe('KWD'));
  it('adds and subtracts exact amounts without binary floating point', () => {
    expect(
      new Money('0.1', 'USD').add(new Money('0.2', 'USD')).serialize(),
    ).toBe('0.30');
    expect(
      new Money('1', 'KWD').subtract(new Money('0.001', 'KWD')).serialize(),
    ).toBe('0.999');
  });
  it('rejects mixed currencies for arithmetic and comparison', () => {
    const usd = new Money('1', 'USD'),
      kwd = new Money('1', 'KWD');
    expect(() => usd.add(kwd)).toThrow('Currency mismatch');
    expect(() => usd.compare(kwd)).toThrow('Currency mismatch');
  });
  it('keeps intermediate precision separate from final amounts', () => {
    expect(new Money('0.001', 'KWD').multiply('0.05')).toBe('0.00005');
    expect(quantize('0.00005', 'KWD')).toBe('0.000');
    expect(new Money('1', 'USD').divide('3')).toBe(
      '0.333333333333333333333333',
    );
    expect(() => new Money('1', 'USD').divide('0')).toThrow();
  });
  it.each([
    ['KWD', '0.0005', '0.001'],
    ['USD', '0.005', '0.01'],
    ['JPY', '0.5', '1'],
    ['CLF', '0.00005', '0.0001'],
  ])('rounds half up at %s boundary', (currency, input, expected) => {
    expect(quantize(input, currency)).toBe(expected);
  });
  it('preserves large values and rejects overflow/negative final amounts', () => {
    expect(new Money('9999999999.9999', 'CLF').serialize()).toBe(
      '9999999999.9999',
    );
    expect(() => new Money('10000000000', 'USD')).toThrow('range');
    expect(() => new Money('-0.01', 'USD')).toThrow('range');
  });
  it('rounds per-unit product discounts in the currency unit', () => {
    expect(
      calculateEffectivePrice(
        '0.015',
        { ...none, type: 'PERCENTAGE', value: '10' },
        none,
        new Date(),
        'KWD',
      ).finalPrice,
    ).toBe('0.013');
    expect(
      calculateEffectivePrice(
        '10',
        { ...none, type: 'PERCENTAGE', value: '15' },
        none,
        new Date(),
        'JPY',
      ).finalPrice,
    ).toBe('8');
  });
  it('caps exact fixed discounts to the unit price', () => {
    const result = calculateEffectivePrice(
      '0.001',
      { ...none, type: 'FIXED_AMOUNT', value: '0.002' },
      none,
      new Date(),
      'KWD',
    );
    expect(result.finalPrice).toBe('0.000');
    expect(result.discountAmount).toBe('0.001');
  });
  it.each([true, false])(
    'calculates inclusive=%s tax exactly at minor-unit boundaries',
    (inclusive) => {
      const result = calculateTax({
        amountCents: 1001n,
        rateBasisPoints: 500n,
        pricesIncludeTax: inclusive,
        treatment: 'STANDARD',
        taxCategoryId: 'category',
        taxCategoryCode: 'STD',
        taxRuleId: 'rule',
      });
      expect(result.taxAmountCents).toBe(inclusive ? 48n : 50n);
      expect(result.taxableAmountCents + result.taxAmountCents).toBe(
        result.grossAmountCents,
      );
    },
  );
  it('allocates rounding residues deterministically without losing minor units', () => {
    expect(
      allocateCouponDiscount(
        [
          { key: 'b', amountCents: 1n },
          { key: 'a', amountCents: 1n },
          { key: 'c', amountCents: 1n },
        ],
        2n,
      ),
    ).toEqual([1n, 1n, 0n]);
  });
});

describe('malformed monetary API inputs remain validation errors', () => {
  it('rejects malformed catalog prices/discounts and filters without throwing', async () => {
    const { createProductSchema, productListQuerySchema } =
      await import('../../src/modules/products/product.schemas.js');
    expect(
      createProductSchema.safeParse({
        name: 'Invalid',
        slug: 'invalid',
        categoryId: crypto.randomUUID(),
        basePrice: 'garbage',
        discount: { type: 'PERCENTAGE', value: 'garbage' },
      }).success,
    ).toBe(false);
    expect(
      productListQuerySchema.safeParse({ minPrice: 'garbage', maxPrice: '10' })
        .success,
    ).toBe(false);
  });
  it('rejects malformed coupon amounts without throwing', async () => {
    const { createCouponSchema } =
      await import('../../src/modules/coupons/coupon.schemas.js');
    expect(
      createCouponSchema.safeParse({
        code: 'INVALID',
        discountType: 'PERCENTAGE',
        discountValue: 'garbage',
        minimumOrderAmount: 'garbage',
      }).success,
    ).toBe(false);
  });
});
