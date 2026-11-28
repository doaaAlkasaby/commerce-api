import { toMinorUnits } from '../../common/pricing/money.js';
import { calculateDiscountAmount } from '../../common/pricing/pricing.service.js';
import { allocateCouponDiscount } from '../../common/tax/tax.allocation.js';
import type { PreparedPromotionContext } from './promotion.preparation.js';
import type { PromotionSelector } from './promotion.schemas.js';
import type {
  PromotionCandidate,
  PromotionCartLine,
  PromotionDefinition,
  PromotionGiftOption,
  PromotionGuidance,
  PromotionRewardAllocation,
  PromotionSellable,
} from './promotion.types.js';
import { allocateUnits, stableCompare } from './promotion.units.js';

type Discount =
  | { kind: 'FREE' }
  | { kind: 'PERCENTAGE'; basisPoints: number }
  | { kind: 'FIXED_AMOUNT' | 'FIXED_PRICE'; amount: string };
type RewardDemand = {
  key: string;
  quantity: number;
  discount: Discount;
  sellable: Readonly<PromotionSellable>;
  customer: boolean;
};
type GroupDemand = { key: string; quantity: number; matches: number[] };
type Units = Map<number, number>;
type Plan = {
  candidate: PromotionCandidate;
  consumed: Units;
  proposed: Map<string, number>;
  rankSavings: bigint;
  guidance?: PromotionGuidance;
};
export type CandidateEvaluation =
  { plan: Plan } | { guidance: PromotionGuidance };
export type EvaluationLedger = {
  remaining: number[];
  proposed: Map<string, number>;
};

export function lineAllocation(
  line: Readonly<PromotionCartLine>,
  quantity: number,
) {
  const { id: lineId, productId, variantId, taxClassId } = line;
  return {
    lineId,
    productId,
    variantId,
    quantity,
    ...(taxClassId === undefined ? {} : { taxClassId }),
  };
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

function matches(
  selector: PromotionSelector,
  line: Readonly<PromotionCartLine>,
) {
  switch (selector.kind) {
    case 'PRODUCT':
      return line.productId === selector.productId;
    case 'VARIANT':
      return (
        line.productId === selector.productId &&
        line.variantId === selector.variantId
      );
    case 'CATEGORY':
      return line.categoryId === selector.categoryId;
    case 'BRAND':
      return line.brandId === selector.brandId;
  }
}

function discountAmount(
  base: bigint,
  discount: Discount,
  times: number,
  currency: string,
) {
  switch (discount.kind) {
    case 'FREE':
      return base;
    case 'PERCENTAGE': {
      const whole = Math.trunc(discount.basisPoints / 100);
      const fraction = String(discount.basisPoints % 100).padStart(2, '0');
      return calculateDiscountAmount(
        base,
        'PERCENTAGE',
        `${whole}.${fraction}`,
        currency,
      );
    }
    case 'FIXED_AMOUNT':
      return min(base, toMinorUnits(discount.amount, currency) * BigInt(times));
    case 'FIXED_PRICE':
      return (
        base -
        min(base, toMinorUnits(discount.amount, currency) * BigInt(times))
      );
  }
}

function add<K>(map: Map<K, number>, key: K, quantity: number) {
  map.set(key, (map.get(key) ?? 0) + quantity);
}

/** Original rounded gross is split deterministically into a quotient and one-unit remainders. */
function remainingGross(line: Readonly<PromotionCartLine>, remaining: number) {
  const quantity = BigInt(line.quantity);
  return (
    (line.saleMerchandiseGrossMinor / quantity) * BigInt(remaining) +
    ((line.saleMerchandiseGrossMinor % quantity) -
      min(
        line.saleMerchandiseGrossMinor % quantity,
        BigInt(line.quantity - remaining),
      ))
  );
}

export function prepareCandidate(
  definition: PromotionDefinition,
  prepared: PreparedPromotionContext,
) {
  const { lines, context, sellables, defaults, paidByVariant } = prepared;
  const selectors = new Map(
    definition.selectors.map((selector) => [selector.key, selector]),
  );
  const lineIndexes = lines.map((_, index) => index);
  const matched = new Map(
    definition.selectors.map((selector) => [
      selector.key,
      lineIndexes.filter((index) => matches(selector, lines[index]!)),
    ]),
  );
  const findLines = (keys?: readonly string[]) =>
    keys
      ? [...new Set(keys.flatMap((key) => matched.get(key) ?? []))].sort(
          (a, b) => a - b,
        )
      : lineIndexes;

  function sellableFor(key: string) {
    const selector = selectors.get(key);
    if (selector?.kind === 'PRODUCT') return defaults.get(selector.productId);
    if (selector?.kind === 'VARIANT') {
      const sellable = sellables.get(selector.variantId);
      if (sellable?.productId === selector.productId) return sellable;
    }
    return undefined;
  }

  const { condition, reward } = definition.configuration;
  const mix = context.mixSelections?.get(definition.id);
  const guidance = (
    reason: PromotionGuidance['reason'],
    details: Omit<PromotionGuidance, 'reason' | 'promotionId'> = {},
  ): PromotionGuidance => ({ promotionId: definition.id, reason, ...details });
  const fail = (
    reason: PromotionGuidance['reason'],
    details?: Omit<PromotionGuidance, 'reason' | 'promotionId'>,
  ): CandidateEvaluation => ({ guidance: guidance(reason, details) });
  const conditionIndexes =
    condition && 'selectors' in condition
      ? findLines(
          condition.kind === 'MIX_MATCH' && mix ? mix : condition.selectors,
        )
      : lineIndexes;
  const group: GroupDemand[] =
    condition?.kind === 'ALL_REQUIRED'
      ? [...condition.items]
          .sort((a, b) => stableCompare(a.selector, b.selector))
          .map(({ selector, quantity }) => ({
            key: selector,
            quantity,
            matches: matched.get(selector) ?? [],
          }))
      : condition?.kind === 'MIX_MATCH'
        ? [{ key: '', quantity: condition.quantity, matches: conditionIndexes }]
        : [];
  const legacyCross =
    group.length > 0 &&
    condition?.kind === 'ALL_REQUIRED' &&
    (reward.kind === 'PERCENTAGE' || reward.kind === 'FIXED_AMOUNT') &&
    'selectors' in reward &&
    reward.selectors;
  const legacyMatches = legacyCross ? findLines(legacyCross) : [];
  const spendThreshold =
    condition?.kind === 'SPEND'
      ? toMinorUnits(condition.minimum, context.currency)
      : 0n;
  const explicit =
    reward.kind === 'PRODUCT_REWARDS'
      ? [...reward.items].sort((a, b) => stableCompare(a.selector, b.selector))
      : reward.kind === 'FREE_PRODUCT'
        ? [
            {
              selector: reward.selector,
              quantity: reward.quantity,
              discount: { kind: 'FREE' } as const,
            },
          ]
        : [];

  const relevantLines = new Set(
    condition?.kind === 'SPEND' && !condition.selectors
      ? lineIndexes
      : [...matched.values()].flat(),
  );
  const relevantStock = new Set(
    definition.selectors.flatMap(({ key }) => {
      const sellable = sellableFor(key);
      return sellable ? [sellable.variantId] : [];
    }),
  );

  function evaluate(
    ledger: EvaluationLedger,
    limit: number,
  ): CandidateEvaluation {
    if (
      mix &&
      (condition?.kind !== 'MIX_MATCH' ||
        mix.length === 0 ||
        new Set(mix).size !== mix.length ||
        mix.some((key) => !condition.selectors.includes(key)))
    ) {
      return fail('MIX_SELECTION_INVALID');
    }
    const { remaining } = ledger;
    const quantityIn = (indexes: readonly number[]) =>
      indexes.reduce((total, index) => total + remaining[index]!, 0);
    const spendUnits = new Map<number, number>();
    let tier:
      | { currentTier?: number; nextTier?: number; missingQuantity?: number }
      | undefined;
    let tierDiscount: Discount | undefined;

    let spendGross = 0n;
    if (condition?.kind === 'SPEND') {
      const threshold = spendThreshold;
      spendGross = conditionIndexes.reduce(
        (sum, index) => sum + remainingGross(lines[index]!, remaining[index]!),
        0n,
      );
      if (spendGross < threshold)
        return fail('MISSING_SPEND', {
          missingSpendMinor: threshold - spendGross,
        });
      for (const index of conditionIndexes)
        if (remaining[index]) spendUnits.set(index, remaining[index]!);
    }
    if (reward.kind === 'TIERS') {
      const count = quantityIn(conditionIndexes);
      const current = [...reward.tiers]
        .reverse()
        .find(({ minimumQuantity }) => count >= minimumQuantity);
      const next = reward.tiers.find(
        ({ minimumQuantity }) => count < minimumQuantity,
      );
      tier = {
        ...(current && { currentTier: current.minimumQuantity }),
        ...(next && {
          nextTier: next.minimumQuantity,
          missingQuantity: next.minimumQuantity - count,
        }),
      };
      if (!current) return fail('NEXT_TIER', tier);
      tierDiscount = current.discount;
      for (const index of conditionIndexes)
        if (remaining[index]) spendUnits.set(index, remaining[index]!);
    }

    const groupOnly = group.length ? allocateUnits(remaining, group) : [];
    const missing = groupOnly.flatMap((item, index) =>
      item.missing
        ? [{ selector: group[index]!.key, quantity: item.missing }]
        : [],
    );
    if (missing.length)
      return condition?.kind === 'MIX_MATCH'
        ? fail('MISSING_MIX_QUANTITY', {
            missingQuantity: missing[0]!.quantity,
          })
        : fail('MISSING_PRODUCTS', { missing });

    function stock(sellable: Readonly<PromotionSellable>) {
      const available = context.inventory?.available.get(sellable.variantId);
      return available === undefined
        ? undefined
        : Math.max(
            0,
            available -
              (paidByVariant.get(sellable.variantId) ?? 0) -
              (ledger.proposed.get(sellable.variantId) ?? 0),
          );
    }

    function availablePaid(sellable: Readonly<PromotionSellable>) {
      return lineIndexes.filter(
        (index) =>
          lines[index]!.productId === sellable.productId &&
          lines[index]!.variantId === sellable.variantId,
      );
    }

    function allocate(
      groups: number,
      targets: readonly RewardDemand[],
      optimistic: boolean,
    ) {
      const external = [
        ...new Map(
          targets
            .filter(({ discount }) => discount.kind === 'FREE')
            .map(({ sellable }) => [sellable.variantId, sellable]),
        ).values(),
      ].sort((a, b) => stableCompare(a.variantId, b.variantId));
      // For spend rewards, allocate their paid quantities before testing the
      // threshold. Prefer supplies that contribute the least to eligible gross.
      // A rounded line total needs at most two tranches, even at large quantities.
      const spending = condition?.kind === 'SPEND' && targets.length > 0;
      const supplies = remaining.flatMap((quantity, index) => {
        if (!quantity) return [];
        const line = lines[index]!;
        if (!spending || !spendUnits.has(index))
          return [{ index, quantity, cost: 0n }];
        const gross = remainingGross(line, quantity);
        const perUnit = gross / BigInt(quantity);
        const higher = Number(gross % BigInt(quantity));
        return [
          ...(quantity > higher
            ? [{ index, quantity: quantity - higher, cost: perUnit }]
            : []),
          ...(higher ? [{ index, quantity: higher, cost: perUnit + 1n }] : []),
        ];
      });
      external.forEach((sellable, index) =>
        supplies.push({
          index: lines.length + index,
          quantity:
            stock(sellable) ?? (optimistic ? 50 * 1_000_000 * groups : 0),
          cost: 0n,
        }),
      );
      if (spending)
        supplies.sort((a, b) =>
          a.cost < b.cost ? -1 : a.cost > b.cost ? 1 : a.index - b.index,
        );

      const supplyIndexes = new Map<number, number[]>();
      supplies.forEach(({ index }, offset) => {
        const indexes = supplyIndexes.get(index) ?? [];
        indexes.push(offset);
        supplyIndexes.set(index, indexes);
      });
      const externalIndexes = new Map(
        external.map((sellable, index) => [
          sellable.variantId,
          lines.length + index,
        ]),
      );
      const demands = [
        ...group.map((demand) => ({
          ...demand,
          quantity: demand.quantity * groups,
        })),
        ...(legacyCross ? [{ quantity: groups, matches: legacyMatches }] : []),
        ...targets.map(({ quantity, sellable, discount }) => ({
          quantity: quantity * groups,
          matches: [
            ...availablePaid(sellable),
            ...(discount.kind === 'FREE'
              ? [externalIndexes.get(sellable.variantId)!]
              : []),
          ],
        })),
      ].map((demand) => ({
        ...demand,
        matches: demand.matches.flatMap(
          (index) => supplyIndexes.get(index) ?? [],
        ),
      }));
      const assigned = demands.length
        ? allocateUnits(
            supplies.map(({ quantity }) => quantity),
            demands,
          )
        : [];
      let rewardGross = 0n;
      const allocation = assigned.map(({ missing, units }) => {
        const bySupply = new Map<number, number>();
        for (const { supply, quantity } of units) {
          const { index, cost } = supplies[supply]!;
          rewardGross += cost * BigInt(quantity);
          add(bySupply, index, quantity);
        }
        return {
          missing,
          units: [...bySupply].map(([supply, quantity]) => ({
            supply,
            quantity,
          })),
        };
      });
      const unitsComplete = allocation.every(({ missing }) => missing === 0);
      const missingSpend =
        spending && unitsComplete && spendGross - rewardGross < spendThreshold
          ? spendThreshold - (spendGross - rewardGross)
          : 0n;
      return {
        external,
        allocation,
        missingSpend,
        complete: unitsComplete && missingSpend === 0n,
      };
    }

    let targets: RewardDemand[] = [];
    for (const item of explicit) {
      const sellable = sellableFor(item.selector);
      if (!sellable) return fail('REWARD_UNAVAILABLE');
      targets.push({
        key: item.selector,
        quantity: item.quantity,
        discount: item.discount,
        sellable,
        customer: false,
      });
    }

    if (reward.kind === 'SELECTED_GIFT') {
      const choices = new Map<string, RewardDemand>();
      const options: PromotionGiftOption[] = [];
      for (const key of [...reward.options].sort(stableCompare)) {
        const sellable = sellableFor(key);
        if (!sellable) continue;
        const target: RewardDemand = {
          key,
          quantity: reward.quantity,
          discount: { kind: 'FREE' },
          sellable,
          customer: true,
        };
        const known = allocate(1, [target], false).complete;
        if (!known && !allocate(1, [target], true).complete) continue;
        choices.set(key, target);
        options.push({
          key,
          productId: sellable.productId,
          variantId: sellable.variantId,
          quantity: reward.quantity,
          availability: known ? 'AVAILABLE' : 'PROVISIONAL',
        });
      }
      const selected = context.selectedGiftKeys?.get(definition.id);
      if (!selected)
        return options.length
          ? fail('GIFT_SELECTION_REQUIRED', { giftOptions: options })
          : fail('REWARD_UNAVAILABLE', { giftOptions: options });
      const target = choices.get(selected.key);
      if (
        !target ||
        (selected.variantId !== undefined &&
          selected.variantId !== target.sellable.variantId) ||
        (selected.quantity !== undefined &&
          selected.quantity !== target.quantity)
      ) {
        return fail('GIFT_SELECTION_INVALID', { giftOptions: options });
      }
      if (!allocate(1, [target], false).complete)
        return fail('REWARD_STOCK_UNKNOWN', {
          giftOptions: options,
          conditionalBenefit: 'REWARD',
        });
      targets = [target];
    }

    const first = allocate(1, targets, false);
    if (!first.complete) {
      if (allocate(1, targets, true).complete)
        return fail('REWARD_STOCK_UNKNOWN', { conditionalBenefit: 'REWARD' });
      if (first.missingSpend > 0n)
        return fail('MISSING_SPEND', { missingSpendMinor: first.missingSpend });
      const missingRewards = targets.flatMap((target, index) => {
        const quantity = first.allocation[group.length + index]!.missing;
        return quantity ? [{ selector: target.key, quantity }] : [];
      });
      return fail(
        'REWARD_UNAVAILABLE',
        missingRewards.length ? { missing: missingRewards } : undefined,
      );
    }

    const maxByUnits = group.reduce(
      (max, demand) =>
        Math.min(max, Math.floor(quantityIn(demand.matches) / demand.quantity)),
      limit,
    );
    let low = 1;
    let high = group.length ? maxByUnits : 1;
    let result = first;
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      const attempt = allocate(count, targets, false);
      if (attempt.complete) {
        low = count;
        result = attempt;
      } else high = count - 1;
    }

    const qualifiers = new Map(spendUnits);
    if (condition?.kind === 'SPEND') {
      for (const assigned of result.allocation) {
        for (const { supply, quantity } of assigned.units) {
          const original = qualifiers.get(supply);
          if (original === quantity) qualifiers.delete(supply);
          else if (original !== undefined)
            qualifiers.set(supply, original - quantity);
        }
      }
    }
    for (const entry of result.allocation.slice(0, group.length)) {
      for (const { supply, quantity } of entry.units)
        add(qualifiers, supply, quantity);
    }
    const consumed = new Map(qualifiers);
    const discounts = new Map<number, { quantity: number; amount: bigint }>();
    const proposed = new Map<string, number>();
    const rewardUnits: PromotionRewardAllocation[] = [];
    let addedBenefit = 0n;
    let shippingSavingsMinor = 0n;

    function discountLines(
      units: Units,
      terms: Discount,
      applications: number,
    ) {
      const entries = [...units].sort(([a], [b]) => a - b);
      const bases = entries.map(([index, quantity]) => ({
        key: lines[index]!.id,
        amountCents: lines[index]!.saleUnitMinor * BigInt(quantity),
      }));
      const base = bases.reduce(
        (sum, current) => sum + current.amountCents,
        0n,
      );
      const amounts = allocateCouponDiscount(
        bases,
        discountAmount(base, terms, applications, context.currency),
      );
      entries.forEach(([index, quantity], position) => {
        const amount = amounts[position]!;
        const previous = discounts.get(index);
        discounts.set(index, {
          quantity: quantity + (previous?.quantity ?? 0),
          amount: amount + (previous?.amount ?? 0n),
        });
      });
      return amounts;
    }

    if (reward.kind === 'FREE_SHIPPING') {
      if (!context.shipping)
        return fail('SHIPPING_UNKNOWN', {
          conditionalBenefit: 'FREE_SHIPPING',
        });
      shippingSavingsMinor = context.shipping.eligibleChargeMinor;
    } else if (targets.length) {
      targets.forEach(({ sellable, discount, customer }, targetIndex) => {
        const assigned = result.allocation[group.length + targetIndex]!.units;
        const paid = new Map(
          assigned
            .filter(({ supply }) => supply < lines.length)
            .map(({ supply, quantity }) => [supply, quantity]),
        );
        const amounts = discountLines(paid, discount, low);
        [...paid]
          .sort(([a], [b]) => a - b)
          .forEach(([index, quantity], position) => {
            add(consumed, index, quantity);
            rewardUnits.push({
              ...lineAllocation(lines[index]!, quantity),
              source: 'CART',
              selection: customer ? 'CUSTOMER' : 'AUTOMATIC',
              discountMinor: amounts[position]!,
            });
          });
        for (const { supply, quantity } of assigned) {
          if (supply < lines.length) continue;
          const item = result.external[supply - lines.length]!;
          const benefit = item.saleUnitMinor * BigInt(quantity);
          addedBenefit += benefit;
          add(proposed, sellable.variantId, quantity);
          rewardUnits.push({
            source: customer ? 'SELECTED_GIFT' : 'AUTOMATIC',
            selection: customer ? 'CUSTOMER' : 'AUTOMATIC',
            productId: item.productId,
            variantId: item.variantId,
            quantity,
            discountMinor: benefit,
            ...(item.taxClassId === undefined
              ? {}
              : { taxClassId: item.taxClassId }),
          });
        }
      });
    } else if (tierDiscount) {
      discountLines(qualifiers, tierDiscount, low);
    } else if (
      reward.kind === 'PERCENTAGE' ||
      reward.kind === 'FIXED_AMOUNT' ||
      reward.kind === 'FIXED_PRICE'
    ) {
      const keys = 'selectors' in reward ? reward.selectors : undefined;
      const units =
        condition?.kind === 'SPEND' || legacyCross
          ? new Map(
              findLines(
                keys ??
                  (condition?.kind === 'SPEND'
                    ? condition.selectors
                    : undefined),
              ).flatMap((index) => {
                const quantity =
                  remaining[index]! -
                  (legacyCross ? (qualifiers.get(index) ?? 0) : 0);
                return quantity > 0 ? [[index, quantity] as const] : [];
              }),
            )
          : qualifiers;
      for (const [index, quantity] of units) {
        if (legacyCross) add(consumed, index, quantity);
        else consumed.set(index, Math.max(quantity, consumed.get(index) ?? 0));
      }
      const amounts = discountLines(units, reward, low);
      if (legacyCross)
        [...units].forEach(([index, quantity], position) =>
          rewardUnits.push({
            ...lineAllocation(lines[index]!, quantity),
            source: 'CART',
            selection: 'AUTOMATIC',
            discountMinor: amounts[position]!,
          }),
        );
    }

    const merchandiseDiscounts = [...discounts]
      .sort(([a], [b]) => a - b)
      .flatMap(([index, { amount, quantity }]) =>
        amount > 0n
          ? [
              {
                ...lineAllocation(lines[index]!, quantity),
                discountMinor: amount,
              },
            ]
          : [],
      );
    const merchandiseSavingsMinor = merchandiseDiscounts.reduce(
      (total, item) => total + item.discountMinor,
      0n,
    );
    const rankSavings =
      merchandiseSavingsMinor + shippingSavingsMinor + addedBenefit;
    if (
      rankSavings === 0n &&
      !rewardUnits.some((unit) => unit.source !== 'CART')
    )
      return fail('NO_SAVING');

    let next = tier?.nextTier ? guidance('NEXT_TIER', tier) : undefined;
    if (low < limit && group.length) {
      const residual = remaining.map(
        (quantity, index) => quantity - (consumed.get(index) ?? 0),
      );
      const shortfall = allocateUnits(residual, group).flatMap(
        ({ missing: quantity }, index) =>
          quantity ? [{ selector: group[index]!.key, quantity }] : [],
      );
      if (shortfall.length)
        next = guidance('ADDITIONAL_GROUP', {
          additionalApplications: 1,
          ...(condition?.kind === 'MIX_MATCH'
            ? { missingQuantity: shortfall[0]!.quantity }
            : { missing: shortfall }),
          ...(targets.length && { conditionalBenefit: 'REWARD' }),
        });
    }

    return {
      plan: {
        candidate: {
          promotionId: definition.id,
          applications: low,
          qualifyingUnits: [...qualifiers]
            .sort(([a], [b]) => a - b)
            .map(([index, quantity]) =>
              lineAllocation(lines[index]!, quantity),
            ),
          rewardUnits,
          merchandiseDiscounts,
          merchandiseSavingsMinor,
          shippingSavingsMinor,
          ...(tier?.currentTier !== undefined && {
            currentTier: tier.currentTier,
          }),
          ...(tier?.nextTier !== undefined && { nextTier: tier.nextTier }),
        },
        consumed,
        proposed,
        rankSavings,
        ...(next && { guidance: next }),
      },
    };
  }

  return {
    evaluate,
    affectedBy(plan: Plan) {
      return (
        [...plan.consumed.keys()].some((index) => relevantLines.has(index)) ||
        [...plan.proposed.keys()].some((variantId) =>
          relevantStock.has(variantId),
        )
      );
    },
  };
}
