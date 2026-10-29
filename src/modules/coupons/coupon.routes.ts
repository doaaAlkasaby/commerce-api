import { Router } from 'express';

import { couponController } from './coupon.controller.js';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';

import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

import {
  createCouponSchema,
  updateCouponSchema,
  couponIdParamsSchema,
  validateCouponSchema,
} from './coupon.schemas.js';

export const couponRouter = Router();
couponRouter.use(tenantMiddleware);

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

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),

  validate(createCouponSchema, 'body'),

  couponController.create.bind(couponController),
);

/*
 * GET /coupons
 */
couponRouter.get(
  '/',

  authenticate,

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),

  couponController.findAll.bind(couponController),
);

/*
 * GET /coupons/:id
 */
couponRouter.get(
  '/:id',

  authenticate,

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),

  validate(couponIdParamsSchema, 'params'),

  couponController.findById.bind(couponController),
);

/*
 * PATCH /coupons/:id
 */
couponRouter.patch(
  '/:id',

  authenticate,

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),

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

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN'),

  validate(couponIdParamsSchema, 'params'),

  couponController.delete.bind(couponController),
);
