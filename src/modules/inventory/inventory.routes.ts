import {
  Router,
} from 'express';


import {
  authenticate,
} from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  inventoryController,
} from './inventory.controller.js';

import {
  createInventorySchema,
  inventoryIdParamsSchema,
  inventoryVariantParamsSchema,
  inventoryListQuerySchema,
  transactionListQuerySchema,
  stockInSchema,
  stockOutSchema,
  adjustmentSchema,
} from './inventory.schemas.js';

const router =
  Router();
router.use(tenantMiddleware);

/*
 * ==================================================
 * LIST
 * ==================================================
 */

router.get(
  '/',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    inventoryListQuerySchema,
    'query',
  ),
  inventoryController.list.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * CREATE
 * ==================================================
 */

router.post(
  '/',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    createInventorySchema,
    'body',
  ),
  inventoryController.create.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * VARIANT INVENTORY
 * ==================================================
 */

router.get(
  '/variant/:variantId',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    inventoryVariantParamsSchema,
    'params',
  ),
  inventoryController.getByVariantId.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * SINGLE INVENTORY
 * ==================================================
 */

router.get(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  inventoryController.getById.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * TRANSACTIONS
 * ==================================================
 */

router.get(
  '/:id/transactions',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  validate(
    transactionListQuerySchema,
    'query',
  ),
  inventoryController.transactions.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * STOCK IN
 * ==================================================
 */

router.post(
  '/:id/stock-in',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  validate(
    stockInSchema,
    'body',
  ),
  inventoryController.stockIn.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * STOCK OUT
 * ==================================================
 */

router.post(
  '/:id/stock-out',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  validate(
    stockOutSchema,
    'body',
  ),
  inventoryController.stockOut.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * ADJUSTMENT
 * ==================================================
 */

router.post(
  '/:id/adjust',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  validate(
    adjustmentSchema,
    'body',
  ),
  inventoryController.adjustment.bind(
    inventoryController,
  ),
);

export default router;
