import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../common/validation/validate.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';
import { productIdParamSchema } from './product.schemas.js';
import {
  merchantProductQuery,
  type MerchantProductQuery,
} from './merchant-product.schemas.js';
import {
  getMerchantProductDetail,
  getMerchantProductList,
} from './merchant-product.service.js';

export const merchantProductRoutes = Router();
merchantProductRoutes.use(
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
);
merchantProductRoutes.get(
  '/',
  validate(merchantProductQuery, 'query'),
  async (req, res) => {
    const data = await getMerchantProductList(
      req.tenant!.tenantId,
      req.validatedQuery as MerchantProductQuery,
    );
    res.json({ success: true, data });
  },
);
merchantProductRoutes.get(
  '/:id',
  validate(productIdParamSchema, 'params'),
  validate(z.strictObject({}), 'query'),
  async (req, res) => {
    const { id } = req.validatedParams as { id: string };
    const data = await getMerchantProductDetail(req.tenant!.tenantId, id);
    res.json({ success: true, data });
  },
);
