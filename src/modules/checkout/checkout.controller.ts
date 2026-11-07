import { getIdempotencyKey } from './checkout.idempotency.js';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error.js';

import { checkoutService } from './checkout.service.instance.js';

import type { CheckoutInput, CheckoutPreviewInput } from './checkout.types.js';

export class CheckoutController {
  shippingOptions: import('express').RequestHandler = async (
    req,
    res,
    next,
  ) => {
    try {
      res.json({
        success: true,
        message: null,
        data: await checkoutService.shippingOptions(
          req.validatedBody as CheckoutPreviewInput,
          { tenantId: req.tenant!.tenantId, userId: req.user!.userId },
        ),
      });
    } catch (error) {
      next(error);
    }
  };
  preview = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user)
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      const result = await checkoutService.preview(
        req.validatedBody as CheckoutPreviewInput,
        { tenantId: req.tenant!.tenantId, userId: req.user.userId },
      );
      res.status(200).json({ success: true, message: null, data: result });
    } catch (error) {
      next(error);
    }
  };

  checkout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const idempotencyKey = getIdempotencyKey(req);

      const input = req.validatedBody as CheckoutInput;

      const result = await checkoutService.checkout(input, {
        tenantId: req.tenant!.tenantId,
        userId: req.user.userId,

        idempotencyKey,
      });

      res.status(result.idempotent ? 200 : 201).json({
        success: true,

        message: null,

        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const checkoutController = new CheckoutController();
