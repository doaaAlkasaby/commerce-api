import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';

import { authorize } from '../../middleware/authorization.middleware.js';

import { validate } from '../../common/validation/validate.js';

import {
  createProductSchema,
  productListQuerySchema,
  productListingQuerySchema,
  updateProductSchema,
  productIdParamSchema,
  productStatusSchema,
} from './product.schemas.js';

import {
  createProduct,
  updateProduct,
  getProduct,
  listProducts,
  changeProductStatus,
  deleteProduct,
  getBestSellers,
  getNewArrivals,
  getOffers,
} from './product.controller.js';

import {
  optionalAuthenticate,
} from '../../middleware/optional-auth.middleware.js';


const router = Router();

router.get('/offers', optionalAuthenticate,validate(productListingQuerySchema, 'query'), getOffers);

router.get(
  '/best-sellers',
  optionalAuthenticate,
  validate(productListingQuerySchema, 'query'),
  getBestSellers,
);

router.get(
  '/new-arrivals',
  optionalAuthenticate,
  validate(productListingQuerySchema, 'query'),
  getNewArrivals,
);

router.get('/', optionalAuthenticate,
  validate(productListQuerySchema, 'query'), listProducts);

router.get('/:id', optionalAuthenticate,
  validate(productIdParamSchema, 'params'), getProduct);

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));

router.post('/', validate(createProductSchema, 'body'), createProduct);

router.patch(
  '/:id',
  validate(productIdParamSchema, 'params'),
  validate(updateProductSchema, 'body'),
  updateProduct,
);

router.patch(
  '/:id/status',
  validate(productIdParamSchema, 'params'),
  validate(productStatusSchema, 'body'),
  changeProductStatus,
);



router.delete('/:id', validate(productIdParamSchema, 'params'), deleteProduct);

export default router;
