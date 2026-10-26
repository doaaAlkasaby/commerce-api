import type {
  TaxCalculationInput,
  TaxCalculationResult,
} from './tax.types.js';

const BASIS_POINTS = 10_000n;

export function calculateTax(
  input: TaxCalculationInput,
): TaxCalculationResult {
  if (input.amountCents < 0n) {
    throw new Error(
      'Tax calculation amount cannot be negative.',
    );
  }

  if (input.rateBasisPoints < 0n) {
    throw new Error(
      'Tax rate cannot be negative.',
    );
  }

  if (
    input.rateBasisPoints >
    BASIS_POINTS
  ) {
    throw new Error(
      'Tax rate cannot exceed 100%.',
    );
  }

  if (
    input.treatment === 'ZERO_RATED' ||
    input.treatment === 'EXEMPT'
  ) {
    return {
      taxableAmountCents: input.amountCents,

      taxAmountCents: 0n,

      grossAmountCents: input.amountCents,

      rateBasisPoints:
        input.rateBasisPoints,

      treatment: input.treatment,

      pricesIncludeTax:
        input.pricesIncludeTax,

      taxCategoryId:
        input.taxCategoryId,

      taxCategoryCode:
        input.taxCategoryCode,

      taxRuleId:
        input.taxRuleId,
    };
  }

  if (input.pricesIncludeTax) {
    return calculateInclusiveTax(input);
  }

  return calculateExclusiveTax(input);
}

function calculateExclusiveTax(
  input: TaxCalculationInput,
): TaxCalculationResult {
  const taxAmountCents =
    divideHalfUp(
      input.amountCents *
        input.rateBasisPoints,
      BASIS_POINTS,
    );

  const grossAmountCents =
    input.amountCents +
    taxAmountCents;

  return {
    taxableAmountCents:
      input.amountCents,

    taxAmountCents,

    grossAmountCents,

    rateBasisPoints:
      input.rateBasisPoints,

    treatment: input.treatment,

    pricesIncludeTax:
      input.pricesIncludeTax,

    taxCategoryId:
      input.taxCategoryId,

    taxCategoryCode:
      input.taxCategoryCode,

    taxRuleId:
      input.taxRuleId,
  };
}

function calculateInclusiveTax(
  input: TaxCalculationInput,
): TaxCalculationResult {
  const denominator =
    BASIS_POINTS +
    input.rateBasisPoints;

  const taxAmountCents =
    divideHalfUp(
      input.amountCents *
        input.rateBasisPoints,
      denominator,
    );

  const taxableAmountCents =
    input.amountCents -
    taxAmountCents;

  return {
    taxableAmountCents,

    taxAmountCents,

    grossAmountCents:
      input.amountCents,

    rateBasisPoints:
      input.rateBasisPoints,

    treatment: input.treatment,

    pricesIncludeTax:
      input.pricesIncludeTax,

    taxCategoryId:
      input.taxCategoryId,

    taxCategoryCode:
      input.taxCategoryCode,

    taxRuleId:
      input.taxRuleId,
  };
}

function divideHalfUp(
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator <= 0n) {
    throw new Error(
      'Tax calculation denominator must be positive.',
    );
  }

  const quotient =
    numerator / denominator;

  const remainder =
    numerator % denominator;

  if (
    remainder * 2n >=
    denominator
  ) {
    return quotient + 1n;
  }

  return quotient;
}