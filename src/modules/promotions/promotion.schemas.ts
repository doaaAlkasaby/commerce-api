import { z } from 'zod';
import { toMinorUnits } from '../../common/pricing/money.js';

const id = z.string().min(1).max(128);
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const quantity = z.number().int().min(1).max(1_000_000);
const limit = z.number().int().min(1).max(2_147_483_647);
const money = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/);
const basisPoints = z.number().int().min(1).max(10_000);
const keys = z.array(key).min(1).max(50);

const selector = z.discriminatedUnion('kind', [
  z.strictObject({ key, kind: z.literal('PRODUCT'), productId: id }),
  z.strictObject({
    key,
    kind: z.literal('VARIANT'),
    productId: id,
    variantId: id,
  }),
  z.strictObject({ key, kind: z.literal('CATEGORY'), categoryId: id }),
  z.strictObject({ key, kind: z.literal('BRAND'), brandId: id }),
]);

const allRequired = z.strictObject({
  kind: z.literal('ALL_REQUIRED'),
  items: z
    .array(z.strictObject({ selector: key, quantity }))
    .min(1)
    .max(50),
});
const mixMatch = z.strictObject({
  kind: z.literal('MIX_MATCH'),
  selectors: keys,
  quantity,
});
const spend = z.strictObject({
  kind: z.literal('SPEND'),
  minimum: money,
  selectors: keys.optional(),
});
const condition = z.discriminatedUnion('kind', [allRequired, mixMatch, spend]);
const freeProduct = z.strictObject({
  kind: z.literal('FREE_PRODUCT'),
  selector: key,
  quantity,
});
const percentage = z.strictObject({
  kind: z.literal('PERCENTAGE'),
  basisPoints,
  selectors: keys.optional(),
});
const fixedAmount = z.strictObject({
  kind: z.literal('FIXED_AMOUNT'),
  amount: money,
  selectors: keys.optional(),
});
const crossDiscount = z.discriminatedUnion('kind', [
  percentage.extend({ selectors: keys }),
  fixedAmount.extend({ selectors: keys }),
]);
const productRewards = z.strictObject({
  kind: z.literal('PRODUCT_REWARDS'),
  items: z
    .array(
      z.strictObject({
        selector: key,
        quantity,
        discount: z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('FREE') }),
          percentage.omit({ selectors: true }),
          fixedAmount.omit({ selectors: true }),
        ]),
      }),
    )
    .min(1)
    .max(50),
});
const explicitReward = z.union([freeProduct, productRewards]);
const gift = z.strictObject({
  kind: z.literal('SELECTED_GIFT'),
  options: keys,
  quantity,
});
const shipping = z.strictObject({ kind: z.literal('FREE_SHIPPING') });
const bundleReward = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('FIXED_PRICE'), amount: money }),
  percentage.omit({ selectors: true }),
  fixedAmount.omit({ selectors: true }),
]);
const tierDiscount = z.discriminatedUnion('kind', [
  percentage.omit({ selectors: true }),
  fixedAmount.omit({ selectors: true }),
]);
const configurationFields = {
  version: z.literal(1),
  stacking: z.enum(['DISJOINT', 'EXCLUSIVE']).optional(),
};
const configurationShape = z.discriminatedUnion('template', [
  z.strictObject({
    ...configurationFields,
    template: z.literal('BUY_X_GET_Y'),
    condition: allRequired,
    reward: explicitReward,
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('ALL_REQUIRED'),
    condition: allRequired,
    reward: z.union([explicitReward, crossDiscount]),
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('CROSS_PRODUCT'),
    condition: allRequired,
    reward: z.union([explicitReward, crossDiscount]),
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('BUNDLE'),
    condition: z.union([allRequired, mixMatch]),
    reward: bundleReward,
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('SPEND_GET'),
    condition: spend,
    reward: z.union([explicitReward, percentage, fixedAmount, gift, shipping]),
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('MIX_MATCH'),
    condition: mixMatch,
    reward: z.union([explicitReward, bundleReward]),
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('SELECT_GIFT'),
    condition,
    reward: gift,
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('TIERED_QUANTITY'),
    condition: z.strictObject({ kind: z.literal('QUANTITY'), selectors: keys }),
    reward: z.strictObject({
      kind: z.literal('TIERS'),
      tiers: z
        .array(
          z.strictObject({ minimumQuantity: quantity, discount: tierDiscount }),
        )
        .min(1)
        .max(20),
    }),
  }),
  z.strictObject({
    ...configurationFields,
    template: z.literal('FREE_SHIPPING'),
    condition: condition.optional(),
    reward: shipping,
  }),
]);

const presentation = {
  titleAr: z.string().trim().min(1).max(200),
  titleEn: z.string().trim().min(1).max(200),
  descriptionAr: z.string().trim().max(5000).optional(),
  descriptionEn: z.string().trim().max(5000).optional(),
  imageUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional(),
};
const schedule = {
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
};
function checkSchedule(
  value: { startsAt?: string | undefined; endsAt?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (
    value.startsAt &&
    value.endsAt &&
    Date.parse(value.endsAt) <= Date.parse(value.startsAt)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'End must follow start',
    });
  }
}

export const campaignDraftSchema = z
  .strictObject({ ...presentation, ...schedule })
  .superRefine(checkSchedule);

const audience = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ALL') }),
  z.strictObject({ kind: z.literal('FIRST_TIME') }),
  z.strictObject({ kind: z.literal('RETURNING') }),
  z.strictObject({
    kind: z.literal('SELECTED'),
    customerIds: z.array(id).min(1).max(500),
  }),
]);

export const promotionDraftSchema = z
  .strictObject({
    ...presentation,
    ...schedule,
    campaignId: id.optional(),
    configuration: configurationShape,
    selectors: z.array(selector).max(100).default([]),
    audience: audience.default({ kind: 'ALL' }),
    priority: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    perOrderLimit: quantity.default(1),
    perCustomerLimit: limit.optional(),
    globalLimit: limit.optional(),
  })
  .superRefine((value, ctx) => {
    checkSchedule(value, ctx);
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const { condition: qualification, reward } = value.configuration;
    const available = new Map(
      value.selectors.map((entry) => [entry.key, entry]),
    );
    const used = new Set<string>();
    const targets = value.selectors.map((entry) =>
      JSON.stringify(selectorColumns(entry)),
    );
    if (
      available.size !== value.selectors.length ||
      new Set(targets).size !== targets.length
    ) {
      issue(['selectors'], 'Selector keys and targets must be unique');
    }
    const validateKeys = (
      references: string[],
      path: string[],
      explicitSku = false,
    ) => {
      if (new Set(references).size !== references.length)
        issue(path, 'Selectors must be unique within a group');
      for (const reference of references) {
        used.add(reference);
        const entry = available.get(reference);
        if (
          !entry ||
          (explicitSku && entry.kind !== 'PRODUCT' && entry.kind !== 'VARIANT')
        ) {
          issue(path, 'Unknown or unsupported selector for this group');
        }
      }
    };
    if (qualification?.kind === 'ALL_REQUIRED') {
      validateKeys(
        qualification.items.map((item) => item.selector),
        ['configuration', 'condition', 'items'],
      );
    } else if (qualification?.selectors) {
      validateKeys(qualification.selectors, [
        'configuration',
        'condition',
        'selectors',
      ]);
    }
    if (reward.kind === 'FREE_PRODUCT')
      validateKeys(
        [reward.selector],
        ['configuration', 'reward', 'selector'],
        true,
      );
    if (reward.kind === 'PRODUCT_REWARDS')
      validateKeys(
        reward.items.map((item) => item.selector),
        ['configuration', 'reward', 'items'],
        true,
      );
    if (reward.kind === 'SELECTED_GIFT')
      validateKeys(
        reward.options,
        ['configuration', 'reward', 'options'],
        true,
      );
    if ('selectors' in reward && reward.selectors)
      validateKeys(reward.selectors, ['configuration', 'reward', 'selectors']);
    if (value.selectors.some((entry) => !used.has(entry.key)))
      issue(['selectors'], 'Every selector must be used');
    if (
      reward.kind === 'TIERS' &&
      reward.tiers.some(
        (tier, index, tiers) =>
          index > 0 &&
          tier.minimumQuantity <= tiers[index - 1]!.minimumQuantity,
      )
    ) {
      issue(
        ['configuration', 'reward', 'tiers'],
        'Tier quantities must be strictly increasing',
      );
    }
    if (
      value.perOrderLimit > 1 &&
      (qualification?.kind === 'SPEND' ||
        reward.kind === 'FREE_SHIPPING' ||
        reward.kind === 'TIERS')
    ) {
      issue(
        ['perOrderLimit'],
        'This promotion permits one application per order',
      );
    }
    if (
      value.audience.kind === 'SELECTED' &&
      new Set(value.audience.customerIds).size !==
        value.audience.customerIds.length
    ) {
      issue(['audience', 'customerIds'], 'Customer IDs must be unique');
    }
  });

export type PromotionDraft = z.output<typeof promotionDraftSchema>;
export type CampaignDraft = z.output<typeof campaignDraftSchema>;
export type PromotionConfiguration = PromotionDraft['configuration'];
export type PromotionSelector = PromotionDraft['selectors'][number];

export function validatePromotionDraft(
  input: unknown,
  currency: string,
): PromotionDraft {
  return promotionDraftSchema
    .superRefine(
      ({ configuration: { condition: qualification, reward } }, ctx) => {
        function checkAmount(
          amount: string,
          path: (string | number)[],
          allowZero = false,
        ) {
          try {
            if (toMinorUnits(amount, currency) > 0n || allowZero) return;
          } catch {
            ctx.addIssue({
              code: 'custom',
              path,
              message:
                'Amount must fit the tenant currency precision and range',
            });
            return;
          }
          ctx.addIssue({
            code: 'custom',
            path,
            message: 'Amount must be positive',
          });
        }
        if (qualification?.kind === 'SPEND')
          checkAmount(qualification.minimum, [
            'configuration',
            'condition',
            'minimum',
          ]);
        if (reward.kind === 'FIXED_PRICE' || reward.kind === 'FIXED_AMOUNT') {
          checkAmount(
            reward.amount,
            ['configuration', 'reward', 'amount'],
            reward.kind === 'FIXED_PRICE',
          );
        }
        if (reward.kind === 'PRODUCT_REWARDS') {
          reward.items.forEach(({ discount }, index) => {
            if (discount.kind === 'FIXED_AMOUNT')
              checkAmount(discount.amount, [
                'configuration',
                'reward',
                'items',
                index,
                'discount',
                'amount',
              ]);
          });
        }
        if (reward.kind === 'TIERS') {
          reward.tiers.forEach(({ discount }, index) => {
            if (discount.kind === 'FIXED_AMOUNT')
              checkAmount(discount.amount, [
                'configuration',
                'reward',
                'tiers',
                index,
                'discount',
                'amount',
              ]);
          });
        }
      },
    )
    .parse(input);
}

export function selectorColumns(entry: PromotionSelector) {
  switch (entry.kind) {
    case 'PRODUCT':
      return { productId: entry.productId };
    case 'VARIANT':
      return { productId: entry.productId, variantId: entry.variantId };
    case 'CATEGORY':
      return { categoryId: entry.categoryId };
    case 'BRAND':
      return { brandId: entry.brandId };
  }
}
