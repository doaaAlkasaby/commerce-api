import { Router } from 'express';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

import {
  authorize,
} from '../../middleware/authorization.middleware.js';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  productVariantController,
} from './product-variant.controller.js';

import {
  createProductVariantSchema,
  updateProductVariantSchema,
  productVariantIdParamsSchema,
} from './product-variant.schemas.js';

const router = Router();

router.use(tenantMiddleware);
router.use(authenticate);

router.use(
  authorize(
    'ADMIN',
    'MANAGER',
  ),
);

router.post(
  '/',
  validate(
    createProductVariantSchema,
    'body',
  ),
  productVariantController.create,
);

router.get(
  '/:id',
  validate(
    productVariantIdParamsSchema,
    'params',
  ),
  productVariantController.getById,
);

router.patch(
  '/:id',
  validate(
    productVariantIdParamsSchema,
    'params',
  ),
  validate(
    updateProductVariantSchema,
    'body',
  ),
  productVariantController.update,
);

router.delete(
  '/:id',
  validate(
    productVariantIdParamsSchema,
    'params',
  ),
  productVariantController.delete,
);

export default router;
