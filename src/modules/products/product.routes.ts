import { Router } from 'express';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';
import { optionalAuthenticate } from '../../middleware/optional-auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

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

const router = Router();

/**
 * ============================================================
 * PUBLIC PRODUCT APIs
 * ============================================================
 *
 * Tenant context
 *     ↓
 * Optional authentication
 *     ↓
 * Validation
 *     ↓
 * Controller
 *
 * Login is NOT required.
 */

/**
 * Get products with active offers
 */
router.get(
  '/offers',
  tenantMiddleware,
  optionalAuthenticate,
  validate(
    productListingQuerySchema,
    'query',
  ),
  getOffers,
);

/**
 * Get best-selling products
 */
router.get(
  '/best-sellers',
  tenantMiddleware,
  optionalAuthenticate,
  validate(
    productListingQuerySchema,
    'query',
  ),
  getBestSellers,
);

/**
 * Get newest products
 */
router.get(
  '/new-arrivals',
  tenantMiddleware,
  optionalAuthenticate,
  validate(
    productListingQuerySchema,
    'query',
  ),
  getNewArrivals,
);

/**
 * List products
 */
router.get(
  '/',
  tenantMiddleware,
  optionalAuthenticate,
  validate(
    productListQuerySchema,
    'query',
  ),
  listProducts,
);

/**
 * Get product details
 */
router.get(
  '/:id',
  tenantMiddleware,
  optionalAuthenticate,
  validate(
    productIdParamSchema,
    'params',
  ),
  getProduct,
);

/**
 * ============================================================
 * PROTECTED PRODUCT ADMIN APIs
 * ============================================================
 *
 * Tenant context
 *     ↓
 * Authentication
 *     ↓
 * Tenant membership
 *     ↓
 * Tenant role authorization
 *     ↓
 * Validation
 *     ↓
 * Controller
 *
 * Allowed tenant roles:
 * OWNER
 * ADMIN
 * MANAGER
 */

/**
 * Create product
 */
router.post(
  '/',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles(
    'OWNER',
    'ADMIN',
    'MANAGER',
  ),
  validate(
    createProductSchema,
    'body',
  ),
  createProduct,
);

/**
 * Update product
 */
router.patch(
  '/:id',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles(
    'OWNER',
    'ADMIN',
    'MANAGER',
  ),
  validate(
    productIdParamSchema,
    'params',
  ),
  validate(
    updateProductSchema,
    'body',
  ),
  updateProduct,
);

/**
 * Change product status
 */
router.patch(
  '/:id/status',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles(
    'OWNER',
    'ADMIN',
    'MANAGER',
  ),
  validate(
    productIdParamSchema,
    'params',
  ),
  validate(
    productStatusSchema,
    'body',
  ),
  changeProductStatus,
);

/**
 * Delete product
 */
router.delete(
  '/:id',
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles(
    'OWNER',
    'ADMIN',
    'MANAGER',
  ),
  validate(
    productIdParamSchema,
    'params',
  ),
  deleteProduct,
);

export default router;