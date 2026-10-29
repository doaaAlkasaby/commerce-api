import { Router } from 'express';

import {
  createBanner,
  deleteBanner,
  getBanner,
  listActiveBanners,
  listBanners,
  updateBanner,
} from './banner.controller.js';

import {
  bannerIdParamsSchema,
  createBannerSchema,
  updateBannerSchema,
} from './banner.schemas.js';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

const router = Router();
router.use(tenantMiddleware);

/*
 * Public
 */

router.get(
  '/',
  listActiveBanners,
);

router.get(
  '/:id',
  validate(
    bannerIdParamsSchema,
    'params',
  ),
  getBanner,
);

/*
 * Admin / Manager
 *
 * We keep the management listing separate.
 */

router.get(
  '/admin/all',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  listBanners,
);

router.post(
  '/',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    createBannerSchema,
    'body',
  ),
  createBanner,
);

router.patch(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    bannerIdParamsSchema,
    'params',
  ),
  validate(
    updateBannerSchema,
    'body',
  ),
  updateBanner,
);

router.delete(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    bannerIdParamsSchema,
    'params',
  ),
  deleteBanner,
);

export default router;
