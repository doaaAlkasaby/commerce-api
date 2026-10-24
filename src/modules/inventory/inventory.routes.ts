import {
  Router,
} from 'express';

import {
  UserRole,
} from '../../generated/prisma/client.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  authorize,
} from '../../middleware/authorization.middleware.js';

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
  reservationSchema,
  releaseSchema,
  saleSchema,
} from './inventory.schemas.js';

const router =
  Router();

/*
 * ==================================================
 * LIST
 * ==================================================
 */

router.get(
  '/',
  authenticate,
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
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

/*
 * ==================================================
 * RESERVE
 * ==================================================
 */

router.post(
  '/:id/reserve',
  authenticate,
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  validate(
    reservationSchema,
    'body',
  ),
  inventoryController.reserve.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * RELEASE
 * ==================================================
 */

router.post(
  '/:id/release',
  authenticate,
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  validate(
    releaseSchema,
    'body',
  ),
  inventoryController.release.bind(
    inventoryController,
  ),
);

/*
 * ==================================================
 * SALE
 * ==================================================
 */

router.post(
  '/:id/sale',
  authenticate,
  authorize(
    UserRole.ADMIN,
    UserRole.MANAGER,
  ),
  validate(
    inventoryIdParamsSchema,
    'params',
  ),
  validate(
    saleSchema,
    'body',
  ),
  inventoryController.sale.bind(
    inventoryController,
  ),
);

export default router;