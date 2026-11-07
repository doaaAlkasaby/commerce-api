import { sensitiveRateLimiter } from '../../config/rate-limit.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { Router } from 'express';

import { validate } from '../../common/validation/validate.js';

import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';

import { requireVerifiedEmail } from '../../middleware/verified-email.middleware.js';

import { checkoutSchema, checkoutPreviewSchema } from './checkout.schemas.js';

import { checkoutController } from './checkout.controller.js';

const router = Router();

router.use(tenantMiddleware);
router.post(
  '/shipping-options',
  authenticate,
  tenantMemberMiddleware,
  sensitiveRateLimiter,
  requireVerifiedEmail,
  validate(checkoutPreviewSchema, 'body'),
  checkoutController.shippingOptions,
);

router.post(
  '/preview',
  authenticate,
  tenantMemberMiddleware,
  sensitiveRateLimiter,
  requireVerifiedEmail,
  validate(checkoutPreviewSchema, 'body'),
  checkoutController.preview,
);

router.post(
  '/',
  authenticate,
  tenantMemberMiddleware,
  sensitiveRateLimiter,
  requireVerifiedEmail,
  validate(checkoutSchema, 'body'),
  checkoutController.checkout,
);

export default router;
