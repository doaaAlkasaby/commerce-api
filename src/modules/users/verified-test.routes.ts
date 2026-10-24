import { Router } from 'express';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  requireVerifiedEmail,
} from '../../middleware/verified-email.middleware.js';

import {
  verifiedTestController,
} from './verified-test.controller.js';

const router = Router();

router.get(
  '/verified-test',
  authenticate,
  requireVerifiedEmail,
  verifiedTestController,
);

export default router;