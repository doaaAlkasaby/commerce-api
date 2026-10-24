import { Router } from 'express';

import {
  UserRole,
} from '../../generated/prisma/client.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  authorize,
} from '../../middleware/authorization.middleware.js';

import {
  adminTestController,
} from './admin-test.controller.js';

const router = Router();

router.get(
  '/admin-test',
  authenticate,
  authorize(UserRole.ADMIN),
  adminTestController,
);

export default router;