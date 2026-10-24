import { couponRepository } from './coupon.repository.instance.js';
import { CouponService } from './coupon.service.js';

export const couponService =
  new CouponService(couponRepository);