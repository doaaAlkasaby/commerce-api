import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { TaxRepository } from '../../common/tax/tax.repository.js';
import { TaxService } from '../../common/tax/tax.service.js';
import {
  currencyPrecision,
  isCurrencyCode,
} from '../../common/pricing/currency.js';
import {
  calculateSkip,
  createPagination,
} from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { specialPaymentMethod } from './special-order.schemas.js';
import { specialProviderAccount } from './special-order-provider.js';

const configurationSchema = z.object({
  cashEnabled: z.boolean().default(true),
  pickupLocations: z.array(z.unknown()).max(100).default([]),
});
export async function readSpecialCheckoutConfiguration(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  const row = await tx.appSetting.findUnique({
    where: { tenantId_key: { tenantId, key: 'special_checkout' } },
    select: { value: true },
  });
  return configurationSchema.parse(row?.value ?? {});
}

const market = (tenantId: string) =>
  prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { defaultCurrency: true, defaultCountryCode: true },
  });

export async function quotationPaymentCapabilities(tenantId: string) {
  const [
    { defaultCurrency: currency, defaultCountryCode: countryCode },
    { cashEnabled },
  ] = await Promise.all([
    market(tenantId),
    readSpecialCheckoutConfiguration(prisma, tenantId),
  ]);
  const configured = !!countryCode && !!currency && isCurrencyCode(currency);
  const account =
    configured &&
    (env.PAYMENT_PROVIDER !== 'MYFATOORAH' ||
      (env.MYFATOORAH_ENV ?? 'sandbox') === 'sandbox') &&
    !(
      env.PAYMENT_PROVIDER === 'MOCK' &&
      (env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production')
    )
      ? await specialProviderAccount(prisma, tenantId, countryCode!, currency!)
      : null;
  return {
    market: { countryCode, currency },
    providerEnvironment: account?.account.environment ?? null,
    checkoutRevalidationRequired: true,
    terms: specialPaymentMethod.options.map((method) => {
      const needsCash =
        method === 'CASH_ON_FULFILLMENT' || method === 'DEPOSIT_REMAINING_CASH';
      const reason = !configured
        ? 'SPECIAL_QUOTATION_MARKET_REQUIRED'
        : needsCash && !cashEnabled
          ? 'SPECIAL_CHECKOUT_CASH_DISABLED'
          : method !== 'CASH_ON_FULFILLMENT' && !account
            ? 'SPECIAL_PAYMENT_PROVIDER_UNAVAILABLE'
            : null;
      return {
        method,
        canOffer: reason === null,
        reason,
        deposit: method.startsWith('DEPOSIT_')
          ? {
              fixed: {
                currency,
                fractionDigits: configured
                  ? Math.min(4, currencyPrecision(currency!))
                  : null,
                maxIntegerDigits: 10,
                exclusiveMinimum: '0',
              },
              percentage: {
                exclusiveMinimum: '0',
                maximum: '100',
                fractionDigits: 2,
                base: 'PRODUCTS_INCLUDING_TAX',
              },
              shippingAllocation: 'REMAINING_BALANCE',
              sourcingFeeAllocation: 'REMAINING_BALANCE',
            }
          : null,
      };
    }),
  };
}

export async function quotationTaxCategories(
  tenantId: string,
  page: number,
  limit: number,
) {
  const { defaultCurrency: currency, defaultCountryCode: countryCode } =
    await market(tenantId);
  const where = { tenantId };
  const [categories, total] = await prisma.$transaction([
    prisma.taxCategory.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        treatment: true,
        isActive: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: calculateSkip(page, limit),
      take: limit,
    }),
    prisma.taxCategory.count({ where }),
  ]);
  const resolver = new TaxService(new TaxRepository(prisma), true);
  const now = new Date();
  const items = [];
  for (const category of categories) {
    let reason: string | null = null;
    if (!category.isActive) reason = 'TAX_CATEGORY_NOT_CONFIGURED';
    else if (!countryCode || !currency || !isCurrencyCode(currency))
      reason = 'SPECIAL_QUOTATION_MARKET_REQUIRED';
    else {
      try {
        await resolver.calculateForAmount({
          tenantId,
          scopeKey: tenantId,
          currency,
          now,
          address: { countryCode },
          amountCents: 0n,
          category: { productTaxCategoryId: category.id },
        });
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          ![
            'TAX_PROFILE_NOT_CONFIGURED',
            'TAX_RULE_NOT_CONFIGURED',
            'TAX_CATEGORY_NOT_CONFIGURED',
            'TAX_CURRENCY_MISMATCH',
            'TAX_PROFILE_AMBIGUOUS',
          ].includes(error.code)
        )
          throw error;
        reason = error.code;
      }
    }
    items.push({ ...category, selectable: reason === null, reason });
  }
  return {
    market: { countryCode, currency },
    allowsInherited: true,
    items,
    pagination: createPagination(page, limit, total),
  };
}
