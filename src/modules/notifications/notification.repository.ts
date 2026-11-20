import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { CreateNotificationInput } from './notification.types.js';

export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateNotificationInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const scope = input.scope ?? 'TENANT';
    const createData = {
      scope,
      tenantId: scope === 'ACCOUNT' ? null : (input.tenantId ?? null),
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
    const scope = input.scope ?? 'TENANT';
    const tenantId = scope === 'ACCOUNT' ? null : (input.tenantId ?? null);
    const dataJson =
      input.data !== undefined ? JSON.stringify(input.data) : null;

    const result = await client.$executeRaw`
      INSERT INTO "Notification" ("id", "scope", "tenantId", "userId", "eventKey", "type", "title", "body", "data", "isRead", "createdAt", "updatedAt")
      VALUES (
        ${id},
        ${scope}::"NotificationScope",
        ${tenantId},
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

    return this.findById(tenantId, input.userId, id, client);
  }

  async findById(
    tenantId: string | null,
    userId: string,
    notificationId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const where: Prisma.NotificationWhereInput = {
      id: notificationId,
      userId,
    };

    if (tenantId) {
      where.OR = [{ tenantId }, { scope: 'ACCOUNT' }];
    }

    return client.notification.findFirst({ where });
  }

  async findUserNotifications(
    tenantId: string,
    userId: string,
    skip: number,
    take: number,
  ) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      OR: [{ tenantId }, { scope: 'ACCOUNT' }],
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
          OR: [{ tenantId }, { scope: 'ACCOUNT' }],
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
        userId,
        OR: [{ tenantId }, { scope: 'ACCOUNT' }],
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    if (result.count === 0) return null;

    return this.findById(tenantId, userId, notificationId);
  }

  async markAllAsRead(tenantId: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
        OR: [{ tenantId }, { scope: 'ACCOUNT' }],
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
        userId,
        OR: [{ tenantId }, { scope: 'ACCOUNT' }],
      },
    });

    return result.count > 0;
  }
}
