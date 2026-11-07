import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';
import { warehouseController } from './warehouse.controller.js';

export const warehouseRoutes = Router();
warehouseRoutes.use(
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
);
warehouseRoutes.get('/', warehouseController.list);
warehouseRoutes.get('/:id', warehouseController.get);
warehouseRoutes.post('/', warehouseController.create);
warehouseRoutes.patch('/:id', warehouseController.update);
warehouseRoutes.put('/:id/coverage', warehouseController.coverage);
