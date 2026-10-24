import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../common/validation/validate.js';

import {
  createAddressSchema,
  updateAddressSchema,
  addressIdParamsSchema,
} from './address.schemas.js';

import { addressController } from './address.controller.js';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  validate(createAddressSchema, 'body'),
  addressController.create.bind(addressController),
);

router.get(
  '/',
  addressController.getAll.bind(addressController),
);

router.get(
  '/:id',
  validate(addressIdParamsSchema, 'params'),
  addressController.getById.bind(addressController),
);

router.patch(
  '/:id',
  validate(addressIdParamsSchema, 'params'),
  validate(updateAddressSchema, 'body'),
  addressController.update.bind(addressController),
);

router.delete(
  '/:id',
  validate(addressIdParamsSchema, 'params'),
  addressController.delete.bind(addressController),
);

router.post(
  '/:id/default-shipping',
  validate(addressIdParamsSchema, 'params'),
  addressController.setDefaultShipping.bind(
    addressController,
  ),
);

router.post(
  '/:id/default-billing',
  validate(addressIdParamsSchema, 'params'),
  addressController.setDefaultBilling.bind(
    addressController,
  ),
);

export default router;