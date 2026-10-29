import {
  Router,
} from 'express';


import {
  validate,
} from '../../common/validation/validate.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

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
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    orderListQuerySchema,
    'query',
  ),
  orderController.getOrders,
);

router.get(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    orderIdParamsSchema,
    'params',
  ),
  orderController.getOrder,
);

router.patch(
  '/:id/status',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
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
