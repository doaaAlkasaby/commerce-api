import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';
import {
  OrderPolicyService,
  orderPolicySchema,
} from './order-policy.service.js';

export const orderPolicyRoutes = Router();
const service = new OrderPolicyService();
orderPolicyRoutes.use(
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
);
orderPolicyRoutes.get('/', async (req, res, next) => {
  try {
    res.json({
      success: true,
      message: null,
      data: await service.get(req.tenant!.tenantId),
    });
  } catch (error) {
    next(error);
  }
});
orderPolicyRoutes.patch('/', async (req, res, next) => {
  try {
    res.json({
      success: true,
      message: null,
      data: await service.update(
        req.tenant!.tenantId,
        orderPolicySchema.parse(req.body),
      ),
    });
  } catch (error) {
    next(error);
  }
});
