import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  cartService,
} from './cart.service.instance.js';

import type {
  AddCartItemInput,
  UpdateCartItemInput,
} from './cart.types.js';

export class CartController {
  /**
   * GET /cart
   */
  getCart = async (
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

      const cart =
        await cartService.getCart(
          req.user.userId,
        );

      res.status(200).json({
        success: true,
        message: null,
        data: cart,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /cart/items
   */
  addItem = async (
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

      const input =
        req.validatedBody as AddCartItemInput;

      const cart =
        await cartService.addItem(
          req.user.userId,
          input,
        );

      res.status(200).json({
        success: true,
        message:
          'Item added to cart',
        data: cart,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /cart/items/:variantId
   */
  updateItem = async (
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

      const params =
        req.validatedParams as {
          variantId: string;
        };

      const input =
        req.validatedBody as UpdateCartItemInput;

      const cart =
        await cartService.updateItem(
          req.user.userId,
          params.variantId,
          input,
        );

      res.status(200).json({
        success: true,
        message:
          'Cart item updated',
        data: cart,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /cart/items/:variantId
   */
  removeItem = async (
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

      const params =
        req.validatedParams as {
          variantId: string;
        };

      const cart =
        await cartService.removeItem(
          req.user.userId,
          params.variantId,
        );

      res.status(200).json({
        success: true,
        message:
          'Item removed from cart',
        data: cart,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /cart
   */
  clearCart = async (
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

      const cart =
        await cartService.clearCart(
          req.user.userId,
        );

      res.status(200).json({
        success: true,
        message:
          'Cart cleared',
        data: cart,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const cartController =
  new CartController();