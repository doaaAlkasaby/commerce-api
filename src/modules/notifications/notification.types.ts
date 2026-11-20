import type {
  NotificationScope,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client.js';

export interface CreateNotificationInput {
  scope?: NotificationScope;
  tenantId?: string | null;
  userId: string;
  eventKey?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}

export interface NotificationResponse {
  id: string;
  scope: NotificationScope;
  tenantId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationListQuery {
  page: number;
  limit: number;
}

export interface NotificationListResponse {
  items: NotificationResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  unreadCount: number;
}
