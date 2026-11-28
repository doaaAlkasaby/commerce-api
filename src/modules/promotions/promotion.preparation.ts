import { currencyPrecision } from '../../common/pricing/currency.js';
import {
  type PromotionSelector,
  validatePromotionDraft,
} from './promotion.schemas.js';
import type {
  PromotionDefinition,
  PromotionEvaluationContext,
  PromotionSellable,
  PromotionWindow,
} from './promotion.types.js';
import { stableCompare } from './promotion.units.js';

type StoredPromotion = PromotionWindow & {
  id: string;
  tenantId: string;
  currency: string;
  titleAr: string;
  titleEn: string;
  configuration: unknown;
  audience: 'ALL' | 'FIRST_TIME' | 'RETURNING' | 'SELECTED';
  priority: number;
  perOrderLimit: number;
  perCustomerLimit: number | null;
  globalLimit: number | null;
  selectors: readonly {
    key: string;
    productId: string | null;
    variantId: string | null;
    categoryId: string | null;
    brandId: string | null;
  }[];
  customers: readonly { userId: string }[];
};

/** Prepare a trusted, tenant-scoped repository row without performing further reads. */
export function preparePromotionDefinition(
  tenantId: string,
  record: StoredPromotion,
): PromotionDefinition {
  if (record.tenantId !== tenantId)
    throw new Error('Promotion tenant mismatch');
  const selectors = record.selectors.map((row): PromotionSelector => {
    if (row.productId && row.variantId)
      return {
        kind: 'VARIANT',
        key: row.key,
        productId: row.productId,
        variantId: row.variantId,
      };
    if (row.productId)
      return { kind: 'PRODUCT', key: row.key, productId: row.productId };
    if (row.categoryId)
      return { kind: 'CATEGORY', key: row.key, categoryId: row.categoryId };
    if (row.brandId)
      return { kind: 'BRAND', key: row.key, brandId: row.brandId };
    throw new Error('Missing promotion selector target');
  });
  const draft = validatePromotionDraft(
    {
      titleAr: record.titleAr,
      titleEn: record.titleEn,
      configuration: record.configuration,
      selectors,
      audience:
        record.audience === 'SELECTED'
          ? {
              kind: 'SELECTED',
              customerIds: record.customers.map(({ userId }) => userId),
            }
          : { kind: record.audience },
      priority: record.priority,
      perOrderLimit: record.perOrderLimit,
      perCustomerLimit: record.perCustomerLimit ?? undefined,
      globalLimit: record.globalLimit ?? undefined,
    },
    record.currency,
  );
  return {
    ...draft,
    id: record.id,
    tenantId,
    currency: record.currency,
    publication: record.publication,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
  };
}

function validAmount(amount: bigint) {
  return typeof amount === 'bigint' && amount >= 0n;
}

function validQuantity(quantity: number) {
  return (
    Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= 2_147_483_647
  );
}

/** Index authoritative facts supplied by the caller. Input arrays and maps are never written. */
export function preparePromotionContext(
  context: Readonly<PromotionEvaluationContext>,
) {
  const precision = currencyPrecision(context.currency);
  if (
    !context.tenantId ||
    !(context.now instanceof Date) ||
    !Number.isFinite(context.now.getTime()) ||
    (context.currencyPrecision !== undefined &&
      context.currencyPrecision !== precision) ||
    !['NONE', 'VALID', 'UNKNOWN'].includes(context.coupon) ||
    (context.shipping && !validAmount(context.shipping.eligibleChargeMinor)) ||
    (context.inventory && !context.inventory.fulfillmentId)
  ) {
    throw new Error('Invalid promotion evaluation context');
  }
  const lines = [...context.lines].sort((a, b) => stableCompare(a.id, b.id));
  const lineIds = new Set<string>();
  const paidByVariant = new Map<string, number>();
  for (const line of lines) {
    if (
      !line.id ||
      !line.productId ||
      !line.variantId ||
      !line.categoryId ||
      lineIds.has(line.id) ||
      !validQuantity(line.quantity) ||
      line.quantity === 0 ||
      !validAmount(line.saleUnitMinor) ||
      !validAmount(line.saleMerchandiseGrossMinor) ||
      line.saleMerchandiseGrossMinor <
        line.saleUnitMinor * BigInt(line.quantity)
    ) {
      throw new Error('Invalid promotion cart line');
    }
    lineIds.add(line.id);
    const paid = (paidByVariant.get(line.variantId) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(paid))
      throw new Error('Invalid aggregate promotion quantity');
    paidByVariant.set(line.variantId, paid);
  }
  const sellables = new Map<string, Readonly<PromotionSellable>>();
  const defaults = new Map<string, Readonly<PromotionSellable>>();
  for (const sellable of context.sellables ?? []) {
    if (sellable.tenantId !== context.tenantId) continue;
    if (
      !sellable.productId ||
      !sellable.variantId ||
      !validAmount(sellable.saleUnitMinor) ||
      sellables.has(sellable.variantId) ||
      (sellable.isDefault && defaults.has(sellable.productId))
    )
      throw new Error('Invalid promotion sellable');
    sellables.set(sellable.variantId, sellable);
    if (sellable.isDefault) defaults.set(sellable.productId, sellable);
  }
  for (const quantity of context.inventory?.available.values() ?? []) {
    if (!validQuantity(quantity)) throw new Error('Invalid promotion stock');
  }
  for (const availability of context.usage?.values() ?? []) {
    if (
      [availability.customerRemaining, availability.globalRemaining].some(
        (remaining) => remaining !== undefined && !validQuantity(remaining),
      )
    )
      throw new Error('Invalid promotion usage');
  }
  return { context, precision, lines, paidByVariant, sellables, defaults };
}

export type PreparedPromotionContext = ReturnType<
  typeof preparePromotionContext
>;
