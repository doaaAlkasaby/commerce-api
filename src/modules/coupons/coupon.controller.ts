import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  couponService,
} from './coupon.service.instance.js';

import {
  mapCouponToResponse,
} from './coupon.mapper.js';

export class CouponController {
  async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const coupon =
        await couponService.create(
          req.tenant!.tenantId,
          req.validatedBody as any,
        );

      res.status(201).json({
        success: true,
        message: null,
        data: mapCouponToResponse(
          coupon,
        ),
      });
    } catch (error) {
      next(error);
    }
  }

  async findAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const coupons =
        await couponService.findAll(req.tenant!.tenantId);

      res.status(200).json({
        success: true,
        message: null,
        data: coupons.map(
          mapCouponToResponse,
        ),
      });
    } catch (error) {
      next(error);
    }
  }

  async findById(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } =
        req.validatedParams as {
          id: string;
        };

      const coupon =
        await couponService.findById(req.tenant!.tenantId, id);

      res.status(200).json({
        success: true,
        message: null,
        data: mapCouponToResponse(
          coupon,
        ),
      });
    } catch (error) {
      next(error);
    }
  }

  async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } =
        req.validatedParams as {
          id: string;
        };

      const coupon =
        await couponService.update(
          req.tenant!.tenantId,
          id,
          req.validatedBody as any,
        );

      res.status(200).json({
        success: true,
        message: null,
        data: mapCouponToResponse(
          coupon,
        ),
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } =
        req.validatedParams as {
          id: string;
        };

      await couponService.delete(req.tenant!.tenantId, id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  async validate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId =
        req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'UNAUTHORIZED',
          data: null,
        });

        return;
      }

      const body =
        req.validatedBody as {
          code: string;
          subtotal: string;
        };

      const result =
        await couponService.validate(req.tenant!.tenantId, {
          code: body.code,
          subtotal: body.subtotal,
          userId,
        });

      res.status(200).json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const couponController =
  new CouponController();
