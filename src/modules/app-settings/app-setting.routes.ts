import { Router } from 'express';

import { validate } from '../../common/validation/validate.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';

import { appSettingController } from './app-setting.controller.js';
import {
  appSettingKeyParamSchema,
  createAppSettingSchema,
  updateAppSettingSchema,
} from './app-setting.schemas.js';

export const appSettingRouter = Router();
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
appSettingRouter.use(tenantMiddleware);

appSettingRouter.get('/', (req, res, next) =>
  appSettingController.getPublicSettings(req, res, next),
);

appSettingRouter.get(
  '/admin/all',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  (req, res, next) => appSettingController.getAllSettings(req, res, next),
);

appSettingRouter.get(
  '/:key',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(appSettingKeyParamSchema, 'params'),
  (req, res, next) => appSettingController.getSetting(req, res, next),
);

appSettingRouter.post(
  '/',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(createAppSettingSchema, 'body'),
  (req, res, next) => appSettingController.createSetting(req, res, next),
);

appSettingRouter.patch(
  '/:key',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(appSettingKeyParamSchema, 'params'),
  validate(updateAppSettingSchema, 'body'),
  (req, res, next) => appSettingController.updateSetting(req, res, next),
);

appSettingRouter.delete(
  '/:key',
  authenticate,
  tenantMemberMiddleware,
  requireTenantRoles('OWNER', 'ADMIN'),
  validate(appSettingKeyParamSchema, 'params'),
  (req, res, next) => appSettingController.deleteSetting(req, res, next),
);
