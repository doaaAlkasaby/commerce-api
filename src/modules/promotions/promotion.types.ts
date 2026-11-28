import type { PromotionPublication } from '../../generated/prisma/enums.js';
import type { PromotionDraft } from './promotion.schemas.js';

export type PromotionStatus =
  'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED';

export interface PromotionWindow {
  publication: PromotionPublication;
  startsAt: Date | null;
  endsAt: Date | null;
}

export type PromotionDefinition = Readonly<
  Omit<PromotionDraft, 'startsAt' | 'endsAt'> &
    PromotionWindow & { id: string; tenantId: string; currency: string }
>;

export interface PromotionCartLine {
  id: string;
  productId: string;
  variantId: string;
  categoryId: string;
  brandId: string | null;
  quantity: number;
  /** Catalog sale price in the existing pricing basis, before this engine applies discounts. */
  saleUnitMinor: bigint;
  /** Original merchandise gross for the full paid line, including applicable tax once. */
  saleMerchandiseGrossMinor: bigint;
  taxClassId?: string;
}

export interface PromotionSellable {
  tenantId: string;
  productId: string;
  variantId: string;
  isDefault: boolean;
  saleUnitMinor: bigint;
  taxClassId?: string;
}

export interface PromotionEvaluationContext {
  tenantId: string;
  now: Date;
  currency: string;
  currencyPrecision?: number;
  customer: Readonly<{
    tenantId: string;
    id: string;
    hasQualifyingCompletedOrder?: boolean;
  }> | null;
  lines: readonly Readonly<PromotionCartLine>[];
  sellables?: readonly Readonly<PromotionSellable>[];
  /** Quantities are total available at one feasible fulfillment source, including paid units. */
  inventory?: Readonly<{
    fulfillmentId: string;
    available: ReadonlyMap<string, number>;
  }>;
  usage?: ReadonlyMap<
    string,
    Readonly<{ customerRemaining?: number; globalRemaining?: number }>
  >;
  coupon: 'NONE' | 'VALID' | 'UNKNOWN';
  shipping?: Readonly<{ eligibleChargeMinor: bigint }>;
  selectedGiftKeys?: ReadonlyMap<
    string,
    Readonly<{ key: string; variantId?: string; quantity?: number }>
  >;
  mixSelections?: ReadonlyMap<string, readonly string[]>;
}

export interface PromotionUnitAllocation {
  lineId: string;
  productId: string;
  variantId: string;
  quantity: number;
  taxClassId?: string;
}

export interface PromotionRewardAllocation {
  source: 'CART' | 'AUTOMATIC' | 'SELECTED_GIFT';
  selection: 'AUTOMATIC' | 'CUSTOMER';
  lineId?: string;
  productId: string;
  variantId: string;
  quantity: number;
  discountMinor: bigint;
  taxClassId?: string;
}

export interface PromotionCandidate {
  promotionId: string;
  applications: number;
  qualifyingUnits: readonly PromotionUnitAllocation[];
  rewardUnits: readonly PromotionRewardAllocation[];
  merchandiseDiscounts: readonly (PromotionUnitAllocation & {
    discountMinor: bigint;
  })[];
  merchandiseSavingsMinor: bigint;
  shippingSavingsMinor: bigint;
  currentTier?: number;
  nextTier?: number;
}

export interface PromotionGiftOption {
  key: string;
  productId: string;
  variantId: string;
  quantity: number;
  availability: 'AVAILABLE' | 'PROVISIONAL';
}

export type PromotionReason =
  | 'INACCESSIBLE'
  | 'INACTIVE'
  | 'AUDIENCE_MISMATCH'
  | 'CUSTOMER_HISTORY_UNKNOWN'
  | 'USAGE_EXHAUSTED'
  | 'USAGE_UNKNOWN'
  | 'MISSING_PRODUCTS'
  | 'MISSING_MIX_QUANTITY'
  | 'MISSING_SPEND'
  | 'NEXT_TIER'
  | 'ADDITIONAL_GROUP'
  | 'GIFT_SELECTION_REQUIRED'
  | 'GIFT_SELECTION_INVALID'
  | 'MIX_SELECTION_INVALID'
  | 'REWARD_UNAVAILABLE'
  | 'REWARD_STOCK_UNKNOWN'
  | 'SHIPPING_UNKNOWN'
  | 'NO_SAVING'
  | 'COUPON_PRECEDENCE'
  | 'COUPON_UNKNOWN'
  | 'UNIT_CONFLICT'
  | 'STACKING_RESTRICTED';

export interface PromotionGuidance {
  promotionId: string;
  reason: PromotionReason;
  missing?: readonly { selector: string; quantity: number }[];
  missingQuantity?: number;
  missingSpendMinor?: bigint;
  giftOptions?: readonly PromotionGiftOption[];
  currentTier?: number;
  nextTier?: number;
  additionalApplications?: number;
  conditionalBenefit?: 'FREE_SHIPPING' | 'REWARD';
}

export interface PromotionEvaluationResult {
  currency: string;
  currencyPrecision: number;
  applied: readonly PromotionCandidate[];
  eligibleUnapplied: readonly PromotionGuidance[];
  rejected: readonly { promotionId: string; reason: PromotionReason }[];
  recommendations: readonly PromotionGuidance[];
  remainingUnits: readonly PromotionUnitAllocation[];
  confirmedMerchandiseSavingsMinor: bigint;
  confirmedShippingSavingsMinor: bigint;
  warnings: readonly PromotionReason[];
  redemptionGuarantee: 'ADVISORY';
}

export type PromotionEvaluator = (
  promotions: readonly PromotionDefinition[],
  context: Readonly<PromotionEvaluationContext>,
) => PromotionEvaluationResult;
