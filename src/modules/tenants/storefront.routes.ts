import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { publicStorefront } from './storefront.service.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authRateLimiter } from '../../config/rate-limit.js';
import { customerEnrollment } from './customer-enrollment.controller.js';

export const storefrontRoutes = Router();
storefrontRoutes.post(
  '/enroll',
  tenantMiddleware,
  authenticate,
  authRateLimiter,
  customerEnrollment,
);
storefrontRoutes.get('/', tenantMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      message: null,
      data: await publicStorefront(req.tenant!.tenantSlug),
    });
  } catch (error) {
    next(error);
  }
});
