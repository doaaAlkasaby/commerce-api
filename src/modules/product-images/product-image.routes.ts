import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../common/validation/validate.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

import {
  productImageController,
} from './product-image.controller.js';

import {
  createProductImageSchema,
  productImageIdSchema,
  productImageProductIdSchema,
  updateProductImageSchema,
} from './product-image.schemas.js';

import {
  productImageUpload,
} from '../../middleware/upload.middleware.js';


const router = Router();
router.use(tenantMiddleware);

router.get(
  '/product/:productId',
  validate(
    productImageProductIdSchema,
    'params',
  ),
  productImageController.listByProduct,
);

router.get(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    productImageIdSchema,
    'params',
  ),
  productImageController.getById,
);

router.post(
  '/',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    createProductImageSchema,
    'body',
  ),
  productImageController.create,
);

router.patch(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    productImageIdSchema,
    'params',
  ),
  validate(
    updateProductImageSchema,
    'body',
  ),
  productImageController.update,
);

router.patch(
  '/:id/primary',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    productImageIdSchema,
    'params',
  ),
  productImageController.setPrimary,
);

router.delete(
  '/:id',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(
    productImageIdSchema,
    'params',
  ),
  productImageController.delete,
);

router.post(
  '/upload',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  productImageUpload.single('image'),
  productImageController.upload,
);


export default router;
