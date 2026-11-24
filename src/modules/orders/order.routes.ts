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
  confirmCodPaymentSchema,
  confirmCodReturnSchema,
  markCodRefusedSchema,
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

router.post(
  '/:id/cod/confirm-payment',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN'),
  validate(
    orderIdParamsSchema,
    'params',
  ),
  validate(
    confirmCodPaymentSchema,
    'body',
  ),
  orderController.confirmCodPayment,
);

router.post(
  '/:id/cod/mark-refused',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    orderIdParamsSchema,
    'params',
  ),
  validate(
    markCodRefusedSchema,
    'body',
  ),
  orderController.markCodDeliveryRefused,
);

router.post(
  '/:id/cod/confirm-return',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN'),
  validate(
    orderIdParamsSchema,
    'params',
  ),
  validate(
    confirmCodReturnSchema,
    'body',
  ),
  orderController.confirmCodWarehouseReturn,
);

export default router;
