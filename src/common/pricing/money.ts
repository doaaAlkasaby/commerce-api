import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import { currencyPrecision, normalizeCurrency } from './currency.js';

// Preserve the historical ten-digit major-unit ceiling; four fractional digits
// cover all numeric minor-unit definitions in the versioned ISO catalog.
export const MAX_MONEY = '9999999999.9999';
export const CALCULATION_DECIMAL_PLACES = 24;
export const MONEY_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;
const CalculationDecimal = Prisma.Decimal.clone({
  precision: 96,
  rounding: MONEY_ROUNDING,
});

export function parseDecimal(value: string): Prisma.Decimal {
  if (value.length > 64 || !/^-?\d+(\.\d+)?$/.test(value))
    throw new AppError(
      'Invalid decimal amount',
      400,
      'INVALID_MONETARY_AMOUNT',
    );
  const decimal = new CalculationDecimal(value);
  if (
    decimal.decimalPlaces() > 24 ||
    decimal.abs().gte('1000000000000000000000000')
  )
    throw new AppError(
      'Decimal exceeds calculation precision',
      400,
      'MONETARY_AMOUNT_OUT_OF_RANGE',
    );
  return decimal;
}

export function validateAmount(
  value: string,
  currency: string,
): Prisma.Decimal {
  const amount = parseDecimal(value);
  if (amount.isNegative() || amount.gt(MAX_MONEY))
    throw new AppError(
      'Amount exceeds supported range',
      400,
      'MONETARY_AMOUNT_OUT_OF_RANGE',
    );
  if (amount.decimalPlaces() > currencyPrecision(currency))
    throw new AppError(
      'Amount precision does not match currency',
      400,
      'INVALID_MONETARY_PRECISION',
    );
  return amount;
}

export function toMinorUnits(value: string, currency: string): bigint {
  return BigInt(
    validateAmount(value, currency)
      .mul(new CalculationDecimal(10).pow(currencyPrecision(currency)))
      .toFixed(0),
  );
}

export function fromMinorUnits(value: bigint, currency: string): string {
  const scale = currencyPrecision(currency);
  const factor = 10n ** BigInt(scale);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / factor}${scale ? '.' + (absolute % factor).toString().padStart(scale, '0') : ''}`;
}

export function quantize(value: string, currency: string): string {
  const rounded = parseDecimal(value).toDecimalPlaces(
    currencyPrecision(currency),
    MONEY_ROUNDING,
  );
  validateAmount(rounded.toFixed(), currency);
  return rounded.toFixed(currencyPrecision(currency));
}

export class Money {
  readonly currency: string;
  readonly amount: Prisma.Decimal;
  constructor(value: string, currency: string) {
    this.currency = normalizeCurrency(currency);
    this.amount = validateAmount(value, this.currency);
  }
  private compatible(other: Money): void {
    if (this.currency !== other.currency)
      throw new AppError(
        'Currency mismatch; conversion is disabled',
        400,
        'MONEY_CURRENCY_MISMATCH',
      );
  }
  add(other: Money): Money {
    this.compatible(other);
    return new Money(this.amount.add(other.amount).toFixed(), this.currency);
  }
  subtract(other: Money): Money {
    this.compatible(other);
    return new Money(this.amount.sub(other.amount).toFixed(), this.currency);
  }
  multiply(factor: string): string {
    return this.amount.mul(parseDecimal(factor)).toFixed();
  }
  divide(divisor: string): string {
    const denominator = parseDecimal(divisor);
    if (denominator.lte(0))
      throw new AppError(
        'Divisor must be positive',
        400,
        'INVALID_MONETARY_DIVISOR',
      );
    return this.amount
      .div(denominator)
      .toDecimalPlaces(CALCULATION_DECIMAL_PLACES, MONEY_ROUNDING)
      .toFixed();
  }
  compare(other: Money): number {
    this.compatible(other);
    return this.amount.comparedTo(other.amount);
  }
  serialize(): string {
    return this.amount.toFixed(currencyPrecision(this.currency));
  }
}
