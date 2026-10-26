import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../common/validation/validate.js';


import {
  notificationIdParamSchema,
  notificationListQuerySchema,
} from './notification.schemas.js';

import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
} from './notification.controller.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  validate(
    notificationListQuerySchema,
    'query',
  ),
  getNotifications,
);

router.patch(
  '/read-all',
  markAllNotificationsAsRead,
);

router.patch(
  '/:notificationId/read',
  validate(
    notificationIdParamSchema,
    'params',
  ),
  markNotificationAsRead,
);

router.delete(
  '/:notificationId',
  validate(
    notificationIdParamSchema,
    'params',
  ),
  deleteNotification,
);

export default router;