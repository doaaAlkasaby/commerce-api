import type { PromotionStatus, PromotionWindow } from './promotion.types.js';

export function promotionStatus(
  window: PromotionWindow,
  now: Date,
): PromotionStatus {
  if (window.publication === 'DRAFT') return 'DRAFT';
  if (window.publication === 'ENDED' || (window.endsAt && now >= window.endsAt))
    return 'ENDED';
  if (window.publication === 'PAUSED') return 'PAUSED';
  if (window.startsAt && now < window.startsAt) return 'SCHEDULED';
  return 'ACTIVE';
}
