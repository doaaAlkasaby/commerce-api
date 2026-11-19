import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { CreateNotificationInput } from './notification.types.js';

export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateNotificationInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const createData = {
      tenantId: input.tenantId,
      userId: input.userId,
      ...(input.eventKey ? { eventKey: input.eventKey } : {}),
      type: input.type,
      title: input.title,
      body: input.body,
      ...(input.data !== undefined ? { data: input.data } : {}),
    };

    return client.notification.create({
      data: createData,
    });
  }

  async createIdempotent(
    input: CreateNotificationInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    if (!input.eventKey) {
      return this.create(input, client);
    }

    const id = crypto.randomUUID();
    const dataJson =
      input.data !== undefined ? JSON.stringify(input.data) : null;

    const result = await client.$executeRaw`
      INSERT INTO "Notification" ("id", "tenantId", "userId", "eventKey", "type", "title", "body", "data", "isRead", "createdAt", "updatedAt")
      VALUES (
        ${id},
        ${input.tenantId},
        ${input.userId},
        ${input.eventKey},
        ${input.type}::"NotificationType",
        ${input.title},
        ${input.body},
        ${dataJson}::jsonb,
        false,
        NOW(),
        NOW()
      )
      ON CONFLICT ("eventKey") DO NOTHING
    `;

    if (result === 0) {
      return null;
    }

    return this.findById(input.tenantId, input.userId, id, client);
  }

  async findById(
    tenantId: string,
    userId: string,
    notificationId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.notification.findFirst({
      where: {
        id: notificationId,
        tenantId,
        userId,
      },
    });
  }

  async findUserNotifications(
    tenantId: string,
    userId: string,
    skip: number,
    take: number,
  ) {
    const where = {
      tenantId,
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
          tenantId,
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

  async markAsRead(tenantId: string, userId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        tenantId,
        userId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    if (result.count === 0) return null;

    return this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        tenantId,
        userId,
      },
    });
  }

  async markAllAsRead(tenantId: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        tenantId,
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async delete(
    tenantId: string,
    userId: string,
    notificationId: string,
  ): Promise<boolean> {
    const result = await this.prisma.notification.deleteMany({
      where: {
        id: notificationId,
        tenantId,
        userId,
      },
    });

    return result.count > 0;
  }
}
