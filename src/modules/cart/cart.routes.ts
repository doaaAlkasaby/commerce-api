import { Router } from 'express';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';

import {
  addCartItemSchema,
  updateCartItemSchema,
  cartVariantParamsSchema,
} from './cart.schemas.js';

import { cartController } from './cart.controller.js';

const router = Router();

/**
 * Get current user's cart
 *
 * Tenant context
 *     ↓
 * Authentication
 *     ↓
 * Tenant membership
 *     ↓
 * Controller
 */
router.get(
  '/',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  cartController.getCart,
);

/**
 * Add item to cart
 */
router.post(
  '/items',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  validate(
    addCartItemSchema,
    'body',
  ),
  cartController.addItem,
);

/**
 * Update cart item quantity
 */
router.patch(
  '/items/:variantId',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
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
 * Remove item from cart
 */
router.delete(
  '/items/:variantId',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  validate(
    cartVariantParamsSchema,
    'params',
  ),
  cartController.removeItem,
);

/**
 * Clear current user's cart
 */
router.delete(
  '/',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  cartController.clearCart,
);

export default router;