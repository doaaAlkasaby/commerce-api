import { Router } from 'express';


import {
  validate,
} from '../../common/validation/validate.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

import {
  brandController,
} from './brand.controller.js';

import {
  productImageUpload,
} from '../../middleware/upload.middleware.js';

import {
  createBrandSchema,
  updateBrandSchema,
  brandIdSchema,
} from './brand.schemas.js';

import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

const router = Router();
router.use(tenantMiddleware);

/*
 * Public
 */

router.get(
  '/active',
  brandController.getActive,
);

router.get(
  '/',
  brandController.getAll,
);

router.get(
  '/:id',
  validate(
    brandIdSchema,
    'params',
  ),
  brandController.getById,
);

/*
 * Admin
 */

router.post(
  '/',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    createBrandSchema,
    'body',
  ),
  brandController.create,
);

router.patch(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    brandIdSchema,
    'params',
  ),
  validate(
    updateBrandSchema,
    'body',
  ),
  brandController.update,
);

router.patch(
  '/:id/status',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    brandIdSchema,
    'params',
  ),
  brandController.updateStatus,
);

router.post(
  '/:id/image',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    brandIdSchema,
    'params',
  ),
  productImageUpload.single('image'),
  brandController.uploadImage,
);

router.delete(
  '/:id/image',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    brandIdSchema,
    'params',
  ),
  brandController.deleteImage,
);

router.delete(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    brandIdSchema,
    'params',
  ),
  brandController.delete,
);

export default router;
