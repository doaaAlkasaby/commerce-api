import { AppError } from '../../common/errors/app-error.js';

export const SIMILAR_PRODUCTS_SETTING_KEY = 'show_similar_products';
export const COMPLEMENTARY_PRODUCTS_SETTING_KEY = 'show_complementary_products';
export const CART_RECOMMENDATIONS_SETTING_KEY = 'show_cart_recommendations';

export type StrictBooleanStorefrontSettingKey =
  | typeof SIMILAR_PRODUCTS_SETTING_KEY
  | typeof COMPLEMENTARY_PRODUCTS_SETTING_KEY
  | typeof CART_RECOMMENDATIONS_SETTING_KEY;

export function isStrictBooleanStorefrontSettingKey(
  key: string,
): key is StrictBooleanStorefrontSettingKey {
  return (
    key === SIMILAR_PRODUCTS_SETTING_KEY ||
    key === COMPLEMENTARY_PRODUCTS_SETTING_KEY ||
    key === CART_RECOMMENDATIONS_SETTING_KEY
  );
}

export interface SimilarProductsSettingRecord {
  value: unknown;
  isPublic: boolean;
}

/**
 * Evaluates a public boolean storefront recommendation setting for a tenant.
 *
 * Policy:
 * - Missing row (`null` / `undefined`): defaults to `true` (enabled).
 * - Public row with strict JSON boolean `true`: returns `true`.
 * - Explicit JSON boolean `false`: returns `false`.
 * - Malformed (non-boolean) or non-public legacy rows: fails closed (`false`)
 *   consistently across public app settings, storefront, and recommendations
 *   so an explicitly disabled or misconfigured store is never silently enabled.
 */
function readBooleanStorefrontSetting(
  setting: SimilarProductsSettingRecord | null | undefined,
): boolean {
  if (!setting) {
    return true;
  }

  if (!setting.isPublic) {
    return false;
  }

  return setting.value === true;
}

export function readShowSimilarProductsSetting(
  setting: SimilarProductsSettingRecord | null | undefined,
): boolean {
  return readBooleanStorefrontSetting(setting);
}

export function readShowComplementaryProductsSetting(
  setting: SimilarProductsSettingRecord | null | undefined,
): boolean {
  return readBooleanStorefrontSetting(setting);
}

export function readShowCartRecommendationsSetting(
  setting: SimilarProductsSettingRecord | null | undefined,
): boolean {
  return readBooleanStorefrontSetting(setting);
}

export function assertValidBooleanStorefrontSettingCreate(
  key: StrictBooleanStorefrontSettingKey,
  input: {
    value: unknown;
    isPublic: boolean;
  },
): void {
  if (typeof input.value !== 'boolean') {
    throw new AppError(
      `${key} value must be a JSON boolean`,
      400,
      'VALIDATION_ERROR',
    );
  }

  if (input.isPublic !== true) {
    throw new AppError(
      `${key} must be a public setting`,
      400,
      'VALIDATION_ERROR',
    );
  }
}

export function assertValidBooleanStorefrontSettingUpdateInput(
  key: StrictBooleanStorefrontSettingKey,
  input: {
    value?: unknown;
    isPublic?: boolean | undefined;
  },
): void {
  if (input.value !== undefined && typeof input.value !== 'boolean') {
    throw new AppError(
      `${key} value must be a JSON boolean`,
      400,
      'VALIDATION_ERROR',
    );
  }

  if (input.isPublic !== undefined && input.isPublic !== true) {
    throw new AppError(
      `${key} must be a public setting`,
      400,
      'VALIDATION_ERROR',
    );
  }
}

export function assertValidBooleanStorefrontSettingEffectiveState(
  key: StrictBooleanStorefrontSettingKey,
  effective: {
    value: unknown;
    isPublic: boolean;
  },
): void {
  assertValidBooleanStorefrontSettingCreate(key, effective);
}

export function assertValidSimilarProductsCreate(input: {
  value: unknown;
  isPublic: boolean;
}): void {
  assertValidBooleanStorefrontSettingCreate(SIMILAR_PRODUCTS_SETTING_KEY, input);
}

export function assertValidSimilarProductsUpdateInput(input: {
  value?: unknown;
  isPublic?: boolean | undefined;
}): void {
  assertValidBooleanStorefrontSettingUpdateInput(
    SIMILAR_PRODUCTS_SETTING_KEY,
    input,
  );
}

export function assertValidSimilarProductsEffectiveState(effective: {
  value: unknown;
  isPublic: boolean;
}): void {
  assertValidBooleanStorefrontSettingEffectiveState(
    SIMILAR_PRODUCTS_SETTING_KEY,
    effective,
  );
}
