import { percentageToBasisPoints } from '../pricing/pricing.service.js';
import type { TaxProfileSnapshot, TaxRuleSnapshot } from './tax.types.js';
import { AppError } from '../errors/app-error.js';

import { calculateTax } from './tax.calculator.js';

import type {
  ResolveTaxCategoryInput,
  TaxAddress,
  TaxCalculationResult,
} from './tax.types.js';

import type { TaxRepository } from './tax.repository.js';

export class TaxService {
  private readonly profiles = new Map<
    string,
    ReturnType<TaxRepository['findTaxProfile']>
  >();
  private readonly rules = new Map<
    string,
    ReturnType<TaxRepository['findTaxRule']>
  >();
  constructor(
    private readonly repository: TaxRepository,
    private readonly cacheResolution = false,
  ) {}

  async getTaxProfile(
    tenantId: string,
    countryCode: string,
    regionCode?: string | null,
  ) {
    const key = JSON.stringify([
      tenantId,
      countryCode,
      regionCode?.trim().toUpperCase() || null,
    ]);
    let pending = this.cacheResolution ? this.profiles.get(key) : undefined;
    if (!pending) {
      pending = this.repository.findTaxProfile(
        tenantId,
        countryCode,
        regionCode,
      );
      if (this.cacheResolution) this.profiles.set(key, pending);
    }
    const profile = await pending;
    if (!profile)
      throw new AppError(
        'Tax profile is not configured.',
        400,
        'TAX_PROFILE_NOT_CONFIGURED',
      );
    return profile;
  }

  async calculateForAmount(input: {
    tenantId: string;
    currency: string;
    scopeKey: string;

    amountCents: bigint;

    address: TaxAddress;

    category: ResolveTaxCategoryInput;

    now?: Date;
  }): Promise<
    TaxCalculationResult & {
      profileSnapshot: TaxProfileSnapshot;
      ruleSnapshot: TaxRuleSnapshot;
    }
  > {
    const profile = await this.getTaxProfile(
      input.tenantId,
      input.address.countryCode,
      input.address.regionCode,
    );

    if (profile.currency !== input.currency) {
      throw new AppError(
        'Tax profile currency does not match the tenant currency.',
        500,
        'TAX_CURRENCY_MISMATCH',
      );
    }

    const taxCategoryId = this.resolveTaxCategory(
      input.category,
      profile.defaultTaxCategory?.id,
    );

    const key = JSON.stringify([
      input.tenantId,
      taxCategoryId,
      input.address.countryCode,
      input.address.regionCode?.trim().toUpperCase() || null,
      input.now?.toISOString() ?? null,
    ]);
    let pending = this.cacheResolution ? this.rules.get(key) : undefined;
    if (!pending) {
      pending = this.repository.findTaxRule(input.tenantId, {
        taxCategoryId,
        countryCode: input.address.countryCode,
        ...(input.address.regionCode === undefined
          ? {}
          : { regionCode: input.address.regionCode }),
        ...(input.now === undefined ? {} : { now: input.now }),
      });
      if (this.cacheResolution) this.rules.set(key, pending);
    }
    const rule = await pending;
    if (!rule) {
      throw new AppError(
        'Tax rule is not configured for this destination.',
        400,
        'TAX_RULE_NOT_CONFIGURED',
      );
    }

    if (!rule.taxCategory.isActive) {
      throw new AppError(
        'Tax category is inactive.',
        400,
        'TAX_CATEGORY_NOT_CONFIGURED',
      );
    }

    const rateBasisPoints = decimalRateToBasisPoints(rule.rate);

    const result = calculateTax({
      amountCents: input.amountCents,

      pricesIncludeTax: profile.pricesIncludeTax,

      treatment: rule.taxCategory.treatment,

      rateBasisPoints,

      taxCategoryId: rule.taxCategory.id,

      taxCategoryCode: rule.taxCategory.code,

      taxRuleId: rule.id,
    });
    return {
      ...result,
      ruleSnapshot: {
        id: rule.id,
        countryCode: rule.countryCode,
        regionCode: rule.regionCode,
        priority: rule.priority,
        effectiveFrom: rule.effectiveFrom?.toISOString() ?? null,
        effectiveTo: rule.effectiveTo?.toISOString() ?? null,
      },
      profileSnapshot: {
        profileId: profile.id,
        countryCode: profile.countryCode,
        profileRegionCode: profile.regionCode,
        currency: profile.currency,
        pricesIncludeTax: profile.pricesIncludeTax,
        isTaxRegistered: profile.isTaxRegistered,
        taxRegistrationNumber: profile.taxRegistrationNumber,
      },
    };
  }

  private resolveTaxCategory(
    input: ResolveTaxCategoryInput,
    defaultTaxCategoryId?: string,
  ): string {
    if (input.variantTaxCategoryId) {
      return input.variantTaxCategoryId;
    }

    if (input.productTaxCategoryId) {
      return input.productTaxCategoryId;
    }

    if (defaultTaxCategoryId) {
      return defaultTaxCategoryId;
    }

    throw new AppError(
      'No tax category is configured.',
      400,
      'TAX_CATEGORY_NOT_CONFIGURED',
    );
  }
}

function decimalRateToBasisPoints(value: { toString(): string }): bigint {
  try {
    return percentageToBasisPoints(value.toString());
  } catch {
    throw new AppError(
      'Tax rate must be between 0 and 100 percent with at most two decimals.',
      500,
      'INVALID_TAX_RATE',
    );
  }
}
