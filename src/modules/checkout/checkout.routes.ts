import {
  Router,
} from 'express';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  requireVerifiedEmail,
} from '../../middleware/verified-email.middleware.js';

import {
  checkoutSchema,
} from './checkout.schemas.js';

import {
  checkoutController,
} from './checkout.controller.js';

const router =
  Router();

router.post(
  '/',
  authenticate,
  requireVerifiedEmail,
  validate(
    checkoutSchema,
    'body',
  ),
  checkoutController.checkout,
);

export default router;