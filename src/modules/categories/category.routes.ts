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
  categoryController,
} from './category.controller.js';

import {
  productImageUpload,
} from '../../middleware/upload.middleware.js';

import {
  createCategorySchema,
  updateCategorySchema,
  categoryIdSchema,
} from './category.schemas.js';

import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

const router = Router();
router.use(tenantMiddleware);

/*
 * Public
 */

router.get(
  '/active',
  categoryController.getActive,
);

router.get(
  '/',
  categoryController.getAll,
);

router.get(
  '/:id',
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.getById,
);

router.get(
  '/:id/children',
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.getChildren,
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
    createCategorySchema,
    'body',
  ),
  categoryController.create,
);

router.patch(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    categoryIdSchema,
    'params',
  ),
  validate(
    updateCategorySchema,
    'body',
  ),
  categoryController.update,
);

router.patch(
  '/:id/status',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.updateStatus,
);

router.post(
  '/:id/image',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    categoryIdSchema,
    'params',
  ),
  productImageUpload.single('image'),
  categoryController.uploadImage,
);

router.delete(
  '/:id/image',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.deleteImage,
);

router.delete(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.delete,
);

export default router;
