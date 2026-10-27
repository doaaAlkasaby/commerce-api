import { Router } from 'express';

import { UserRole } from '../../generated/prisma/client.js';

import { authenticate } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorization.middleware.js';
import { validate } from '../../common/validation/validate.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

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
  validate(
    productImageIdSchema,
    'params',
  ),
  productImageController.getById,
);

router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN),
  validate(
    createProductImageSchema,
    'body',
  ),
  productImageController.create,
);

router.patch(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
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
  authorize(UserRole.ADMIN),
  validate(
    productImageIdSchema,
    'params',
  ),
  productImageController.setPrimary,
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  validate(
    productImageIdSchema,
    'params',
  ),
  productImageController.delete,
);

router.post(
  '/upload',
  authenticate,
  authorize(UserRole.ADMIN),
  productImageUpload.single('image'),
  productImageController.upload,
);


export default router;
