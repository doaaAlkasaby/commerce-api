import { AppError } from '../errors/app-error.js';

// Hamilton/largest-remainder allocation: exact total, bounded lines, stable ties.
export function allocateCouponDiscount(
  lines: ReadonlyArray<{ key: string; amountCents: bigint }>,
  discountCents: bigint,
): bigint[] {
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0n);
  if (
    lines.some((line) => line.amountCents < 0n) ||
    discountCents < 0n ||
    discountCents > total
  ) {
    throw new AppError(
      'Invalid coupon allocation base',
      500,
      'INVALID_TAX_DISCOUNT_ALLOCATION',
    );
  }
  if (total === 0n) return lines.map(() => 0n);
  const shares = lines.map(
    (line) => (line.amountCents * discountCents) / total,
  );
  let remainder =
    discountCents - shares.reduce((sum, share) => sum + share, 0n);
  const ranked = lines
    .map((line, index) => ({
      index,
      key: line.key,
      fraction: (line.amountCents * discountCents) % total,
    }))
    .sort((a, b) =>
      a.fraction === b.fraction
        ? a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0
        : a.fraction > b.fraction
          ? -1
          : 1,
    );
  for (const entry of ranked) {
    if (remainder === 0n) break;
    shares[entry.index] = shares[entry.index]! + 1n;
    remainder -= 1n;
  }
  return shares;
}
