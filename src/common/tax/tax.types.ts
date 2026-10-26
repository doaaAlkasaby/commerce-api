import type {
  TaxTreatment,
} from '../../generated/prisma/client.js';

export interface TaxCalculationInput {
  amountCents: bigint;

  pricesIncludeTax: boolean;

  treatment: TaxTreatment;

  rateBasisPoints: bigint;

  taxCategoryId: string;

  taxCategoryCode: string;

  taxRuleId: string;
}

export interface TaxCalculationResult {
  taxableAmountCents: bigint;

  taxAmountCents: bigint;

  grossAmountCents: bigint;

  rateBasisPoints: bigint;

  treatment: TaxTreatment;

  pricesIncludeTax: boolean;

  taxCategoryId: string;

  taxCategoryCode: string;

  taxRuleId: string;
}

export interface TaxAddress {
  countryCode: string;

  regionCode?: string | null;
}

export interface ResolveTaxCategoryInput {
  variantTaxCategoryId?: string | null;

  productTaxCategoryId?: string | null;

  defaultTaxCategoryId?: string | null;
}

export interface TaxRuleResolutionInput {
  taxCategoryId: string;

  countryCode: string;

  regionCode?: string | null;

  now?: Date;
}

export interface TaxRuleResult {
  id: string;

  taxCategoryId: string;

  taxCategoryCode: string;

  countryCode: string;

  regionCode: string | null;

  rateBasisPoints: bigint;

  treatment: TaxTreatment;
}