import { Router } from 'express';

import { authorize } from '../../middleware/authorization.middleware.js';

import { authenticate } from '../../middleware/auth.middleware.js';

import { validate } from '../../common/validation/validate.js';

import { productImageUpload } from '../../middleware/upload.middleware.js';

import { productAttributeController } from './product-attribute.controller.js';

import {
  createProductAttributeSchema,
  updateProductAttributeSchema,
  createProductAttributeValueSchema,
  updateProductAttributeValueSchema,
  productAttributeIdParamsSchema,
  productAttributeValueIdParamsSchema,
  productIdParamsSchema,
  attributeIdParamsSchema,
} from './product-attribute.schemas.js';

const router = Router();

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));

// --------------------------------------------------
// ATTRIBUTES
// --------------------------------------------------

router.post(
  '/',
  validate(createProductAttributeSchema, 'body'),
  productAttributeController.createAttribute,
);

router.get(
  '/product/:productId',
  validate(productIdParamsSchema, 'params'),
  productAttributeController.getAttributesByProduct,
);

router.get(
  '/:id',
  validate(productAttributeIdParamsSchema, 'params'),
  productAttributeController.getAttributeById,
);

router.patch(
  '/:id',
  validate(productAttributeIdParamsSchema, 'params'),
  validate(updateProductAttributeSchema, 'body'),
  productAttributeController.updateAttribute,
);

router.delete(
  '/:id',
  validate(productAttributeIdParamsSchema, 'params'),
  productAttributeController.deleteAttribute,
);

// --------------------------------------------------
// ATTRIBUTE VALUES
// --------------------------------------------------

router.post(
  '/:attributeId/values',
  validate(attributeIdParamsSchema, 'params'),
  validate(
    createProductAttributeValueSchema.omit({
      attributeId: true,
    }),
    'body',
  ),
  productAttributeController.createValue,
);

router.get(
  '/values/:valueId',
  validate(productAttributeValueIdParamsSchema, 'params'),
  productAttributeController.getValueById,
);

router.patch(
  '/values/:valueId',
  validate(productAttributeValueIdParamsSchema, 'params'),
  validate(updateProductAttributeValueSchema, 'body'),
  productAttributeController.updateValue,
);

router.delete(
  '/values/:valueId',
  validate(productAttributeValueIdParamsSchema, 'params'),
  productAttributeController.deleteValue,
);

router.post(
  '/values/:valueId/image',
  validate(productAttributeValueIdParamsSchema, 'params'),
  productImageUpload.single('image'),
  productAttributeController.setValueImage,
);

router.delete(
  '/values/:valueId/image',
  validate(productAttributeValueIdParamsSchema, 'params'),
  productAttributeController.clearValueImage,
);

export default router;
