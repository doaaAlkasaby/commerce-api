import { describe, expect, it } from 'vitest';
import { PaymentNotificationService } from '../../src/modules/notifications/payment-notification.service.js';
import type { NotificationRepository } from '../../src/modules/notifications/notification.repository.js';

describe('Phase NOTIF-7C: Payment Notification Service Unit Tests', () => {
  const tenantId = 'tenant-luma';
  const userId = 'user-customer-99';
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

  const mockPayments = new Map<string, any>([
    [
      'pay-1001',
      {
        id: 'pay-1001',
        amount: { toString: () => '100' },
        currency: 'USD',
        status: 'PAID',
        orderId: 'ord-1001',
        order: {
          id: 'ord-1001',
          orderNumber: 'ORD-1001',
          tenantId,
          userId,
          tenant: { slug: 'luma-store' },
        },
      },
    ],
  ]);

  const mockTx = {
    notificationPushJob: { create: async () => undefined },
    payment: {
      findFirst: async ({ where }: any) => {
        const payment = mockPayments.get(where.id);
        if (
          payment &&
          payment.order &&
          payment.order.tenantId === where.order.tenantId
        ) {
          return payment;
        }
        return null;
      },
    },
  } as any;

  const paymentNotifService = new PaymentNotificationService(mockRepo);

  it('1. Successfully creates PAYMENT_PAID notification with correct payload', async () => {
    const result = await paymentNotifService.createPaymentNotification({
      eventType: 'PAYMENT_PAID',
      paymentId: 'pay-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification).not.toBeNull();
    expect(result.notification!.type).toBe('PAYMENT');
    expect(result.notification!.title).toContain('Payment Received: #ORD-1001');
    expect(result.notification!.data).toEqual({
      paymentId: 'pay-1001',
      orderId: 'ord-1001',
      orderNumber: 'ORD-1001',
      amount: '100',
      currency: 'USD',
      eventType: 'PAYMENT_PAID',
      tenantSlug: 'luma-store',
    });
  });

  it('2. Original payment 100, partial refund 20: notification must show 20 (not 100)', async () => {
    const result = await paymentNotifService.createPaymentNotification({
      eventType: 'PAYMENT_PARTIALLY_REFUNDED',
      paymentId: 'pay-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
      refundAmount: '20',
      providerTransactionId: 'txn-ref-20',
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.title).toContain('Partial Refund Processed: #ORD-1001');
    expect(result.notification!.body).toContain('20');
    expect(result.notification!.data).toEqual(
      expect.objectContaining({
        amount: '20',
        eventType: 'PAYMENT_PARTIALLY_REFUNDED',
      }),
    );
  });

  it('3. Partial refund without explicit refundAmount throws validation error', async () => {
    await expect(
      paymentNotifService.createPaymentNotification({
        eventType: 'PAYMENT_PARTIALLY_REFUNDED',
        paymentId: 'pay-1001',
        expectedTenantId: tenantId,
        tx: mockTx,
      }),
    ).rejects.toThrow('Refund amount is required for partial refund notifications');
  });

  it('4. Repeated payment webhook attempt returns ALREADY_EXISTS', async () => {
    const result = await paymentNotifService.createPaymentNotification({
      eventType: 'PAYMENT_PAID',
      paymentId: 'pay-1001',
      expectedTenantId: tenantId,
      tx: mockTx,
    });

    expect(result.status).toBe('ALREADY_EXISTS');
    expect(result.notification).toBeNull();
  });
});
