import type {
  Notification,
} from '../../generated/prisma/client.js';

import type {
  NotificationResponse,
} from './notification.types.js';

export const mapNotification = (
  notification: Notification,
): NotificationResponse => ({
  id: notification.id,
  type: notification.type,
  title: notification.title,
  body: notification.body,
  data: notification.data,
  isRead: notification.isRead,
  readAt: notification.readAt,
  createdAt: notification.createdAt,
  updatedAt: notification.updatedAt,
});