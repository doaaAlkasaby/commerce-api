import { Router } from 'express';

import {
  UserRole,
} from '../../generated/prisma/client.js';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  authorize,
} from '../../middleware/authorization.middleware.js';

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
  authorize(UserRole.ADMIN),
  validate(
    createCategorySchema,
    'body',
  ),
  categoryController.create,
);

router.patch(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
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
  authorize(UserRole.ADMIN),
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.updateStatus,
);

router.post(
  '/:id/image',
  authenticate,
  authorize(UserRole.ADMIN),
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
  authorize(UserRole.ADMIN),
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.deleteImage,
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  validate(
    categoryIdSchema,
    'params',
  ),
  categoryController.delete,
);

export default router;
