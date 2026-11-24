import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import { orderNotificationService } from '../../src/modules/notifications/order-notification.service.js';
import { notificationRepository } from '../../src/modules/notifications/notification.repository.instance.js';
import { env } from '../../src/config/env.js';

describe('Phase 2.1: PostgreSQL Integration Tests for Order Notifications', () => {
  let testTenantId: string;
  let testUserId: string;
  let testOrderId: string;
  const testOrderNumber = `ORD-TEST-${Date.now()}`;

  const defaultAddrJson = {
    firstName: 'Test',
    lastName: 'User',
    addressLine1: 'Test St 1',
    city: 'Kuwait City',
    country: 'KW',
  };

  beforeAll(async () => {
    const testDbUrl = env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error(
        'TEST_DATABASE_URL is required for PostgreSQL integration tests',
      );
    }

    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SECURITY GUARD REJECTION: Integration tests must not run in production environment',
      );
    }

    // Query actual PostgreSQL database identity BEFORE any mutation
    const dbNameResult =
        await testPrisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database();
    `;
    const effectiveDbName = dbNameResult[0]?.current_database ?? '';

    const parsedUrl = new URL(testDbUrl);
    const expectedDbName = parsedUrl.pathname.replace(/^\//, '');

    if (
      effectiveDbName === 'commerce_api_dev' ||
      effectiveDbName.endsWith('_dev') ||
      (effectiveDbName !== 'commerce_api_test' &&
        !/^commerce_api_test_phase1b_[a-f0-9]{32}$/.test(effectiveDbName)) ||
      effectiveDbName !== expectedDbName
    ) {
      throw new Error(
        `SECURITY GUARD REJECTION: Effective database connection is "${effectiveDbName}", which is not the isolated test database ("${expectedDbName}"). Aborting before any database mutations.`,
      );
    }

    // Isolated test fixture creation on confirmed test database
    const tenant = await testPrisma.tenant.create({
      data: {
        name: 'Test Notification Tenant',
        slug: `test-notif-tenant-${Date.now()}`,
        code: `TNT_NOTIF_${Date.now()}`,
        timezone: 'Asia/Kuwait',
      },
    });
    testTenantId = tenant.id;

    const user = await testPrisma.user.create({
      data: {
        email: `test_notif_user_${Date.now()}@example.com`,
        passwordHash: 'hash_test_123',
        firstName: 'Test',
        lastName: 'NotificationUser',
      },
    });
    testUserId = user.id;

    const order = await testPrisma.order.create({
      data: {
        tenantId: testTenantId,
        userId: testUserId,
        orderNumber: testOrderNumber,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        currency: 'KWD',
        subtotal: 10.0,
        shippingAmount: 1.0,
        discountAmount: 0.0,
        taxAmount: 0.0,
        totalAmount: 11.0,
        shippingAddress: defaultAddrJson,
        billingAddress: defaultAddrJson,
      },
    });
    testOrderId = order.id;
  });

  afterAll(async () => {
    if (testTenantId) {
      await testPrisma.notification.deleteMany({
        where: { tenantId: testTenantId },
      });
      await testPrisma.order.deleteMany({ where: { tenantId: testTenantId } });
      await testPrisma.tenant.deleteMany({ where: { id: testTenantId } });
    }
    if (testUserId) {
      await testPrisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  it('1. Successfully creates notification derived from persisted PostgreSQL order', async () => {
    await testPrisma.$transaction(async (tx) => {
      const result = await orderNotificationService.createOrderNotification({
        eventType: 'ORDER_PLACED',
        orderId: testOrderId,
        expectedTenantId: testTenantId,
        tx,
        tenantSlug: 'test-notif-tenant',
      });

      expect(result.status).toBe('CREATED');
      expect(result.notification).not.toBeNull();

      const dbRecord = await tx.notification.findFirst({
        where: { id: result.notification!.id },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord!.tenantId).toBe(testTenantId);
      expect(dbRecord!.userId).toBe(testUserId);
      expect(dbRecord!.eventKey).toBe(`order_placed_${testOrderId}`);
      expect(dbRecord!.data).toEqual({
        orderId: testOrderId,
        orderNumber: testOrderNumber,
        eventType: 'ORDER_PLACED',
        tenantSlug: 'test-notif-tenant',
      });
    });
  });

  it('2. Rejects creation when orderId does not exist in DB', async () => {
    await testPrisma.$transaction(async (tx) => {
      await expect(
        orderNotificationService.createOrderNotification({
          eventType: 'ORDER_PLACED',
          orderId: 'non-existent-order-uuid',
          expectedTenantId: testTenantId,
          tx,
        }),
      ).rejects.toThrow('Order not found or tenant context mismatch');
    });
  });

  it('3. Rejects creation when tenant context mismatches the persisted order', async () => {
    await testPrisma.$transaction(async (tx) => {
      await expect(
        orderNotificationService.createOrderNotification({
          eventType: 'ORDER_PLACED',
          orderId: testOrderId,
          expectedTenantId: 'mismatched-tenant-id',
          tx,
        }),
      ).rejects.toThrow('Order not found or tenant context mismatch');
    });
  });

  it('4. Repeated duplicate eventKey in same transaction completes without transaction abortion', async () => {
    await testPrisma.$transaction(async (tx) => {
      const duplicateRes =
        await orderNotificationService.createOrderNotification({
          eventType: 'ORDER_PLACED',
          orderId: testOrderId,
          expectedTenantId: testTenantId,
          tx,
        });

      expect(duplicateRes.status).toBe('ALREADY_EXISTS');
      expect(duplicateRes.notification).toBeNull();

      const count = await tx.notification.count({
        where: {
          tenantId: testTenantId,
          eventKey: `order_placed_${testOrderId}`,
        },
      });
      expect(count).toBe(1);
    });
  });

  it('5. Concurrent duplicate event attempts produce ALREADY_EXISTS and query succeeds', async () => {
    const cancelOrderId = `ord-cancel-${Date.now()}`;
    const order = await testPrisma.order.create({
      data: {
        id: cancelOrderId,
        tenantId: testTenantId,
        userId: testUserId,
        orderNumber: `ORD-CANCEL-${Date.now()}`,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        currency: 'KWD',
        subtotal: 15.0,
        shippingAmount: 1.0,
        discountAmount: 0.0,
        taxAmount: 0.0,
        totalAmount: 16.0,
        shippingAddress: defaultAddrJson,
        billingAddress: defaultAddrJson,
      },
    });

    const [res1, res2] = await Promise.all([
      testPrisma.$transaction((tx) =>
        orderNotificationService.createOrderNotification({
          eventType: 'ORDER_CANCELLED',
          orderId: order.id,
          expectedTenantId: testTenantId,
          tx,
        }),
      ),
      testPrisma.$transaction((tx) =>
        orderNotificationService.createOrderNotification({
          eventType: 'ORDER_CANCELLED',
          orderId: order.id,
          expectedTenantId: testTenantId,
          tx,
        }),
      ),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain('CREATED');
    expect(statuses).toContain('ALREADY_EXISTS');

    const totalCount = await testPrisma.notification.count({
      where: {
        tenantId: testTenantId,
        eventKey: `order_cancelled_${order.id}`,
      },
    });
    expect(totalCount).toBe(1);
  });

  it('6. Transaction rollback safely removes created notification', async () => {
    const rollbackOrderId = `ord-rb-${Date.now()}`;
    const order = await testPrisma.order.create({
      data: {
        id: rollbackOrderId,
        tenantId: testTenantId,
        userId: testUserId,
        orderNumber: `ORD-RB-${Date.now()}`,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        currency: 'KWD',
        subtotal: 5.0,
        shippingAmount: 0.0,
        discountAmount: 0.0,
        taxAmount: 0.0,
        totalAmount: 5.0,
        shippingAddress: defaultAddrJson,
        billingAddress: defaultAddrJson,
      },
    });

    try {
      await testPrisma.$transaction(async (tx) => {
        await orderNotificationService.createOrderNotification({
          eventType: 'ORDER_PLACED',
          orderId: order.id,
          expectedTenantId: testTenantId,
          tx,
        });

        throw new Error('Forced rollback test error');
      });
    } catch (e) {
      expect((e as Error).message).toBe('Forced rollback test error');
    }

    const count = await testPrisma.notification.count({
      where: { eventKey: `order_placed_${order.id}` },
    });
    expect(count).toBe(0);
  });

  it('7. Unrelated database errors (e.g. non-existent tenant/user FK during raw insert) are propagated rather than swallowed', async () => {
    await expect(
      testPrisma.$transaction(async (tx) => {
        await notificationRepository.createIdempotent(
          {
            tenantId: 'non-existent-tenant-uuid',
            userId: 'non-existent-user-uuid',
            eventKey: `test_err_key_${Date.now()}`,
            type: 'ORDER',
            title: 'Title',
            body: 'Body',
          },
          tx,
        );
      }),
    ).rejects.toThrow();
  });
});
