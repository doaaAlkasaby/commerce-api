import { Router } from 'express';

import {
  paymentController,
} from './payment.controller.js';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  paymentIdParamsSchema,
  orderIdParamsSchema,
  paymentListQuerySchema,
  updatePaymentStatusSchema,
  refundPaymentSchema,
} from './payment.schemas.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  authorize,
} from '../../middleware/authorization.middleware.js';

const router = Router();

/**
 * Customer / authenticated user
 *
 * GET /api/v1/payments/:id
 */
router.get(
  '/:id',

  authenticate,

  validate(
    paymentIdParamsSchema,
    'params',
  ),

  paymentController.getPayment.bind(
    paymentController,
  ),
);

/**
 * Get payments belonging to an order.
 *
 * GET /api/v1/payments/order/:orderId
 */
router.get(
  '/order/:orderId',

  authenticate,

  validate(
    orderIdParamsSchema,
    'params',
  ),

  paymentController.getOrderPayments.bind(
    paymentController,
  ),
);

/**
 * Admin / Manager
 *
 * GET /api/v1/payments
 */
router.get(
  '/',

  authenticate,

  authorize(
    'ADMIN',
    'MANAGER',
  ),

  validate(
    paymentListQuerySchema,
    'query',
  ),

  paymentController.listPayments.bind(
    paymentController,
  ),
);

/**
 * Admin / Manager
 *
 * PATCH /api/v1/payments/:id/status
 */
router.patch(
  '/:id/status',

  authenticate,

  authorize(
    'ADMIN',
    'MANAGER',
  ),

  validate(
    paymentIdParamsSchema,
    'params',
  ),

  validate(
    updatePaymentStatusSchema,
    'body',
  ),

  paymentController.updatePaymentStatus.bind(
    paymentController,
  ),
);

/**
 * Admin / Manager
 *
 * POST /api/v1/payments/:id/cancel
 */
router.post(
  '/:id/cancel',

  authenticate,

  authorize(
    'ADMIN',
    'MANAGER',
  ),

  validate(
    paymentIdParamsSchema,
    'params',
  ),

  paymentController.cancelPayment.bind(
    paymentController,
  ),
);

/**
 * Admin
 *
 * POST /api/v1/payments/:id/refund
 */
router.post(
  '/:id/refund',

  authenticate,

  authorize(
    'ADMIN',
  ),

  validate(
    paymentIdParamsSchema,
    'params',
  ),

  validate(
    refundPaymentSchema,
    'body',
  ),

  paymentController.refundPayment.bind(
    paymentController,
  ),
);

export default router;