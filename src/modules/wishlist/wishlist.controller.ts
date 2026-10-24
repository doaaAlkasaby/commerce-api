import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  wishlistProductParamsSchema,
} from './wishlist.schemas.js';

import { wishlistService } from './wishlist.service.instance.js';

const getWishlistProductId = (
  req: Request,
): string => {
  const result = wishlistProductParamsSchema.safeParse(
    req.validatedParams ?? req.params,
  );

  if (!result.success) {
    throw new AppError(
      'Invalid wishlist product ID',
      400,
      'INVALID_WISHLIST_PRODUCT_ID',
    );
  }

  return result.data.productId;
};

export const getWishlist = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await wishlistService.getWishlist(
        req.user!.userId,
      );

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const addProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { productId } =
      req.validatedBody as {
        productId: string;
      };

    const data =
      await wishlistService.addProduct(
        req.user!.userId,
        productId,
      );

    res.status(201).json({
      success: true,
      message: 'Product added to wishlist successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const removeProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await wishlistService.removeProduct(
      req.user!.userId,
      getWishlistProductId(req),
    );

    res.status(200).json({
      success: true,
      message:
        'Product removed from wishlist successfully',
      data: null,
    });
  } catch (error) {
    next(error);
  }
};

export const checkProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await wishlistService.isProductInWishlist(
        req.user!.userId,
        getWishlistProductId(req),
      );

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};