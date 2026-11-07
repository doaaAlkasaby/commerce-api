import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { publicStorefront } from './storefront.service.js';

export const storefrontRoutes = Router();
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
