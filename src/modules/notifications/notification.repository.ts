import type { PrismaClient } from '../../generated/prisma/client.js';
import type { CreateNotificationInput } from './notification.types.js';

export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateNotificationInput) {
    const createData = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      ...(input.data !== undefined ? { data: input.data } : {}),
    };

    return this.prisma.notification.create({
      data: createData,
    });
  }

  async findById(notificationId: string) {
    return this.prisma.notification.findUnique({
      where: {
        id: notificationId,
      },
    });
  }

  async findUserNotifications(userId: string, skip: number, take: number) {
    const where = {
      userId,
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        skip,
        take,
      }),

      this.prisma.notification.count({
        where,
      }),

      this.prisma.notification.count({
        where: {
          userId,
          isRead: false,
        },
      }),
    ]);

    return {
      items,
      total,
      unreadCount,
    };
  }

  async markAsRead(notificationId: string) {
    return this.prisma.notification.update({
      where: {
        id: notificationId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async delete(notificationId: string) {
    return this.prisma.notification.delete({
      where: {
        id: notificationId,
      },
    });
  }
}
