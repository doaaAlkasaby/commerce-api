import {
  lineAllocation,
  prepareCandidate,
  type CandidateEvaluation,
  type EvaluationLedger,
} from './promotion.candidate.js';
import { promotionStatus } from './promotion.lifecycle.js';
import { preparePromotionContext } from './promotion.preparation.js';
import type {
  PromotionCandidate,
  PromotionDefinition,
  PromotionEvaluator,
  PromotionGuidance,
  PromotionReason,
} from './promotion.types.js';
import { stableCompare } from './promotion.units.js';

const hiddenReasons = new Set<PromotionReason>([
  'INACCESSIBLE',
  'INACTIVE',
  'AUDIENCE_MISMATCH',
  'CUSTOMER_HISTORY_UNKNOWN',
  'USAGE_EXHAUSTED',
]);

const conditionalReasons = new Set<PromotionReason>([
  'USAGE_UNKNOWN',
  'COUPON_UNKNOWN',
  'REWARD_STOCK_UNKNOWN',
  'SHIPPING_UNKNOWN',
]);

function gate(
  definition: PromotionDefinition,
  context: Parameters<PromotionEvaluator>[1],
): { blocked: PromotionReason } | { capacity: number; usageUnknown: boolean } {
  if (
    definition.tenantId !== context.tenantId ||
    definition.currency !== context.currency
  )
    return { blocked: 'INACCESSIBLE' };
  if (promotionStatus(definition, context.now) !== 'ACTIVE')
    return { blocked: 'INACTIVE' };
  const { customer } = context;
  const { audience } = definition;
  if (customer && customer.tenantId !== context.tenantId)
    return { blocked: 'INACCESSIBLE' };
  if (audience.kind !== 'ALL' && !customer)
    return { blocked: 'AUDIENCE_MISMATCH' };
  if (
    audience.kind === 'SELECTED' &&
    !audience.customerIds.includes(customer!.id)
  )
    return { blocked: 'AUDIENCE_MISMATCH' };
  if (audience.kind === 'FIRST_TIME' || audience.kind === 'RETURNING') {
    const history = customer!.hasQualifyingCompletedOrder;
    if (typeof history !== 'boolean')
      return { blocked: 'CUSTOMER_HISTORY_UNKNOWN' };
    if ((audience.kind === 'RETURNING') !== history)
      return { blocked: 'AUDIENCE_MISMATCH' };
  }
  const availability = context.usage?.get(definition.id);
  const global =
    definition.globalLimit === undefined
      ? undefined
      : availability?.globalRemaining;
  const perCustomer =
    definition.perCustomerLimit === undefined || !customer
      ? undefined
      : availability?.customerRemaining;
  const capacity = Math.min(
    definition.perOrderLimit,
    definition.globalLimit ?? Infinity,
    definition.perCustomerLimit ?? Infinity,
    global ?? Infinity,
    perCustomer ?? Infinity,
  );
  if (capacity === 0) return { blocked: 'USAGE_EXHAUSTED' };
  return {
    capacity,
    usageUnknown:
      (definition.globalLimit !== undefined && global === undefined) ||
      (definition.perCustomerLimit !== undefined && perCustomer === undefined),
  };
}

type Pending = {
  definition: PromotionDefinition;
  engine: ReturnType<typeof prepareCandidate>;
  result: CandidateEvaluation;
  capacity: number;
};

export const evaluatePromotions: PromotionEvaluator = (
  definitions,
  context,
) => {
  const prepared = preparePromotionContext(context);
  const ledger: EvaluationLedger = {
    remaining: prepared.lines.map(({ quantity }) => quantity),
    proposed: new Map(),
  };
  const applied: PromotionCandidate[] = [];
  const eligibleUnapplied: PromotionGuidance[] = [];
  const rejected: { promotionId: string; reason: PromotionReason }[] = [];
  const recommendations: PromotionGuidance[] = [];
  const warnings = new Set<PromotionReason>();
  const pending: Pending[] = [];
  const deferred: (Pending & {
    gateReason?: 'USAGE_UNKNOWN' | 'COUPON_UNKNOWN';
  })[] = [];

  function report(item: PromotionGuidance) {
    const { promotionId, reason } = item;
    if (conditionalReasons.has(reason)) {
      warnings.add(reason);
      eligibleUnapplied.push(item);
    } else rejected.push({ promotionId, reason });
    if (
      !hiddenReasons.has(reason) &&
      [
        'MISSING_PRODUCTS',
        'MISSING_MIX_QUANTITY',
        'MISSING_SPEND',
        'NEXT_TIER',
        'ADDITIONAL_GROUP',
        'GIFT_SELECTION_REQUIRED',
        'GIFT_SELECTION_INVALID',
        'MIX_SELECTION_INVALID',
        'REWARD_UNAVAILABLE',
        'REWARD_STOCK_UNKNOWN',
        'SHIPPING_UNKNOWN',
      ].includes(reason)
    )
      recommendations.push(item);
  }

  const sorted = [...definitions].sort(
    (a, b) => b.priority - a.priority || stableCompare(a.id, b.id),
  );
  const seen = new Set<string>();
  for (const definition of sorted) {
    const { id: promotionId } = definition;
    // A foreign definition must never suppress a same-tenant result with the same ID.
    if (definition.tenantId !== context.tenantId) {
      report({ promotionId, reason: 'INACCESSIBLE' });
      continue;
    }
    if (seen.has(promotionId))
      throw new Error('Duplicate promotion definition');
    seen.add(promotionId);
    const eligibility = gate(definition, context);
    if ('blocked' in eligibility) {
      report({ promotionId, reason: eligibility.blocked });
      continue;
    }
    if (context.coupon === 'VALID') {
      report({ promotionId, reason: 'COUPON_PRECEDENCE' });
      continue;
    }
    const engine = prepareCandidate(definition, prepared);
    const result = engine.evaluate(ledger, eligibility.capacity);
    const entry = {
      definition,
      engine,
      result,
      capacity: eligibility.capacity,
    };
    const gateReason = eligibility.usageUnknown
      ? 'USAGE_UNKNOWN'
      : context.coupon === 'UNKNOWN'
        ? 'COUPON_UNKNOWN'
        : undefined;
    if ('guidance' in result || gateReason)
      deferred.push({ ...entry, ...(gateReason && { gateReason }) });
    else pending.push(entry);
  }

  let exclusive = false;
  let shippingApplied = false;
  while (pending.length) {
    const priority = pending[0]!.definition.priority;
    let best = 0;
    let highest = -1n;
    for (
      let index = 0;
      index < pending.length &&
      pending[index]!.definition.priority === priority;
      index++
    ) {
      const candidate = pending[index]!.result;
      if ('plan' in candidate && candidate.plan.rankSavings > highest) {
        highest = candidate.plan.rankSavings;
        best = index;
      }
    }
    const [selected] = pending.splice(best, 1);
    const { result, definition } = selected!;
    const { id: promotionId } = definition;
    if ('guidance' in result) {
      report({
        promotionId,
        reason: exclusive ? 'STACKING_RESTRICTED' : 'UNIT_CONFLICT',
      });
      if (
        !exclusive &&
        (result.guidance.reason === 'GIFT_SELECTION_INVALID' ||
          result.guidance.reason === 'REWARD_UNAVAILABLE')
      ) {
        recommendations.push(result.guidance);
      }
      continue;
    }
    const { plan } = result;
    const shipping = definition.configuration.reward.kind === 'FREE_SHIPPING';
    if (
      exclusive ||
      (definition.configuration.stacking === 'EXCLUSIVE' &&
        applied.length > 0) ||
      (shipping && shippingApplied)
    ) {
      report({ promotionId, reason: 'STACKING_RESTRICTED' });
      continue;
    }
    applied.push(plan.candidate);
    if (plan.guidance) recommendations.push(plan.guidance);
    exclusive = definition.configuration.stacking === 'EXCLUSIVE';
    shippingApplied ||= shipping;
    for (const [index, quantity] of plan.consumed)
      ledger.remaining[index]! -= quantity;
    for (const [variantId, quantity] of plan.proposed) {
      ledger.proposed.set(
        variantId,
        (ledger.proposed.get(variantId) ?? 0) + quantity,
      );
    }
    for (const contender of pending) {
      if (contender.engine.affectedBy(plan))
        contender.result = contender.engine.evaluate(
          ledger,
          contender.capacity,
        );
    }
  }

  for (const {
    definition,
    engine,
    result: original,
    capacity,
    gateReason,
  } of deferred) {
    const result = applied.length
      ? engine.evaluate(ledger, capacity)
      : original;
    if (
      gateReason &&
      ('plan' in result || conditionalReasons.has(result.guidance.reason))
    ) {
      report({ promotionId: definition.id, reason: gateReason });
    } else if ('guidance' in result && !exclusive) {
      report(result.guidance);
    } else {
      report({ promotionId: definition.id, reason: 'STACKING_RESTRICTED' });
    }
  }

  const byId = (
    a: { promotionId: string; reason: string },
    b: { promotionId: string; reason: string },
  ) =>
    stableCompare(a.promotionId, b.promotionId) ||
    stableCompare(a.reason, b.reason);

  return {
    currency: context.currency,
    currencyPrecision: prepared.precision,
    applied,
    eligibleUnapplied: eligibleUnapplied.sort(byId),
    rejected: rejected.sort(byId),
    recommendations: recommendations.sort(byId),
    remainingUnits: prepared.lines.flatMap((line, index) =>
      ledger.remaining[index]
        ? [lineAllocation(line, ledger.remaining[index]!)]
        : [],
    ),
    confirmedMerchandiseSavingsMinor: applied.reduce(
      (total, candidate) => total + candidate.merchandiseSavingsMinor,
      0n,
    ),
    confirmedShippingSavingsMinor: applied.reduce(
      (total, candidate) => total + candidate.shippingSavingsMinor,
      0n,
    ),
    warnings: [...warnings].sort(stableCompare),
    redemptionGuarantee: 'ADVISORY',
  };
};
