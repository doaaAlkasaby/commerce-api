import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { Router } from 'express';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';

import { requireVerifiedEmail } from '../../middleware/verified-email.middleware.js';

import { checkoutSchema, checkoutPreviewSchema } from './checkout.schemas.js';

import { checkoutController } from './checkout.controller.js';

const router = Router();

router.use(tenantMiddleware);

router.post(
  '/preview',
  authenticate,
  requireVerifiedEmail,
  validate(checkoutPreviewSchema, 'body'),
  checkoutController.preview,
);

router.post(
  '/',
  authenticate,
  requireVerifiedEmail,
  validate(checkoutSchema, 'body'),
  checkoutController.checkout,
);

export default router;
