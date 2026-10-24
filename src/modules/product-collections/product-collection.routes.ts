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

const router = Router();

/*
 * Public
 */

router.get('/', listCollections);

router.get(
  '/:id/products',
  validate(collectionIdParamsSchema, 'params'),
  validate(collectionProductsQuerySchema, 'query'),
  getCollectionProducts,
);

router.get('/:id', validate(collectionIdParamsSchema, 'params'), getCollection);

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
