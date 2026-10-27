import {
  Router,
} from 'express';

import {
  UserRole,
} from '../../generated/prisma/client.js';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  authorize,
} from '../../middleware/authorization.middleware.js';

import {
  orderController,
} from './order.controller.js';

import {
  orderIdParamsSchema,
  orderListQuerySchema,
  updateOrderStatusSchema,
} from './order.schemas.js';

import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

const router =
  Router();
router.use(tenantMiddleware);

/*
 * CUSTOMER
 */

router.get(
  '/my',
  authenticate,
  validate(
    orderListQuerySchema,
    'query',
  ),
  orderController.getMyOrders,
);

router.get(
  '/my/:id',
  authenticate,
  validate(
    orderIdParamsSchema,
    'params',
  ),
  orderController.getMyOrder,
);

/*
 * ADMIN / MANAGER
 */

router.get(
  '/',
  authenticate,
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
  validate(
    orderListQuerySchema,
    'query',
  ),
  orderController.getOrders,
);

router.get(
  '/:id',
  authenticate,
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
  validate(
    orderIdParamsSchema,
    'params',
  ),
  orderController.getOrder,
);

router.patch(
  '/:id/status',
  authenticate,
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
  validate(
    orderIdParamsSchema,
    'params',
  ),
  validate(
    updateOrderStatusSchema,
    'body',
  ),
  orderController.updateStatus,
);

export default router;
