import { describe, expect, it } from 'vitest';
import { isCurrencyCode } from '../../src/common/pricing/currency.js';
import { updateTenantSchema } from '../../src/modules/tenants/tenant.schemas.js';

describe('tenant currency configuration', () => {
  it('accepts supported ISO codes and rejects invented or malformed codes', () => {
    for (const code of ['EGP', 'USD', 'SAR'])
      expect(isCurrencyCode(code)).toBe(true);
    for (const code of ['ZZZ', 'usd', '12!', ''])
      expect(isCurrencyCode(code)).toBe(false);
  });

  it('preserves existing tenant input normalization while validating the ISO code', () => {
    expect(
      updateTenantSchema.parse({ defaultCurrency: ' egp ' }).defaultCurrency,
    ).toBe('EGP');
    expect(
      updateTenantSchema.safeParse({ defaultCurrency: 'ZZZ' }).success,
    ).toBe(false);
    expect(
      updateTenantSchema.parse({ defaultCurrency: null }).defaultCurrency,
    ).toBeNull();
  });
});
