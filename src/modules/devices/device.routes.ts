import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';

import { validate } from '../../common/validation/validate.js';

import {
  registerDeviceSchema,
  deviceIdParamSchema,
} from './device.schemas.js';

import {
  registerDevice,
  getDevices,
  deactivateDevice,
  deleteDevice,
} from './device.controller.js';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  validate(registerDeviceSchema, 'body'),
  registerDevice,
);

router.get(
  '/',
  getDevices,
);

router.patch(
  '/:deviceId/deactivate',
  validate(deviceIdParamSchema, 'params'),
  deactivateDevice,
);

router.delete(
  '/:deviceId',
  validate(deviceIdParamSchema, 'params'),
  deleteDevice,
);

export default router;