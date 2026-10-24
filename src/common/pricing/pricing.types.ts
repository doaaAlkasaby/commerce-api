import type {
  DiscountType,
} from '../../generated/prisma/client.js';

export interface DiscountInput {
  type: DiscountType | null;
  value: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface EffectivePrice {
  basePrice: string;
  discountType: DiscountType | null;
  discountValue: string;
  discountAmount: string;
  finalPrice: string;
}