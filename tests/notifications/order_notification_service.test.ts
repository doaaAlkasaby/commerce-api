import { describe, expect, it } from 'vitest';
import { OrderNotificationService } from '../../src/modules/notifications/order-notification.service.js';
import type { NotificationRepository } from '../../src/modules/notifications/notification.repository.js';

describe('Phase 2.1: Transaction-Safe Order Notification Service Tests', () => {
  const tenantId = 'tenant-luma';
  const userId = 'user-customer-1';
  const inMemoryStore: any[] = [];

  const mockRepo = {
    createIdempotent: async (input: any) => {
      if (input.eventKey && inMemoryStore.some((n) => n.eventKey === input.eventKey)) {
        return null;
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
  } as unknown as NotificationRepository;

  const mockOrders = new Map<string, any>([
    [
      'ord-1001',
      {
        id: 'ord-1001',
        orderNumber: 'ORD-1001',
        tenantId,
        userId,
      },
    ],
    [
      'ord-cancelled',
      {
        id: 'ord-cancelled',
        orderNumber: 'ORD-CANCELLED',
        tenantId,
        userId,
      },
    ],
    [
      'ord-shipped',
      {
        id: 'ord-shipped',
        orderNumber: 'ORD-SHIPPED',
        tenantId,
        userId,
      },
    ],
    [
      'ord-delivered',
      {
        id: 'ord-delivered',
        orderNumber: 'ORD-DELIVERED',
        tenantId,
        userId,
      },
    ],
  ]);

  const mockTx = {
    order: {
      findFirst: async ({ where }: any) => {
        const order = mockOrders.get(where.id);
        if (order && order.tenantId === where.tenantId) {
          return order;
        }
        return null;
      },
    },
  } as any;

  const orderService = new OrderNotificationService(mockRepo);

  it('1. Successfully creates ORDER_PLACED notification with correct payload derived from DB', async () => {
    const result = await orderService.createOrderNotification({
      eventType: 'ORDER_PLACED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
      tenantSlug: 'dev81-kuwait-fashion',
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification).not.toBeNull();
    expect(result.notification!.type).toBe('ORDER');
    expect(result.notification!.title).toContain('Order Placed: #ORD-1001');
    expect(result.notification!.data).toEqual({
      orderId: 'ord-1001',
      orderNumber: 'ORD-1001',
      eventType: 'ORDER_PLACED',
      tenantSlug: 'dev81-kuwait-fashion',
    });
  });

  it('2. Repeated event insertion attempts produce ALREADY_EXISTS without throwing', async () => {
    const duplicateResult = await orderService.createOrderNotification({
      eventType: 'ORDER_PLACED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(duplicateResult.status).toBe('ALREADY_EXISTS');
    expect(duplicateResult.notification).toBeNull();
  });

  it('3. Rejects notification if transaction client tx is missing', async () => {
    await expect(
      orderService.createOrderNotification({
        eventType: 'ORDER_PLACED',
        orderId: 'ord-1001',
        expectedTenantId: tenantId,
      } as any),
    ).rejects.toThrow('Transaction client is required');
  });

  it('4. Rejects notification if order does not exist or tenant context mismatches', async () => {
    await expect(
      orderService.createOrderNotification({
        eventType: 'ORDER_PLACED',
        orderId: 'non-existent-order',
        expectedTenantId: tenantId,
        tx: mockTx,
      }),
    ).rejects.toThrow('Order not found or tenant context mismatch');

    await expect(
      orderService.createOrderNotification({
        eventType: 'ORDER_PLACED',
        orderId: 'ord-1001',
        expectedTenantId: 'mismatched-tenant-id',
        tx: mockTx,
      }),
    ).rejects.toThrow('Order not found or tenant context mismatch');
  });
});
