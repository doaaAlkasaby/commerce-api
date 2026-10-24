import { CouponDiscountType } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

import {
  calculateDiscountAmount,
  toCents,
  centsToString,
} from '../../common/pricing/pricing.service.js';

import type { CouponRepository } from './coupon.repository.js';

import type {
  CreateCouponInput,
  UpdateCouponInput,
  ValidateCouponInput,
  CouponValidationResult,
} from './coupon.types.js';

export class CouponService {
  constructor(private readonly repository: CouponRepository) {}

  async create(input: CreateCouponInput) {
    const code = input.code.trim().toUpperCase();

    const existing = await this.repository.findByCode(code);

    if (existing) {
      throw new AppError(
        'Coupon code already exists',
        409,
        'COUPON_CODE_ALREADY_EXISTS',
      );
    }

    this.validateBusinessRules(input);

    return this.repository.create({
      ...input,
      code,
    });
  }

  async findById(id: string) {
    const coupon = await this.repository.findById(id);

    if (!coupon) {
      throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
    }

    return coupon;
  }

  async findAll() {
    return this.repository.findAll();
  }

  async update(id: string, input: UpdateCouponInput) {
    const existing = await this.repository.findById(id);

    if (!existing) {
      throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
    }

    const code =
      input.code !== undefined
        ? input.code.trim().toUpperCase()
        : existing.code;

    if (code !== existing.code) {
      const duplicate = await this.repository.findByCode(code);

      if (duplicate) {
        throw new AppError(
          'Coupon code already exists',
          409,
          'COUPON_CODE_ALREADY_EXISTS',
        );
      }
    }

    const merged: CreateCouponInput = {
      code,

      discountType: input.discountType ?? existing.discountType,

      discountValue: input.discountValue ?? existing.discountValue.toString(),

      minimumOrderAmount:
        input.minimumOrderAmount !== undefined
          ? input.minimumOrderAmount
          : (existing.minimumOrderAmount?.toString() ?? null),

      maximumDiscountAmount:
        input.maximumDiscountAmount !== undefined
          ? input.maximumDiscountAmount
          : (existing.maximumDiscountAmount?.toString() ?? null),

      startsAt:
        input.startsAt !== undefined ? input.startsAt : existing.startsAt,

      endsAt: input.endsAt !== undefined ? input.endsAt : existing.endsAt,

      usageLimit:
        input.usageLimit !== undefined ? input.usageLimit : existing.usageLimit,

      perUserLimit:
        input.perUserLimit !== undefined
          ? input.perUserLimit
          : existing.perUserLimit,

      isActive:
        input.isActive !== undefined ? input.isActive : existing.isActive,
    };

    this.validateBusinessRules(merged);

    return this.repository.update(id, {
      ...input,
      code,
    });
  }

  async delete(id: string) {
    const coupon = await this.repository.findById(id);

    if (!coupon) {
      throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
    }

    if (coupon.usageCount > 0) {
      throw new AppError(
        'A coupon that has already been used cannot be deleted. Deactivate it instead.',
        409,
        'COUPON_ALREADY_USED',
      );
    }

    await this.repository.delete(id);
  }

  async validate(input: ValidateCouponInput): Promise<CouponValidationResult> {
    const code = input.code.trim().toUpperCase();

    const coupon = await this.repository.findByCode(code);

    if (!coupon) {
      throw new AppError('Invalid coupon code', 400, 'INVALID_COUPON');
    }

    this.validateAvailability(coupon);

    const subtotalCents = toCents(input.subtotal);

    if (coupon.minimumOrderAmount !== null) {
      const minimumCents = toCents(coupon.minimumOrderAmount.toString());

      if (subtotalCents < minimumCents) {
        throw new AppError(
          `Minimum order amount is ${coupon.minimumOrderAmount.toString()}`,
          400,
          'MINIMUM_ORDER_AMOUNT_NOT_MET',
        );
      }
    }

    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      throw new AppError(
        'Coupon usage limit has been reached',
        400,
        'COUPON_USAGE_LIMIT_REACHED',
      );
    }

    if (coupon.perUserLimit !== null) {
      const userUsage = await this.repository.countUserUsage(
        coupon.id,
        input.userId,
      );

      if (userUsage >= coupon.perUserLimit) {
        throw new AppError(
          'You have reached the usage limit for this coupon',
          400,
          'COUPON_USER_LIMIT_REACHED',
        );
      }
    }

    let discountCents: bigint;

    if (coupon.discountType === CouponDiscountType.FIXED_AMOUNT) {
      const fixedDiscount = toCents(coupon.discountValue.toString());

      discountCents =
        fixedDiscount > subtotalCents ? subtotalCents : fixedDiscount;
    } else {
      discountCents = calculateDiscountAmount(
        subtotalCents,
        'PERCENTAGE',
        coupon.discountValue.toString(),
      );

      if (coupon.maximumDiscountAmount !== null) {
        const maximumCents = toCents(coupon.maximumDiscountAmount.toString());

        if (discountCents > maximumCents) {
          discountCents = maximumCents;
        }
      }
    }

    if (discountCents > subtotalCents) {
      discountCents = subtotalCents;
    }

    const finalSubtotal = subtotalCents - discountCents;

    return {
      couponId: coupon.id,

      code: coupon.code,

      discountType: coupon.discountType,

      discountValue: coupon.discountValue.toString(),

      subtotal: centsToString(subtotalCents),

      discountAmount: centsToString(discountCents),

      finalSubtotal: centsToString(finalSubtotal),
    };
  }

  private validateAvailability(coupon: {
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
  }): void {
    if (!coupon.isActive) {
      throw new AppError('Coupon is inactive', 400, 'COUPON_INACTIVE');
    }

    const now = new Date();

    if (coupon.startsAt && now < coupon.startsAt) {
      throw new AppError('Coupon is not active yet', 400, 'COUPON_NOT_STARTED');
    }

    if (coupon.endsAt && now > coupon.endsAt) {
      throw new AppError('Coupon has expired', 400, 'COUPON_EXPIRED');
    }
  }

  private validateBusinessRules(input: CreateCouponInput): void {
    const discountValue = Number(input.discountValue);

    if (input.discountType === CouponDiscountType.PERCENTAGE) {
      if (discountValue <= 0 || discountValue > 100) {
        throw new AppError(
          'Percentage discount must be between 0 and 100',
          400,
          'INVALID_COUPON_DISCOUNT',
        );
      }
    } else {
      if (discountValue <= 0) {
        throw new AppError(
          'Fixed discount must be greater than zero',
          400,
          'INVALID_COUPON_DISCOUNT',
        );
      }
    }

    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw new AppError(
        'endsAt must be after startsAt',
        400,
        'INVALID_COUPON_DATES',
      );
    }

    if (
      input.minimumOrderAmount !== null &&
      input.minimumOrderAmount !== undefined &&
      Number(input.minimumOrderAmount) < 0
    ) {
      throw new AppError(
        'Minimum order amount cannot be negative',
        400,
        'INVALID_MINIMUM_ORDER_AMOUNT',
      );
    }

    if (
      input.maximumDiscountAmount !== null &&
      input.maximumDiscountAmount !== undefined &&
      Number(input.maximumDiscountAmount) <= 0
    ) {
      throw new AppError(
        'Maximum discount amount must be greater than zero',
        400,
        'INVALID_MAXIMUM_DISCOUNT_AMOUNT',
      );
    }
  }
}
