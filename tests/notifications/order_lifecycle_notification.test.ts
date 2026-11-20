import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import type {
  OrderStatus,
  PaymentStatus,
} from '../../src/generated/prisma/client.js';
import type { FirebaseAdminService } from '../../src/common/services/firebase-admin.service.js';
import type { NotificationPushRepository } from '../../src/modules/notifications/notification-push.repository.js';
import { NotificationPushWorker } from '../../src/modules/notifications/notification-push.worker.js';
import { OrderService } from '../../src/modules/orders/order.service.js';

describe('Order lifecycle notification outbox', () => {
  const orders = new OrderService();
  const tenantId = randomUUID();
  const foreignTenantId = randomUUID();
  const customerId = randomUUID();
  const tenantSlug = `notif-lifecycle-${tenantId}`;

  beforeAll(async () => {
    await testPrisma.tenant.createMany({
      data: [
        { id: tenantId, slug: tenantSlug, name: 'Lifecycle', code: tenantId },
        {
          id: foreignTenantId,
          slug: `notif-foreign-${foreignTenantId}`,
          name: 'Foreign',
          code: foreignTenantId,
        },
      ],
    });
    await testPrisma.user.create({
      data: {
        id: customerId,
        email: `${customerId}@example.test`,
        passwordHash: 'fixture',
        firstName: 'Test',
        lastName: 'Customer',
      },
    });
  });

  afterAll(async () => {
    await testPrisma.notification.deleteMany({ where: { tenantId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.user.deleteMany({ where: { id: customerId } });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, foreignTenantId] } },
    });
    await testPrisma.$disconnect();
  });

  function fixture(status: OrderStatus, paymentStatus: PaymentStatus) {
    return testPrisma.order.create({
      data: {
        tenantId,
        userId: customerId,
        orderNumber: `NOTIF-${randomUUID()}`,
        status,
        paymentStatus,
        currency: 'USD',
        subtotal: 10,
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        totalAmount: 10,
        shippingAddress: {},
        billingAddress: {},
        payments: {
          create: {
            provider: 'NONE',
            method: 'CARD',
            status: paymentStatus,
            amount: 10,
            currency: 'USD',
            initiationState: 'NOT_STARTED',
          },
        },
      },
    });
  }

  function notifications(orderId: string) {
    return testPrisma.notification.findMany({
      where: { data: { path: ['orderId'], equals: orderId } },
    });
  }

  it.each([
    ['PENDING', 'CONFIRMED', 'PENDING', 'ORDER_CONFIRMED', 'ORDER'],
    ['CONFIRMED', 'PROCESSING', 'PAID', 'ORDER_PROCESSING', 'ORDER'],
    ['PROCESSING', 'SHIPPED', 'PAID', 'ORDER_SHIPPED', 'SHIPPING'],
    ['SHIPPED', 'DELIVERED', 'PAID', 'ORDER_DELIVERED', 'SHIPPING'],
    ['DELIVERED', 'COMPLETED', 'PAID', 'ORDER_COMPLETED', 'ORDER'],
    ['PENDING', 'CANCELLED', 'PENDING', 'ORDER_CANCELLED', 'ORDER'],
    ['CONFIRMED', 'CANCELLED', 'PENDING', 'ORDER_CANCELLED', 'ORDER'],
  ] as const)(
    'enqueues one customer notification on %s → %s',
    async (from, to, paymentStatus, eventType, type) => {
      const order = await fixture(from, paymentStatus);
      await Promise.all([
        orders.updateStatus(tenantId, order.id, { status: to }),
        orders.updateStatus(tenantId, order.id, { status: to }),
      ]);
      const saved = await notifications(order.id);
      expect(saved).toHaveLength(1);
      const notification = saved[0]!;
      expect(notification).toMatchObject({
        tenantId,
        userId: customerId,
        type,
        eventKey: `${eventType.toLowerCase()}_${order.id}`,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          eventType,
          tenantSlug,
        },
      });
      const job = await testPrisma.notificationPushJob.findUniqueOrThrow({
        where: { notificationId: notification.id },
      });
      expect(job).toMatchObject({ tenantId, state: 'READY', attempts: 0 });

      if (eventType === 'ORDER_SHIPPED') {
        const push = vi.fn().mockResolvedValue({
          isDryRun: true,
          successCount: 1,
          failureCount: 0,
          successfulTokens: ['fixture-device'],
          invalidTokens: [],
        });
        const tokens = vi.fn().mockResolvedValue(['fixture-device']);
        const completeJob = vi.fn().mockResolvedValue(undefined);
        const worker = new NotificationPushWorker(
          {
            claimJobs: vi
              .fn()
              .mockResolvedValue([
                { ...job, claimToken: 'fixture-claim', notification },
              ]),
            findActiveUserTokens: tokens,
            recordDeliveredTokens: vi.fn().mockResolvedValue(undefined),
            completeJob,
          } as unknown as NotificationPushRepository,
          {
            sendMulticastNotification: push,
          } as unknown as FirebaseAdminService,
        );
        expect(await worker.processBatch()).toBe(1);
        expect(tokens).toHaveBeenCalledWith(customerId);
        expect(push).toHaveBeenCalledExactlyOnceWith({
          tokens: ['fixture-device'],
          title: notification.title,
          body: notification.body,
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            eventType,
            tenantSlug,
            notificationId: notification.id,
            title: notification.title,
            body: notification.body,
          },
        });
        expect(completeJob).toHaveBeenCalledWith(job.id, 'fixture-claim');
      }
    },
  );

  it('rejects foreign tenants, invalid jumps, and payment-gated transitions without enqueueing', async () => {
    const order = await fixture('CONFIRMED', 'PENDING');
    await expect(
      orders.updateStatus(foreignTenantId, order.id, { status: 'CANCELLED' }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    await expect(
      orders.updateStatus(tenantId, order.id, { status: 'SHIPPED' }),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_STATUS_TRANSITION' });
    await expect(
      orders.updateStatus(tenantId, order.id, { status: 'PROCESSING' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_READY' });
    expect(await notifications(order.id)).toEqual([]);
    expect(
      (await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe('CONFIRMED');
  });

  it('rolls the notification and outbox job back with the order update', async () => {
    const order = await fixture('PENDING', 'PENDING');
    let jobId: string | undefined;
    await expect(
      testPrisma.$transaction(async (tx) => {
        await orders.applyStatusWithClient(tenantId, order.id, 'CONFIRMED', tx);
        const job = await tx.notificationPushJob.findFirstOrThrow({
          where: {
            tenantId,
            notification: { eventKey: `order_confirmed_${order.id}` },
          },
        });
        jobId = job.id;
        throw new Error('fixture rollback');
      }),
    ).rejects.toThrow('fixture rollback');
    expect(jobId).toBeDefined();
    expect(
      await testPrisma.notificationPushJob.findUnique({
        where: { id: jobId! },
      }),
    ).toBeNull();
    expect(await notifications(order.id)).toEqual([]);
    expect(
      (await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe('PENDING');
  });
});
