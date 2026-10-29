import { describe, expect, it } from 'vitest';
import { calculateTax } from '../../src/common/tax/tax.calculator.js';
import { allocateCouponDiscount } from '../../src/common/tax/tax.allocation.js';
import type { TaxCalculationInput } from '../../src/common/tax/tax.types.js';

const base: TaxCalculationInput = {
  amountCents: 10000n,
  pricesIncludeTax: false,
  treatment: 'STANDARD',
  rateBasisPoints: 1000n,
  taxCategoryId: 'category',
  taxCategoryCode: 'STANDARD',
  taxRuleId: 'rule',
};

describe('tax exact arithmetic (Point 13)', () => {
  it.each([
    [10000n, 1000n, false, 10000n, 1000n, 11000n],
    [11000n, 1000n, true, 10000n, 1000n, 11000n],
    [1n, 5000n, false, 1n, 1n, 2n],
    [1n, 10000n, true, 0n, 1n, 1n],
    [3n, 10000n, true, 1n, 2n, 3n],
    [0n, 10000n, false, 0n, 0n, 0n],
    [10000n, 0n, true, 10000n, 0n, 10000n],
    [99999999999n, 1n, false, 99999999999n, 10000000n, 100009999999n],
  ])(
    'calculates %s cents at %s basis points (inclusive %s) exactly',
    (
      amountCents,
      rateBasisPoints,
      pricesIncludeTax,
      taxableAmountCents,
      taxAmountCents,
      grossAmountCents,
    ) => {
      expect(
        calculateTax({
          ...base,
          amountCents,
          rateBasisPoints,
          pricesIncludeTax,
        }),
      ).toMatchObject({ taxableAmountCents, taxAmountCents, grossAmountCents });
    },
  );
  it('preserves exact arithmetic beyond JavaScript Number integer precision', () => {
    expect(
      calculateTax({
        ...base,
        amountCents: 9007199254740993n,
        rateBasisPoints: 100n,
      }),
    ).toMatchObject({
      taxableAmountCents: 9007199254740993n,
      taxAmountCents: 90071992547410n,
      grossAmountCents: 9097271247288403n,
    });
  });
  it.each(['EXEMPT', 'ZERO_RATED'] as const)(
    'does not tax %s categories in either mode',
    (treatment) => {
      for (const pricesIncludeTax of [true, false])
        expect(
          calculateTax({ ...base, treatment, pricesIncludeTax }),
        ).toMatchObject({
          taxableAmountCents: 10000n,
          taxAmountCents: 0n,
          grossAmountCents: 10000n,
        });
    },
  );
  it.each([
    { amountCents: -1n },
    { rateBasisPoints: -1n },
    { rateBasisPoints: 10001n },
  ])('rejects invalid calculation inputs case %#', (patch) => {
    expect(() => calculateTax({ ...base, ...patch })).toThrow();
  });
  it('allocates the last cent to a nonzero line and is independent of input ordering', () => {
    const lines = [
      { key: 'b', amountCents: 1n },
      { key: 'a', amountCents: 1n },
      { key: 'z', amountCents: 0n },
    ];
    expect(allocateCouponDiscount(lines, 1n)).toEqual([0n, 1n, 0n]);
    expect(allocateCouponDiscount([...lines].reverse(), 1n)).toEqual([
      0n,
      1n,
      0n,
    ]);
  });
  it('keeps every allocation bounded and conserves every discount across uneven small baskets', () => {
    for (let first = 0n; first <= 9n; first++)
      for (let second = 0n; second <= 9n; second++) {
        const lines = [
          { key: 'a', amountCents: first },
          { key: 'b', amountCents: second },
          { key: 'c', amountCents: 0n },
        ];
        for (let discount = 0n; discount <= first + second; discount++) {
          const shares = allocateCouponDiscount(lines, discount);
          expect(shares.reduce((sum, n) => sum + n, 0n)).toBe(discount);
          for (let i = 0; i < shares.length; i++) {
            expect(shares[i]! >= 0n).toBe(true);
            expect(shares[i]! <= lines[i]!.amountCents).toBe(true);
          }
        }
      }
  });
  it('rejects invalid allocation totals instead of generating a negative taxable base', () => {
    expect(() =>
      allocateCouponDiscount([{ key: 'a', amountCents: 1n }], 2n),
    ).toThrow();
    expect(() =>
      allocateCouponDiscount([{ key: 'a', amountCents: -1n }], 0n),
    ).toThrow();
    expect(() =>
      allocateCouponDiscount([{ key: 'a', amountCents: 1n }], -1n),
    ).toThrow();
  });
});
