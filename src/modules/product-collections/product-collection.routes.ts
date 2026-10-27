import { Router } from 'express';

import {
  addProduct,
  createCollection,
  deleteCollection,
  getCollection,
  getCollectionProducts,
  listCollections,
  removeProduct,
  updateCollection,
  updateProductOrder,
} from './product-collection.controller.js';

import {
  addProductToCollectionSchema,
  collectionIdParamsSchema,
  collectionProductsQuerySchema,
  collectionProductParamsSchema,
  createProductCollectionSchema,
  updateCollectionProductOrderSchema,
  updateProductCollectionSchema,
} from './product-collection.schemas.js';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorization.middleware.js';
import { optionalAuthenticate } from '../../middleware/optional-auth.middleware.js';




import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

const router = Router();
router.use(tenantMiddleware);

/*
 * Public
 */

router.get('/', 
   optionalAuthenticate,
  listCollections);

router.get(
  '/:id/products',
   optionalAuthenticate,
  validate(collectionIdParamsSchema, 'params'),
  validate(collectionProductsQuerySchema, 'query'),
  getCollectionProducts,
);

router.get('/:id', 
   optionalAuthenticate,
  validate(collectionIdParamsSchema, 'params'), getCollection);

/*
 * Admin / Manager
 */

router.post(
  '/',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(createProductCollectionSchema, 'body'),
  createCollection,
);

router.patch(
  '/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(collectionIdParamsSchema, 'params'),
  validate(updateProductCollectionSchema, 'body'),
  updateCollection,
);

router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(collectionIdParamsSchema, 'params'),
  deleteCollection,
);

router.post(
  '/:id/products',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(collectionIdParamsSchema, 'params'),
  validate(addProductToCollectionSchema, 'body'),
  addProduct,
);

router.delete(
  '/:id/products/:productId',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(collectionProductParamsSchema, 'params'),
  removeProduct,
);

router.patch(
  '/:id/products/:productId/order',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(collectionProductParamsSchema, 'params'),
  validate(updateCollectionProductOrderSchema, 'body'),
  updateProductOrder,
);

export default router;
