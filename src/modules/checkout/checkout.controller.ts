import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  checkoutService,
} from './checkout.service.instance.js';

import type {
  CheckoutInput,
} from './checkout.types.js';

export class CheckoutController {
  checkout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError(
          'Authentication required',
          401,
          'UNAUTHORIZED',
        );
      }

      const idempotencyKey =
        req
          .header('Idempotency-Key')
          ?.trim();

      if (!idempotencyKey) {
        throw new AppError(
          'Idempotency-Key header is required',
          400,
          'IDEMPOTENCY_KEY_REQUIRED',
        );
      }

      if (
        idempotencyKey.length >
        255
      ) {
        throw new AppError(
          'Idempotency-Key is too long',
          400,
          'INVALID_IDEMPOTENCY_KEY',
        );
      }

      const input =
        req.validatedBody as CheckoutInput;

      const result =
        await checkoutService.checkout(
          input,
          {
            userId:
              req.user.userId,

            idempotencyKey,
          },
        );

      res
        .status(
          result.idempotent
            ? 200
            : 201,
        )
        .json({
          success: true,

          message:
            result.idempotent
              ? 'Checkout already processed'
              : 'Checkout completed successfully',

          data: result,
        });
    } catch (error) {
      next(error);
    }
  };
}

export const checkoutController =
  new CheckoutController();