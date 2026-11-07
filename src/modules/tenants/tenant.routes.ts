import { Router } from 'express';
import { tenantController } from './tenant.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorization.middleware.js';
import { tenantManagement } from '../../middleware/tenant-management.middleware.js';

export const tenantRoutes = Router();
tenantRoutes.use(authenticate);
tenantRoutes.get('/me', tenantController.getMyTenants);
tenantRoutes.post('/', authorize('ADMIN'), tenantController.create);
tenantRoutes.get('/:id', tenantManagement(), tenantController.getById);
tenantRoutes.patch('/:id', tenantManagement(true), tenantController.update);
tenantRoutes.post(
  '/:id/members',
  tenantManagement(true),
  tenantController.addMember,
);
tenantRoutes.get(
  '/:id/members',
  tenantManagement(true),
  tenantController.listMembers,
);
tenantRoutes.patch(
  '/:id/members/:userId',
  tenantManagement(true),
  tenantController.updateMember,
);
