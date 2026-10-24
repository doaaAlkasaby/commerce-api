import type { DiscountInput, EffectivePrice } from './pricing.types.js';
import type { DiscountType } from '../../generated/prisma/client.js';

/**
 * Convert a monetary string into integer cents.
 *
 * Examples:
 * "100"    -> 10000n
 * "100.50" -> 10050n
 * "0.99"   -> 99n
 *
 * Monetary values are expected to have at most 2 decimal places.
 */
export const toCents = (value: string): bigint => {
  const normalized = value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(
      `Invalid monetary value: "${value}". Expected format like "10.00".`,
    );
  }

  const [whole = '0', fraction = ''] = normalized.split('.');

  const paddedFraction = fraction.padEnd(2, '0');

  return BigInt(whole) * 100n + BigInt(paddedFraction);
};

/**
 * Convert integer cents back to a monetary string.
 *
 * Examples:
 * 10000n -> "100.00"
 * 10050n -> "100.50"
 * 99n    -> "0.99"
 */
export const centsToString = (cents: bigint): string => {
  const negative = cents < 0n;

  const absolute = negative ? -cents : cents;

  const whole = absolute / 100n;
  const fraction = absolute % 100n;

  return `${negative ? '-' : ''}${whole}.${fraction
    .toString()
    .padStart(2, '0')}`;
};

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
): bigint => {
  const amount =
    type === 'FIXED_AMOUNT'
      ? toCents(value)
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
): EffectivePrice => {
  const baseCents = toCents(basePrice);

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
      basePrice: centsToString(baseCents),
      discountType: null,
      discountValue: '0.00',
      discountAmount: '0.00',
      finalPrice: centsToString(baseCents),
    };
  }

  /**
   * Calculate discount for ONE unit.
   */
  const discountAmount = calculateDiscountAmount(
    baseCents,
    selectedDiscount.type,
    selectedDiscount.value,
  );

  /**
   * Final price can never become negative.
   */
  const finalCents = baseCents - discountAmount;

  return {
    basePrice: centsToString(baseCents),

    discountType: selectedDiscount.type,

    discountValue: selectedDiscount.value ?? '0.00',

    discountAmount: centsToString(discountAmount),

    finalPrice: centsToString(finalCents),
  };
};
