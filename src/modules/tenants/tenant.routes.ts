import { Router } from 'express';

import { tenantController } from './tenant.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

import { authorize } from '../../middleware/authorization.middleware.js';


export const tenantRoutes = Router();

tenantRoutes.post(
  '/',
  tenantController.create,
);

tenantRoutes.get(
  '/:id',
  authenticate,
  tenantController.getById,
);

tenantRoutes.patch(
  '/:id',
  tenantController.update,
);

tenantRoutes.post(
  '/:id/members',
  tenantController.addMember,
);

tenantRoutes.get(
  '/:id/members',
  tenantController.listMembers,
);

tenantRoutes.patch(
  '/:id/members/:userId',
  tenantController.updateMember,
);

tenantRoutes.get(
  '/me',
  authenticate,
  tenantController.getMyTenants,
);