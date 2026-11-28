import { AppError } from '../../common/errors/app-error.js';
import { fromMinorUnits, toMinorUnits } from '../../common/pricing/money.js';
import { calculateEffectivePrice } from '../../common/pricing/pricing.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  MAX_DEFINITIONS,
  PromotionCommerceRepository,
} from './promotion-commerce.repository.js';
import { evaluatePromotions } from './promotion.evaluator.js';
import { preparePromotionDefinition } from './promotion.preparation.js';
import type { PromotionEvaluationContext } from './promotion.types.js';

type TrustedCommerceFacts = Omit<
  PromotionEvaluationContext,
  'customer' | 'sellables' | 'usage'
> & {
  userId: string;
  hasAuthoritativeMerchandiseGross: boolean;
};

export async function evaluateCommercePromotions(
  tx: Prisma.TransactionClient,
  facts: TrustedCommerceFacts,
) {
  const { tenantId, userId, currency, now } = facts;
  const repository = new PromotionCommerceRepository(tx);
  const records = await repository.definitions(tenantId, currency, now);
  if (records.length > MAX_DEFINITIONS) {
    // Evaluating only the first page could silently change conflict resolution.
    return { status: 'CAPACITY_EXCEEDED' } as const;
  }
  const definitions = records
    .map((record) => preparePromotionDefinition(tenantId, record))
    .filter(
      ({ configuration }) =>
        facts.hasAuthoritativeMerchandiseGross ||
        configuration.condition?.kind !== 'SPEND',
    );
  if (!definitions.length)
    return {
      status: 'EVALUATED',
      evaluation: evaluatePromotions([], { ...facts, customer: null }),
    } as const;
  const customer = await repository.customer(
    tenantId,
    userId,
    definitions.some(
      ({ audience }) =>
        audience.kind === 'FIRST_TIME' || audience.kind === 'RETURNING',
    ),
  );
  if (!customer)
    throw new AppError(
      'Active tenant membership is required',
      403,
      'FORBIDDEN',
    );

  const [variants, usage] = await Promise.all([
    repository.sellables(tenantId, definitions),
    repository.usage(tenantId, userId, definitions),
  ]);
  const sellables = variants.map((variant) => {
    const { product } = variant;
    const effectivePrice = calculateEffectivePrice(
      variant.price?.toString() ?? product.basePrice.toString(),
      {
        type: product.discountType,
        value: product.discountValue?.toString() ?? null,
        startsAt: product.discountStartsAt,
        endsAt: product.discountEndsAt,
      },
      {
        type: variant.discountType,
        value: variant.discountValue?.toString() ?? null,
        startsAt: variant.discountStartsAt,
        endsAt: variant.discountEndsAt,
      },
      now,
      currency,
    );
    const taxClassId = variant.taxCategoryId ?? product.taxCategoryId;
    return {
      tenantId,
      productId: product.id,
      variantId: variant.id,
      isDefault: variant.isDefault,
      saleUnitMinor: toMinorUnits(effectivePrice.finalPrice, currency),
      ...(taxClassId === null ? {} : { taxClassId }),
    };
  });

  return {
    status: 'EVALUATED',
    evaluation: evaluatePromotions(definitions, {
      ...facts,
      customer,
      usage,
      sellables,
    }),
  } as const;
}

/** Server-owned allowlist for advisory cart output. It cannot activate checkout discounts. */
export function cartPromotionGuidanceEnabled(tenantId: string) {
  return (
    process.env.PROMOTION_CART_GUIDANCE_TENANT_IDS?.split(',').some(
      (id) => id.trim() === tenantId,
    ) ?? false
  );
}

export function projectCartPromotionGuidance(
  result: Awaited<ReturnType<typeof evaluateCommercePromotions>>,
  currency: string,
) {
  const limit = 15;
  if (result.status === 'CAPACITY_EXCEEDED')
    return { status: result.status } as const;
  const { evaluation } = result;
  return {
    status: 'ADVISORY',
    currency,
    potentialMerchandiseSavings: fromMinorUnits(
      evaluation.confirmedMerchandiseSavingsMinor,
      currency,
    ),
    offers: evaluation.applied.slice(0, limit).map((offer) => ({
      promotionId: offer.promotionId,
      applications: offer.applications,
      potentialMerchandiseSavings: fromMinorUnits(
        offer.merchandiseSavingsMinor,
        currency,
      ),
    })),
    recommendations: evaluation.recommendations
      .slice(0, limit)
      .map(({ missingSpendMinor, ...item }) => ({
        ...item,
        ...(missingSpendMinor === undefined
          ? {}
          : { missingSpend: fromMinorUnits(missingSpendMinor, currency) }),
        ...(item.giftOptions === undefined
          ? {}
          : { giftOptions: item.giftOptions.slice(0, limit) }),
        ...(item.missing === undefined
          ? {}
          : { missing: item.missing.slice(0, limit) }),
      })),
  } as const;
}
