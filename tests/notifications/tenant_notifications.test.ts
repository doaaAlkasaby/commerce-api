import { describe, expect, it } from 'vitest';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import type { NotificationRepository } from '../../src/modules/notifications/notification.repository.js';
import { AppError } from '../../src/common/errors/app-error.js';

describe('Phase 1: Tenant-Safe Notifications Unit & Isolation Tests', () => {
  const tenantA = 'tenant-luma';
  const tenantB = 'tenant-sera';
  const userA = 'user-1';
  const userB = 'user-2';

  const inMemoryStore: any[] = [];

  const mockRepo = {
    create: async (input: any) => {
      if (input.eventKey && inMemoryStore.some((n) => n.eventKey === input.eventKey)) {
        throw new Error('Unique constraint failed on eventKey');
      }
      const notif = {
        id: `notif-${inMemoryStore.length + 1}`,
        tenantId: input.tenantId,
        userId: input.userId,
        eventKey: input.eventKey ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? null,
        isRead: false,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      inMemoryStore.push(notif);
      return notif;
    },

    findUserNotifications: async (tenantId: string, userId: string, skip: number, take: number) => {
      const items = inMemoryStore.filter(
        (n) => n.tenantId === tenantId && n.userId === userId,
      );
      const unreadCount = items.filter((n) => !n.isRead).length;
      return {
        items: items.slice(skip, skip + take),
        total: items.length,
        unreadCount,
      };
    },

    markAsRead: async (tenantId: string, userId: string, notificationId: string) => {
      const notif = inMemoryStore.find(
        (n) => n.id === notificationId && n.tenantId === tenantId && n.userId === userId,
      );
      if (!notif) return null;
      notif.isRead = true;
      notif.readAt = new Date();
      return notif;
    },

    markAllAsRead: async (tenantId: string, userId: string) => {
      inMemoryStore.forEach((n) => {
        if (n.tenantId === tenantId && n.userId === userId && !n.isRead) {
          n.isRead = true;
          n.readAt = new Date();
        }
      });
    },

    delete: async (tenantId: string, userId: string, notificationId: string) => {
      const idx = inMemoryStore.findIndex(
        (n) => n.id === notificationId && n.tenantId === tenantId && n.userId === userId,
      );
      if (idx === -1) return false;
      inMemoryStore.splice(idx, 1);
      return true;
    },
  } as unknown as NotificationRepository;

  const service = new NotificationService(mockRepo as any);

  it('1. Tenant A notifications are invisible in Tenant B for the same user', async () => {
    const createdNotif = await service.createNotification({
      tenantId: tenantA,
      userId: userA,
      eventKey: `test_notif_tenantA_${Date.now()}`,
      type: 'SYSTEM',
      title: 'Tenant A Title',
      body: 'Tenant A Message',
    });

    const listTenantA = await service.getUserNotifications(
      tenantA,
      userA,
      { page: 1, limit: 20 },
    );
    expect(listTenantA.items.some((n) => n.id === createdNotif.id)).toBe(true);

    const listTenantB = await service.getUserNotifications(
      tenantB,
      userA,
      { page: 1, limit: 20 },
    );
    expect(listTenantB.items.some((n) => n.id === createdNotif.id)).toBe(false);

    await service.deleteNotification(tenantA, userA, createdNotif.id);
  });

  it('2. Rejects cross-tenant mark-as-read and delete operations', async () => {
    const createdNotif = await service.createNotification({
      tenantId: tenantA,
      userId: userA,
      eventKey: `test_notif_cross_tenant_${Date.now()}`,
      type: 'SYSTEM',
      title: 'Cross Tenant Test',
      body: 'Testing cross tenant protection',
    });

    await expect(
      service.markAsRead(tenantB, userA, createdNotif.id),
    ).rejects.toThrow('Notification not found');

    await expect(
      service.deleteNotification(tenantB, userA, createdNotif.id),
    ).rejects.toThrow('Notification not found');

    await service.deleteNotification(tenantA, userA, createdNotif.id);
  });

  it('3. User A notifications are isolated from User B in the same tenant', async () => {
    const createdNotifA = await service.createNotification({
      tenantId: tenantA,
      userId: userA,
      eventKey: `test_notif_userA_${Date.now()}`,
      type: 'SYSTEM',
      title: 'User A Title',
      body: 'User A Message',
    });

    const listUserB = await service.getUserNotifications(
      tenantA,
      userB,
      { page: 1, limit: 20 },
    );
    expect(listUserB.items.some((n) => n.id === createdNotifA.id)).toBe(false);

    await expect(
      service.markAsRead(tenantA, userB, createdNotifA.id),
    ).rejects.toThrow('Notification not found');

    await service.deleteNotification(tenantA, userA, createdNotifA.id);
  });

  it('4. Mark-all-read affects only the current user and active tenant', async () => {
    const event1 = `test_markall_tA_${Date.now()}`;
    const event2 = `test_markall_tB_${Date.now()}`;

    const n1 = await service.createNotification({
      tenantId: tenantA,
      userId: userA,
      eventKey: event1,
      type: 'SYSTEM',
      title: 'Notif 1',
      body: 'Msg 1',
    });

    const n2 = await service.createNotification({
      tenantId: tenantB,
      userId: userA,
      eventKey: event2,
      type: 'SYSTEM',
      title: 'Notif 2',
      body: 'Msg 2',
    });

    await service.markAllAsRead(tenantA, userA);

    const listA = await service.getUserNotifications(
      tenantA,
      userA,
      { page: 1, limit: 20 },
    );
    const item1 = listA.items.find((i) => i.id === n1.id);
    expect(item1?.isRead).toBe(true);

    const listB = await service.getUserNotifications(
      tenantB,
      userA,
      { page: 1, limit: 20 },
    );
    const item2 = listB.items.find((i) => i.id === n2.id);
    expect(item2?.isRead).toBe(false);

    await service.deleteNotification(tenantA, userA, n1.id);
    await service.deleteNotification(tenantB, userA, n2.id);
  });

  it('5. EventKey database unique constraint prevents duplicate insertion', async () => {
    const eventKey = `test_duplicate_event_${Date.now()}`;

    const n = await service.createNotification({
      tenantId: tenantA,
      userId: userA,
      eventKey,
      type: 'ORDER',
      title: 'Order Placed',
      body: 'Order #123 placed',
    });

    await expect(
      service.createNotification({
        tenantId: tenantA,
        userId: userA,
        eventKey,
        type: 'ORDER',
        title: 'Order Placed Duplicate',
        body: 'Order #123 placed duplicate',
      }),
    ).rejects.toThrow();

    await service.deleteNotification(tenantA, userA, n.id);
  });
});
