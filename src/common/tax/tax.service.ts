import {
  AppError,
} from '../errors/app-error.js';

import {
  calculateTax,
} from './tax.calculator.js';

import type {
  ResolveTaxCategoryInput,
  TaxAddress,
  TaxCalculationResult,
} from './tax.types.js';

import type {
  TaxRepository,
} from './tax.repository.js';

export class TaxService {
  constructor(
    private readonly repository: TaxRepository,
  ) {}

  async getTaxProfile(
    scopeKey: string,
  ) {
    const profile =
      await this.repository.findTaxProfile(
        scopeKey,
      );

    if (!profile) {
      throw new AppError(
        'TAX_PROFILE_NOT_CONFIGURED',
        'Tax profile is not configured.',
        400,
      );
    }

    if (
      !profile.defaultTaxCategory ||
      !profile.defaultTaxCategory.isActive
    ) {
      throw new AppError(
        'TAX_CATEGORY_NOT_CONFIGURED',
        'Default tax category is not configured.',
        400,
      );
    }

    return profile;
  }

  async calculateForAmount(input: {
    scopeKey: string;

    amountCents: bigint;

    address: TaxAddress;

    category: ResolveTaxCategoryInput;

    now?: Date;
  }): Promise<TaxCalculationResult> {
    const profile =
      await this.getTaxProfile(
        input.scopeKey,
      );

    const taxCategoryId =
      this.resolveTaxCategory(
        input.category,
        profile.defaultTaxCategory?.id,
      );

    const rule =
      await this.repository.findTaxRule({
        taxCategoryId,

        countryCode:
          input.address.countryCode,

        regionCode:
          input.address.regionCode,

        now: input.now,
      });

    if (!rule) {
      throw new AppError(
        'TAX_RULE_NOT_CONFIGURED',
        'Tax rule is not configured for this destination.',
        400,
      );
    }

    if (
      !rule.taxCategory.isActive
    ) {
      throw new AppError(
        'TAX_CATEGORY_NOT_CONFIGURED',
        'Tax category is inactive.',
        400,
      );
    }

    const rateBasisPoints =
      decimalRateToBasisPoints(
        rule.rate,
      );

    return calculateTax({
      amountCents:
        input.amountCents,

      pricesIncludeTax:
        profile.pricesIncludeTax,

      treatment:
        rule.taxCategory.treatment,

      rateBasisPoints,

      taxCategoryId:
        rule.taxCategory.id,

      taxCategoryCode:
        rule.taxCategory.code,

      taxRuleId:
        rule.id,
    });
  }

  private resolveTaxCategory(
    input: ResolveTaxCategoryInput,
    defaultTaxCategoryId?: string,
  ): string {
    if (
      input.variantTaxCategoryId
    ) {
      return input.variantTaxCategoryId;
    }

    if (
      input.productTaxCategoryId
    ) {
      return input.productTaxCategoryId;
    }

    if (defaultTaxCategoryId) {
      return defaultTaxCategoryId;
    }

    throw new AppError(
      'TAX_CATEGORY_NOT_CONFIGURED',
      'No tax category is configured.',
      400,
    );
  }
}

function decimalRateToBasisPoints(
  value: unknown,
): bigint {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(numericValue) ||
    numericValue < 0
  ) {
    throw new AppError(
      'INVALID_TAX_RATE',
      'Tax rate is invalid.',
      500,
    );
  }

  return BigInt(
    Math.round(
      numericValue * 100,
    ),
  );
}