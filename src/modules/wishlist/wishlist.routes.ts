import { Router } from 'express';

import {
  addProduct,
  checkProduct,
  getWishlist,
  removeProduct,
} from './wishlist.controller.js';

import {
  addWishlistItemSchema,
  wishlistProductParamsSchema,
} from './wishlist.schemas.js';

import { validate } from '../../common/validation/validate.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

const router = Router();

router.use(tenantMiddleware);
router.use(authenticate);

router.get(
  '/',
  getWishlist,
);

router.post(
  '/items',
  validate(
    addWishlistItemSchema,
    'body',
  ),
  addProduct,
);

router.delete(
  '/items/:productId',
  validate(
    wishlistProductParamsSchema,
    'params',
  ),
  removeProduct,
);

router.get(
  '/check/:productId',
  validate(
    wishlistProductParamsSchema,
    'params',
  ),
  checkProduct,
);

export default router;
