import { Router } from 'express';

import { couponController } from './coupon.controller.js';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';

import { authorize } from '../../middleware/authorization.middleware.js';

import {
  createCouponSchema,
  updateCouponSchema,
  couponIdParamsSchema,
  validateCouponSchema,
} from './coupon.schemas.js';

export const couponRouter = Router();

/*
 * Customer
 *
 * POST /coupons/validate
 */
couponRouter.post(
  '/validate',

  authenticate,

  validate(validateCouponSchema, 'body'),

  couponController.validate.bind(couponController),
);

/*
 * Admin / Manager
 *
 * POST /coupons
 */
couponRouter.post(
  '/',

  authenticate,

  authorize('ADMIN', 'MANAGER'),

  validate(createCouponSchema, 'body'),

  couponController.create.bind(couponController),
);

/*
 * GET /coupons
 */
couponRouter.get(
  '/',

  authenticate,

  authorize('ADMIN', 'MANAGER'),

  couponController.findAll.bind(couponController),
);

/*
 * GET /coupons/:id
 */
couponRouter.get(
  '/:id',

  authenticate,

  authorize('ADMIN', 'MANAGER'),

  validate(couponIdParamsSchema, 'params'),

  couponController.findById.bind(couponController),
);

/*
 * PATCH /coupons/:id
 */
couponRouter.patch(
  '/:id',

  authenticate,

  authorize('ADMIN', 'MANAGER'),

  validate(couponIdParamsSchema, 'params'),

  validate(updateCouponSchema, 'body'),

  couponController.update.bind(couponController),
);

/*
 * DELETE /coupons/:id
 */
couponRouter.delete(
  '/:id',

  authenticate,

  authorize('ADMIN'),

  validate(couponIdParamsSchema, 'params'),

  couponController.delete.bind(couponController),
);
