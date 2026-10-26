import { AppError } from '../../common/errors/app-error.js';

import {
  notificationRepository,
} from './notification.repository.instance.js';

import {
  mapNotification,
} from './notification.mapper.js';

import type {
  CreateNotificationInput,
  NotificationListQuery,
  NotificationListResponse,
  NotificationResponse,
} from './notification.types.js';

export class NotificationService {
  async createNotification(
    input: CreateNotificationInput,
  ): Promise<NotificationResponse> {
    const notification =
      await notificationRepository.create(input);

    return mapNotification(notification);
  }

  async getUserNotifications(
    userId: string,
    query: NotificationListQuery,
  ): Promise<NotificationListResponse> {
    const skip =
      (query.page - 1) * query.limit;

    const result =
      await notificationRepository.findUserNotifications(
        userId,
        skip,
        query.limit,
      );

    return {
      items: result.items.map(mapNotification),

      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(
          result.total / query.limit,
        ),
      },

      unreadCount: result.unreadCount,
    };
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationResponse> {
    const notification =
      await notificationRepository.findById(
        notificationId,
      );

    if (!notification) {
      throw new AppError(
        'Notification not found',
        404,
        'NOTIFICATION_NOT_FOUND',
      );
    }

    if (notification.userId !== userId) {
      throw new AppError(
        'You do not have access to this notification',
        403,
        'NOTIFICATION_ACCESS_DENIED',
      );
    }

    const updated =
      await notificationRepository.markAsRead(
        notificationId,
      );

    return mapNotification(updated);
  }

  async markAllAsRead(
    userId: string,
  ): Promise<void> {
    await notificationRepository.markAllAsRead(
      userId,
    );
  }

  async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const notification =
      await notificationRepository.findById(
        notificationId,
      );

    if (!notification) {
      throw new AppError(
        'Notification not found',
        404,
        'NOTIFICATION_NOT_FOUND',
      );
    }

    if (notification.userId !== userId) {
      throw new AppError(
        'You do not have access to this notification',
        403,
        'NOTIFICATION_ACCESS_DENIED',
      );
    }

    await notificationRepository.delete(
      notificationId,
    );
  }
}

export const notificationService =
  new NotificationService();