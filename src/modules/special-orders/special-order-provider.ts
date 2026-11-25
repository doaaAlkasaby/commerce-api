import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry.js';

export async function specialProviderAccount(
  tx: Prisma.TransactionClient,
  tenantId: string,
  countryCode: string,
  currency: string,
) {
  if (
    env.PAYMENT_PROVIDER === 'NONE' ||
    countryCode !== 'KW' ||
    currency !== 'KWD'
  )
    return null;
  const environment = env.PAYMENT_PROVIDER === 'MOCK' ? 'MOCK' : 'SANDBOX';
  const authorized = { tenantId, isActive: true, revokedAt: null };
  const accounts = await tx.paymentProviderAccount.findMany({
    where: {
      provider: 'MYFATOORAH',
      environment,
      countryCode: 'KWT',
      currency,
      status: 'ACTIVE',
      ...(environment === 'SANDBOX'
        ? { credentialRef: 'env:MYFATOORAH_API_TOKEN' }
        : { tenantAuthorizations: { some: authorized } }),
    },
    select: {
      id: true,
      provider: true,
      environment: true,
      credentialVersion: true,
      tenantAuthorizations: { where: authorized, select: { tenantId: true } },
    },
    take: 2,
  });
  // Sandbox uses one configured credential. Its account identity must be
  // unambiguous across tenants before checking the tenant's authorization.
  if (accounts.length !== 1 || !accounts[0]?.tenantAuthorizations.length)
    return null;
  const { tenantAuthorizations, ...account } = accounts[0];
  const adapter = new PaymentProviderRegistry().getProvider('MYFATOORAH');
  return adapter.getPaymentStatus ? { account, adapter } : null;
}

export function unavailableProvider(): never {
  throw new AppError(
    'Special Order online payment is unavailable for this provider account',
    409,
    'SPECIAL_PAYMENT_PROVIDER_UNAVAILABLE',
  );
}

export function specialOrderMarket(terms: Prisma.JsonValue) {
  return terms &&
    typeof terms === 'object' &&
    !Array.isArray(terms) &&
    typeof terms.taxCountryCode === 'string'
    ? terms.taxCountryCode
    : '';
}
