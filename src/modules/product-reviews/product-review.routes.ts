import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../common/validation/validate.js';

import {
  createProductReviewSchema,
  productReviewIdParamSchema,
  productReviewProductIdParamSchema,
  productReviewListQuerySchema,
  updateProductReviewSchema,
} from './product-review.schemas.js';

import { productReviewController } from './product-review.controller.js';

export const productReviewRouter = Router();

productReviewRouter.get(
  '/products/:productId/reviews',
  validate(productReviewProductIdParamSchema, 'params'),
  validate(productReviewListQuerySchema, 'query'),
  (req, res, next) => productReviewController.getProductReviews(req, res, next),
);

productReviewRouter.get(
  '/products/:productId/reviews/summary',
  validate(productReviewProductIdParamSchema, 'params'),
  (req, res, next) => productReviewController.getRatingSummary(req, res, next),
);

productReviewRouter.post(
  '/products/:productId/reviews',
  authenticate,
  validate(productReviewProductIdParamSchema, 'params'),
  validate(createProductReviewSchema, 'body'),
  (req, res, next) => productReviewController.createReview(req, res, next),
);

productReviewRouter.patch(
  '/products/:productId/reviews/:reviewId',
  authenticate,
  validate(productReviewIdParamSchema, 'params'),
  validate(updateProductReviewSchema, 'body'),
  (req, res, next) => productReviewController.updateReview(req, res, next),
);

productReviewRouter.delete(
  '/products/:productId/reviews/:reviewId',
  authenticate,
  validate(productReviewIdParamSchema, 'params'),
  (req, res, next) => productReviewController.deleteReview(req, res, next),
);
