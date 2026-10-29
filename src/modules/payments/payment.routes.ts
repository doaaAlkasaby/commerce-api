import { Router } from 'express';

import { paymentController } from './payment.controller.js';

import { validate } from '../../common/validation/validate.js';

import {
  initiatePaymentSchema,
  paymentIdParamsSchema,
  orderIdParamsSchema,
  paymentListQuerySchema,
  updatePaymentStatusSchema,
  refundPaymentSchema,
} from './payment.schemas.js';

import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

const router = Router();
router.use(tenantMiddleware);

router.post(
  '/:id/initiate',
  authenticate,
  validate(paymentIdParamsSchema, 'params'),
  validate(initiatePaymentSchema, 'body'),
  paymentController.initiatePayment.bind(paymentController),
);

/**
 * Customer / authenticated user
 *
 * GET /api/v1/payments/:id
 */
router.get(
  '/:id',

  authenticate,

  validate(paymentIdParamsSchema, 'params'),

  paymentController.getPayment.bind(paymentController),
);

/**
 * Get payments belonging to an order.
 *
 * GET /api/v1/payments/order/:orderId
 */
router.get(
  '/order/:orderId',

  authenticate,

  validate(orderIdParamsSchema, 'params'),

  paymentController.getOrderPayments.bind(paymentController),
);

/**
 * Admin / Manager
 *
 * GET /api/v1/payments
 */
router.get(
  '/',

  authenticate,

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),

  validate(paymentListQuerySchema, 'query'),

  paymentController.listPayments.bind(paymentController),
);

/**
 * Admin / Manager
 *
 * PATCH /api/v1/payments/:id/status
 */
router.patch(
  '/:id/status',

  authenticate,

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),

  validate(paymentIdParamsSchema, 'params'),

  validate(updatePaymentStatusSchema, 'body'),

  paymentController.updatePaymentStatus.bind(paymentController),
);

/**
 * Admin / Manager
 *
 * POST /api/v1/payments/:id/cancel
 */
router.post(
  '/:id/cancel',

  authenticate,

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),

  validate(paymentIdParamsSchema, 'params'),

  paymentController.cancelPayment.bind(paymentController),
);

/**
 * Admin
 *
 * POST /api/v1/payments/:id/refund
 */
router.post(
  '/:id/refund',

  authenticate,

  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN'),

  validate(paymentIdParamsSchema, 'params'),

  validate(refundPaymentSchema, 'body'),

  paymentController.refundPayment.bind(paymentController),
);

export default router;
