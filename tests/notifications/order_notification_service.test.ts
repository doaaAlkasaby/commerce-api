import { describe, expect, it } from 'vitest';
import { OrderNotificationService } from '../../src/modules/notifications/order-notification.service.js';
import type { NotificationRepository } from '../../src/modules/notifications/notification.repository.js';

describe('Phase NOTIF-6: Order Lifecycle Notification Service Tests', () => {
  const tenantId = 'tenant-luma';
  const userId = 'user-customer-1';
  const inMemoryStore: any[] = [];

  const mockRepo = {
    createIdempotent: async (input: any) => {
      if (
        input.eventKey &&
        inMemoryStore.some((n) => n.eventKey === input.eventKey)
      ) {
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
  ]);

  const mockTx = {
    notificationPushJob: { create: async () => undefined },
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

  it('1. Successfully creates ORDER_PLACED notification', async () => {
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

  it('2. Successfully creates ORDER_CONFIRMED notification', async () => {
    const result = await orderService.createOrderNotification({
      eventType: 'ORDER_CONFIRMED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.title).toContain('Order Confirmed: #ORD-1001');
  });

  it('3. Successfully creates ORDER_PROCESSING notification', async () => {
    const result = await orderService.createOrderNotification({
      eventType: 'ORDER_PROCESSING',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.title).toContain('Order Processing: #ORD-1001');
  });

  it('4. Successfully creates ORDER_SHIPPED notification with SHIPPING type', async () => {
    const result = await orderService.createOrderNotification({
      eventType: 'ORDER_SHIPPED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.type).toBe('SHIPPING');
    expect(result.notification!.title).toContain('Order Shipped: #ORD-1001');
  });

  it('5. Successfully creates ORDER_DELIVERED notification with SHIPPING type', async () => {
    const result = await orderService.createOrderNotification({
      eventType: 'ORDER_DELIVERED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.type).toBe('SHIPPING');
    expect(result.notification!.title).toContain('Order Delivered: #ORD-1001');
  });

  it('6. Successfully creates ORDER_COMPLETED notification', async () => {
    const result = await orderService.createOrderNotification({
      eventType: 'ORDER_COMPLETED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.title).toContain('Order Completed: #ORD-1001');
  });

  it('7. Successfully creates ORDER_CANCELLED notification', async () => {
    const result = await orderService.createOrderNotification({
      eventType: 'ORDER_CANCELLED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.title).toContain('Order Cancelled: #ORD-1001');
  });

  it('8. Repeated event insertion attempts for same status produce ALREADY_EXISTS without throwing', async () => {
    const duplicateResult = await orderService.createOrderNotification({
      eventType: 'ORDER_SHIPPED',
      orderId: 'ord-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(duplicateResult.status).toBe('ALREADY_EXISTS');
    expect(duplicateResult.notification).toBeNull();
  });

  it('9. Rejects notification if transaction client tx is missing', async () => {
    await expect(
      orderService.createOrderNotification({
        eventType: 'ORDER_SHIPPED',
        orderId: 'ord-1001',
        expectedTenantId: tenantId,
      } as any),
    ).rejects.toThrow('Transaction client is required');
  });

  it('10. Rejects notification if order does not exist or tenant context mismatches', async () => {
    await expect(
      orderService.createOrderNotification({
        eventType: 'ORDER_SHIPPED',
        orderId: 'non-existent-order',
        expectedTenantId: tenantId,
        tx: mockTx,
      }),
    ).rejects.toThrow('Order not found or tenant context mismatch');

    await expect(
      orderService.createOrderNotification({
        eventType: 'ORDER_SHIPPED',
        orderId: 'ord-1001',
        expectedTenantId: 'mismatched-tenant-id',
        tx: mockTx,
      }),
    ).rejects.toThrow('Order not found or tenant context mismatch');
  });
});
