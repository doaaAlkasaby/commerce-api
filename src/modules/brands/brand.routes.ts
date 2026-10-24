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

const router = Router();

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
  authorize(UserRole.ADMIN),
  validate(
    createBrandSchema,
    'body',
  ),
  brandController.create,
);

router.patch(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
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
  authorize(UserRole.ADMIN),
  validate(
    brandIdSchema,
    'params',
  ),
  brandController.updateStatus,
);

router.post(
  '/:id/image',
  authenticate,
  authorize(UserRole.ADMIN),
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
  authorize(UserRole.ADMIN),
  validate(
    brandIdSchema,
    'params',
  ),
  brandController.deleteImage,
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  validate(
    brandIdSchema,
    'params',
  ),
  brandController.delete,
);

export default router;