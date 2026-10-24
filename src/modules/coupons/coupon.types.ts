import type {
  CouponDiscountType,
} from '../../generated/prisma/client.js';

export interface CreateCouponInput {
  code: string;

  discountType: CouponDiscountType;

  discountValue: string;

  minimumOrderAmount?: string | null;

  maximumDiscountAmount?: string | null;

  startsAt?: Date | null;

  endsAt?: Date | null;

  usageLimit?: number | null;

  perUserLimit?: number | null;

  isActive?: boolean;
}

export interface UpdateCouponInput {
  code?: string;

  discountType?: CouponDiscountType;

  discountValue?: string;

  minimumOrderAmount?: string | null;

  maximumDiscountAmount?: string | null;

  startsAt?: Date | null;

  endsAt?: Date | null;

  usageLimit?: number | null;

  perUserLimit?: number | null;

  isActive?: boolean;
}

export interface ValidateCouponInput {
  code: string;

  userId: string;

  subtotal: string;
}

export interface CouponValidationResult {
  couponId: string;

  code: string;

  discountType: CouponDiscountType;

  discountValue: string;

  subtotal: string;

  discountAmount: string;

  finalSubtotal: string;
}