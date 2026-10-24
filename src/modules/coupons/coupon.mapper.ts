import type {
  Coupon,
} from '../../generated/prisma/client.js';

export interface CouponResponse {
  id: string;

  code: string;

  discountType: Coupon['discountType'];

  discountValue: string;

  minimumOrderAmount: string | null;

  maximumDiscountAmount: string | null;

  startsAt: Date | null;

  endsAt: Date | null;

  usageLimit: number | null;

  usageCount: number;

  perUserLimit: number | null;

  isActive: boolean;

  createdAt: Date;

  updatedAt: Date;
}

export const mapCouponToResponse = (
  coupon: Coupon,
): CouponResponse => ({
  id: coupon.id,

  code: coupon.code,

  discountType:
    coupon.discountType,

  discountValue:
    coupon.discountValue.toString(),

  minimumOrderAmount:
    coupon.minimumOrderAmount?.toString() ??
    null,

  maximumDiscountAmount:
    coupon.maximumDiscountAmount?.toString() ??
    null,

  startsAt: coupon.startsAt,

  endsAt: coupon.endsAt,

  usageLimit:
    coupon.usageLimit,

  usageCount:
    coupon.usageCount,

  perUserLimit:
    coupon.perUserLimit,

  isActive:
    coupon.isActive,

  createdAt:
    coupon.createdAt,

  updatedAt:
    coupon.updatedAt,
});