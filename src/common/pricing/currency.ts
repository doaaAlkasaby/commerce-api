// Intl.NumberFormat accepts invented three-letter codes. Check the runtime's
// ISO 4217 currency list instead, without adding a currency dependency.
const currencyCodes = new Set(Intl.supportedValuesOf('currency'));

export const isCurrencyCode = (currency: string): boolean =>
  /^[A-Z]{3}$/.test(currency) && currencyCodes.has(currency);
