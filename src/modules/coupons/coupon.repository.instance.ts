import { prisma } from '../../config/database.js';
import { CouponRepository } from './coupon.repository.js';

export const couponRepository =
  new CouponRepository(prisma);