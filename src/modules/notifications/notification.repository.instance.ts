import { prisma } from '../../config/database.js';

import {
  NotificationRepository,
} from './notification.repository.js';

export const notificationRepository =
  new NotificationRepository(prisma);