import type { DiscountInput, EffectivePrice } from './pricing.types.js';
import type { DiscountType } from '../../generated/prisma/client.js';

import { toMinorUnits, fromMinorUnits } from './money.js';

// Compatibility names retained for existing callers. Units are currency minor
// units, not necessarily cents. New production callers pass currency explicitly.
export const toCents = (value: string, currency = 'USD'): bigint =>
  toMinorUnits(value, currency);
export const centsToString = (value: bigint, currency = 'USD'): string =>
  fromMinorUnits(value, currency);

/**
 * Convert percentage value into basis points.
 *
 * Examples:
 * "10"    -> 1000n
 * "10.00" -> 1000n
 * "12.50" -> 1250n
 * "100"   -> 10000n
 *
 * 10000 basis points = 100%
 */
export const percentageToBasisPoints = (value: string): bigint => {
  const normalized = value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(
      `Invalid percentage value: "${value}". Expected format like "10.00".`,
    );
  }

  const [whole = '0', fraction = ''] = normalized.split('.');

  const normalizedFraction = fraction.padEnd(2, '0');

  const basisPoints = BigInt(whole) * 100n + BigInt(normalizedFraction || '0');

  /**
   * A percentage discount cannot exceed 100%.
   */
  if (basisPoints > 10000n) {
    throw new Error(
      `Invalid percentage discount: "${value}". Maximum is 100%.`,
    );
  }

  return basisPoints;
};

/**
 * Check whether a discount is currently active.
 */
const isDiscountActive = (discount: DiscountInput, now: Date): boolean => {
  if (discount.type === null || discount.value === null) {
    return false;
  }

  if (discount.startsAt && now < discount.startsAt) {
    return false;
  }

  if (discount.endsAt && now > discount.endsAt) {
    return false;
  }

  return true;
};

/**
 * Calculate the discount amount in cents.
 *
 * The returned value is always:
 *
 *   0 <= discountAmount <= basePrice
 */
export const calculateDiscountAmount = (
  baseCents: bigint,
  type: DiscountType,
  value: string,
  currency = 'USD',
): bigint => {
  const amount =
    type === 'FIXED_AMOUNT'
      ? toCents(value, currency)
      : (baseCents * percentageToBasisPoints(value) + 5000n) / 10000n;

  return amount > baseCents ? baseCents : amount;
};

/**
 * Calculate the effective price of a product/variant.
 *
 * Pricing rules:
 *
 * 1. basePrice is the actual pricing base.
 * 2. Active variant discount has priority.
 * 3. If variant discount is not active,
 *    active product discount is used.
 * 4. If neither discount is active,
 *    the original price is returned.
 * 5. Discount amount is calculated per unit.
 * 6. Discount is never greater than the base price.
 *
 * IMPORTANT:
 *
 * basePrice should already represent the correct price:
 *
 * variant.price ?? product.price
 *
 * Example:
 *
 * product.price = 100.00
 * variant.price = 120.00
 * variant discount = 10%
 *
 * result:
 *
 * basePrice     = 120.00
 * discount      = 12.00
 * finalPrice    = 108.00
 */
export const calculateEffectivePrice = (
  basePrice: string,
  productDiscount: DiscountInput,
  variantDiscount: DiscountInput,
  now = new Date(),
  currency = 'USD',
): EffectivePrice => {
  const baseCents = toCents(basePrice, currency);

  /**
   * Variant discount has priority over
   * product discount.
   */
  let selectedDiscount: DiscountInput | null = null;

  if (isDiscountActive(variantDiscount, now)) {
    selectedDiscount = variantDiscount;
  } else if (isDiscountActive(productDiscount, now)) {
    selectedDiscount = productDiscount;
  }

  /**
   * No active discount.
   */
  if (
    !selectedDiscount ||
    selectedDiscount.type === null ||
    selectedDiscount.value === null
  ) {
    return {
      basePrice: centsToString(baseCents, currency),
      discountType: null,
      discountValue: '0.00',
      discountAmount: centsToString(0n, currency),
      finalPrice: centsToString(baseCents, currency),
    };
  }

  /**
   * Calculate discount for ONE unit.
   */
  const discountAmount = calculateDiscountAmount(
    baseCents,
    selectedDiscount.type,
    selectedDiscount.value,
    currency,
  );

  /**
   * Final price can never become negative.
   */
  const finalCents = baseCents - discountAmount;

  return {
    basePrice: centsToString(baseCents, currency),

    discountType: selectedDiscount.type,

    discountValue: selectedDiscount.value ?? '0.00',

    discountAmount: centsToString(discountAmount, currency),

    finalPrice: centsToString(finalCents, currency),
  };
};

/** Checkout coupon policy: truncate a percentage discount once at order level. */
export const calculateCouponPercentageDiscount = (
  amount: bigint,
  basisPoints: bigint,
): bigint => (amount * basisPoints) / 10000n;
