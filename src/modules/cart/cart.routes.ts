import {
  Router,
} from 'express';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  addCartItemSchema,
  updateCartItemSchema,
  cartVariantParamsSchema,
} from './cart.schemas.js';

import {
  cartController,
} from './cart.controller.js';

const router =
  Router();

/**
 * Get current user's cart.
 */
router.get(
  '/',
  authenticate,
  cartController.getCart,
);

/**
 * Add variant to cart.
 */
router.post(
  '/items',
  authenticate,
  validate(
    addCartItemSchema,
    'body',
  ),
  cartController.addItem,
);

/**
 * Update variant quantity.
 */
router.patch(
  '/items/:variantId',
  authenticate,
  validate(
    cartVariantParamsSchema,
    'params',
  ),
  validate(
    updateCartItemSchema,
    'body',
  ),
  cartController.updateItem,
);

/**
 * Remove variant from cart.
 */
router.delete(
  '/items/:variantId',
  authenticate,
  validate(
    cartVariantParamsSchema,
    'params',
  ),
  cartController.removeItem,
);

/**
 * Clear cart.
 */
router.delete(
  '/',
  authenticate,
  cartController.clearCart,
);

export default router;