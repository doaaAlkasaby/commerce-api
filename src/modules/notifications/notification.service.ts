import { AppError } from '../../common/errors/app-error.js';
import { notificationRepository } from './notification.repository.instance.js';
import { mapNotification } from './notification.mapper.js';
import type {
  CreateNotificationInput,
  NotificationListQuery,
  NotificationListResponse,
  NotificationResponse,
} from './notification.types.js';

export class NotificationService {
  constructor(
    private readonly repository = notificationRepository,
  ) {}

  async createNotification(
    input: CreateNotificationInput,
  ): Promise<NotificationResponse> {
    const notification = await this.repository.create(input);
    return mapNotification(notification);
  }

  async getUserNotifications(
    tenantId: string,
    userId: string,
    query: NotificationListQuery,
  ): Promise<NotificationListResponse> {
    const skip = (query.page - 1) * query.limit;

    const result = await this.repository.findUserNotifications(
      tenantId,
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
        totalPages: Math.ceil(result.total / query.limit) || 1,
      },
      unreadCount: result.unreadCount,
    };
  }

  async markAsRead(
    tenantId: string,
    userId: string,
    notificationId: string,
  ): Promise<NotificationResponse> {
    const updated = await this.repository.markAsRead(
      tenantId,
      userId,
      notificationId,
    );

    if (!updated) {
      throw new AppError(
        'Notification not found',
        404,
        'NOTIFICATION_NOT_FOUND',
      );
    }

    return mapNotification(updated);
  }

  async markAllAsRead(tenantId: string, userId: string): Promise<void> {
    await this.repository.markAllAsRead(tenantId, userId);
  }

  async deleteNotification(
    tenantId: string,
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const deleted = await this.repository.delete(
      tenantId,
      userId,
      notificationId,
    );

    if (!deleted) {
      throw new AppError(
        'Notification not found',
        404,
        'NOTIFICATION_NOT_FOUND',
      );
    }
  }
}

export const notificationService = new NotificationService();
