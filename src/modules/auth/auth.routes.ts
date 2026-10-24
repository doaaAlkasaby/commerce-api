import { Router } from 'express';

import {
  validate,
} from '../../common/validation/validate.js';

import {
  authController,
} from './auth.controller.js';

import {
  loginSchema,
  registerSchema,
  refreshSchema,
  logoutSchema,
  verifyEmailSchema,
  resendVerificationSchema
} from './auth.schemas.js';

import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas.js';

import {
  changePasswordSchema,
} from './auth.schemas.js';

import {
  authenticate,
} from '../../middleware/auth.middleware.js';

import {
  authRateLimiter,
} from '../../config/rate-limit.js';




const router = Router();

router.post(
  '/register',
   authRateLimiter,
  validate(
    registerSchema,
    'body',
  ),
  authController.register,
);

router.post(
  '/login',
   authRateLimiter,
  validate(
    loginSchema,
    'body',
  ),
  authController.login,
);


router.post(
  '/refresh',
  validate(
    refreshSchema,
    'body',
  ),
  authController.refresh,
);

router.post(
  '/logout',
  validate(
    logoutSchema,
    'body',
  ),
  authController.logout,
);

router.get(
  '/verify-email',
  validate(
    verifyEmailSchema,
    'query',
  ),
  authController.verifyEmail,
);

router.post(
  '/resend-verification',
   authRateLimiter,
  validate(
    resendVerificationSchema,
    'body',
  ),
  authController.resendVerification,
);


router.post(
  '/forgot-password',
   authRateLimiter,
  validate(
    forgotPasswordSchema,
    'body',
  ),
  authController.forgotPassword,
);

router.post(
  '/reset-password',
   authRateLimiter,
  validate(
    resetPasswordSchema,
    'body',
  ),
  authController.resetPassword,
);

router.post(
  '/change-password',
   authRateLimiter,
  authenticate,
  validate(
    changePasswordSchema,
    'body',
  ),
  authController.changePassword,
);

router.post(
  '/logout-all',
  authenticate,
  authController.logoutAll,
);

export default router;