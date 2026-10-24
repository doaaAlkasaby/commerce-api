import { Router } from 'express';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  userController,
} from './user.controller.js';

import {
  UserRole,
} from '../../generated/prisma/client.js';

import {
  authorize,
} from '../../middleware/authorization.middleware.js';

import {
  updateUserStatusSchema,
  updateProfileSchema,
} from './user.schemas.js';


const router = Router();

/**
 * GET /api/v1/users/me
 *
 * Returns the currently authenticated user's profile.
 *
 * Authentication required.
 */
router.get(
  '/me',
  authenticate,
  userController.profile,
);

/**
 * PATCH /api/v1/users/me
 *
 * Updates the currently authenticated user's profile.
 *
 * Allowed fields:
 * - firstName
 * - lastName
 *
 * Authentication required.
 */
router.patch(
  '/me',
  authenticate,
  validate(
    updateProfileSchema,
    'body',
  ),
  userController.updateProfile,
);

router.patch(
  '/:id/status',
  authenticate,
  authorize(UserRole.ADMIN),
  validate(
    updateUserStatusSchema,
    'body',
  ),
  userController.updateStatus,
);






export default router;