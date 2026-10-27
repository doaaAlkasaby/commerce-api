import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

import { AppError } from '../../common/errors/app-error.js';

import {
  createProductReviewSchema,
  productReviewIdParamSchema,
  productReviewListQuerySchema,
  productReviewProductIdParamSchema,
  updateProductReviewSchema,
} from './product-review.schemas.js';
import { productReviewService } from './product-review.service.instance.js';

const parseRequestValue = <T>(
  value: unknown,
  schema: ZodType<T>,
  message: string,
): T => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError(message, 400, 'VALIDATION_ERROR');
  }

  return result.data;
};

const getProductId = (req: Request): string =>
  parseRequestValue(
    req.validatedParams ?? req.params,
    productReviewProductIdParamSchema,
    'Invalid product ID',
  ).productId;

const getReviewParams = (req: Request) =>
  parseRequestValue(
    req.validatedParams ?? req.params,
    productReviewIdParamSchema,
    'Invalid review parameters',
  );

const getUserId = (req: Request): string => {
  const userId = req.user?.userId;

  if (!userId) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  return userId;
};

export class ProductReviewController {
  async createReview(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const input = parseRequestValue(
        req.validatedBody ?? req.body,
        createProductReviewSchema,
        'Invalid review data',
      );
      const review = await productReviewService.createReview(
        req.tenant!.tenantId,
        getProductId(req),
        getUserId(req),
        input,
      );

      res.status(201).json({
        success: true,
        message: 'Review created successfully',
        data: review,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateReview(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const params = getReviewParams(req);
      const input = parseRequestValue(
        req.validatedBody ?? req.body,
        updateProductReviewSchema,
        'Invalid review data',
      );
      const review = await productReviewService.updateReview(
        req.tenant!.tenantId,
        params.productId,
        params.reviewId,
        getUserId(req),
        input,
      );

      res.status(200).json({
        success: true,
        message: 'Review updated successfully',
        data: review,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteReview(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const params = getReviewParams(req);
      await productReviewService.deleteReview(
        req.tenant!.tenantId,
        params.productId,
        params.reviewId,
        getUserId(req),
      );

      res.status(200).json({
        success: true,
        message: 'Review deleted successfully',
        data: null,
      });
    } catch (error) {
      next(error);
    }
  }

  async getProductReviews(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const query = parseRequestValue(
        req.validatedQuery ?? req.query,
        productReviewListQuerySchema,
        'Invalid review query',
      );
      const result = await productReviewService.getProductReviews(
        req.tenant!.tenantId,
        getProductId(req),
        query,
      );

      res.status(200).json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getRatingSummary(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const summary = await productReviewService.getRatingSummary(
        req.tenant!.tenantId,
        getProductId(req),
      );

      res.status(200).json({
        success: true,
        message: null,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const productReviewController = new ProductReviewController();
