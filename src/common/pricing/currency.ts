import { AppError } from '../errors/app-error.js';
import { CURRENCY_MINOR_UNITS } from './currency-catalog.js';

export const isCurrencyCode = (currency: string): boolean =>
  /^[A-Z]{3}$/.test(currency) &&
  CURRENCY_MINOR_UNITS[currency] !== undefined &&
  (CURRENCY_MINOR_UNITS[currency] ?? 5) <= 4;

export function normalizeCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!isCurrencyCode(code))
    throw new AppError(
      'Unsupported ISO 4217 currency metadata',
      400,
      'INVALID_CURRENCY',
    );
  return code;
}

export function currencyPrecision(currency: string): number {
  const precision = CURRENCY_MINOR_UNITS[normalizeCurrency(currency)];
  if (precision === undefined)
    throw new AppError(
      'Currency precision is unavailable',
      400,
      'INVALID_CURRENCY',
    );
  return precision;
}
