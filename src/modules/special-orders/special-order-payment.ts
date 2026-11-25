import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { fromMinorUnits, toMinorUnits } from '../../common/pricing/money.js';
import { percentageToBasisPoints } from '../../common/pricing/pricing.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { specialProviderAccount } from './special-order-provider.js';
import { quotationPaymentTerms } from './special-order.schemas.js';

type PaymentTerms = z.infer<typeof quotationPaymentTerms>;
const legacyTerms: PaymentTerms = [{ method: 'CASH_ON_FULFILLMENT' }];

export function readPaymentTerms(value: unknown): PaymentTerms {
  return value == null ? legacyTerms : quotationPaymentTerms.parse(value);
}

export function disclosePaymentTerms(value: unknown) {
  return readPaymentTerms(value).map((term) =>
    'deposit' in term
      ? ({
          ...term,
          percentageBase: 'PRODUCTS_INCLUDING_TAX',
          shippingAllocation: 'REMAINING_BALANCE',
          sourcingFeeAllocation: 'REMAINING_BALANCE',
        } as const)
      : term,
  );
}

function invalidDeposit(): never {
  throw new AppError(
    'The quotation deposit is invalid for these financial terms',
    409,
    'SPECIAL_ORDER_INVALID_DEPOSIT',
  );
}

export function validatePaymentTerms(
  terms: PaymentTerms | undefined,
  currency: string,
) {
  for (const term of terms ?? []) {
    if (!('deposit' in term)) continue;
    try {
      const value =
        term.deposit.type === 'FIXED'
          ? toMinorUnits(term.deposit.amount, currency)
          : percentageToBasisPoints(term.deposit.percentage);
      if (
        value <= 0n ||
        (term.deposit.type === 'PERCENTAGE' && value > 10_000n)
      )
        invalidDeposit();
    } catch {
      invalidDeposit();
    }
  }
}

export async function paymentOptions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  countryCode: string,
  currency: string,
  terms: ReturnType<typeof disclosePaymentTerms>,
  cashEnabled: boolean,
  products: bigint,
  grandTotal: bigint,
) {
  const online = terms.some(({ method }) => method !== 'CASH_ON_FULFILLMENT')
    ? await specialProviderAccount(tx, tenantId, countryCode, currency)
    : null;
  return terms.map((term) => {
    let initialPayment =
      term.method === 'FULL_ADVANCE_ONLINE' ? grandTotal : 0n;
    if ('deposit' in term) {
      initialPayment =
        term.deposit.type === 'FIXED'
          ? toMinorUnits(term.deposit.amount, currency)
          : (products * percentageToBasisPoints(term.deposit.percentage) +
              5_000n) /
            10_000n;
      if (
        initialPayment <= 0n ||
        initialPayment > products ||
        initialPayment >= grandTotal
      )
        invalidDeposit();
    }
    const cash = term.method === 'CASH_ON_FULFILLMENT';
    let onlineEnabled = Boolean(online) && initialPayment > 0n;
    if (onlineEnabled && online) {
      try {
        online.adapter.validatePayment?.({
          amount: fromMinorUnits(initialPayment, currency),
          currency,
        });
        if (term.method === 'DEPOSIT_REMAINING_ONLINE') {
          online.adapter.validatePayment?.({
            amount: fromMinorUnits(grandTotal - initialPayment, currency),
            currency,
          });
        }
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode >= 500)
          throw error;
        onlineEnabled = false;
      }
    }
    const tenantEnabled = cash
      ? cashEnabled
      : onlineEnabled &&
        (term.method !== 'DEPOSIT_REMAINING_CASH' || cashEnabled);
    return {
      ...term,
      tenantEnabled,
      executable: tenantEnabled,
      initialPayment: fromMinorUnits(initialPayment, currency),
      remainingBalance: fromMinorUnits(grandTotal - initialPayment, currency),
    };
  });
}
