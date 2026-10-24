import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';

import { authorize } from '../../middleware/authorization.middleware.js';

import { validate } from '../../common/validation/validate.js';

import { productImageUpload } from '../../middleware/upload.middleware.js';

import { productVariantImageController } from './product-variant-image.controller.js';

import {
  productVariantIdParamsSchema,
  productVariantImageIdParamsSchema,
  updateProductVariantImageSchema,
} from './product-variant-image.schemas.js';

const router = Router();

router.use(authenticate);

router.use(authorize('ADMIN', 'MANAGER'));

router.get(
  '/variant/:variantId',
  validate(productVariantIdParamsSchema, 'params'),
  productVariantImageController.getByVariantId,
);

router.get(
  '/:id',
  validate(productVariantImageIdParamsSchema, 'params'),
  productVariantImageController.getById,
);

router.post(
  '/upload',
  productImageUpload.single('image'),
  productVariantImageController.upload,
);

router.patch(
  '/:id',
  validate(productVariantImageIdParamsSchema, 'params'),
  validate(updateProductVariantImageSchema, 'body'),
  productVariantImageController.update,
);

router.patch(
  '/:id/primary',
  validate(productVariantImageIdParamsSchema, 'params'),
  productVariantImageController.setPrimary,
);

router.delete(
  '/:id',
  validate(productVariantImageIdParamsSchema, 'params'),
  productVariantImageController.delete,
);

export default router;
