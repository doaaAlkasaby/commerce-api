import type { PrismaClient } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';
import { AppError } from '../errors/app-error.js';
import { normalizeCurrency } from './currency.js';
import { validateAmount, parseDecimal } from './money.js';

export async function tenantCurrency(
  tenantId: string,
  client: PrismaClient = prisma,
): Promise<string> {
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultCurrency: true },
  });
  if (!tenant?.defaultCurrency)
    throw new AppError(
      'Tenant currency is not configured',
      400,
      'TENANT_CURRENCY_NOT_CONFIGURED',
    );
  return normalizeCurrency(tenant.defaultCurrency);
}

export async function validateTenantAmounts(
  tenantId: string,
  values: Array<string | null | undefined>,
  client: PrismaClient = prisma,
): Promise<void> {
  if (values.every((value) => value === undefined || value === null)) return;
  const currency = await tenantCurrency(tenantId, client);
  for (const value of values)
    if (value !== undefined && value !== null) validateAmount(value, currency);
}

export function validatePercentage(value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  const rate = parseDecimal(value);
  if (rate.lte(0) || rate.gt(100) || rate.decimalPlaces() > 2)
    throw new AppError(
      'Percentage must be positive, at most 100 and have at most two decimals',
      400,
      'INVALID_DISCOUNT',
    );
}
