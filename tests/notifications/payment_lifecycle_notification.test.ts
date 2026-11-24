import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../../src/config/test-database.js';
import type { PaymentStatus } from '../../src/generated/prisma/client.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';

describe('Phase NOTIF-7C: Payment & Refund Notifications PostgreSQL Integration Tests', () => {
  const paymentService = new PaymentService();
  const tenantId = randomUUID();
  const foreignTenantId = randomUUID();
  const customerId = randomUUID();
  const tenantSlug = `payment-notif-${tenantId}`;

  beforeAll(async () => {
    await testPrisma.tenant.createMany({
      data: [
        { id: tenantId, slug: tenantSlug, name: 'PaymentNotifStore', code: tenantId },
        {
          id: foreignTenantId,
          slug: `foreign-${foreignTenantId}`,
          name: 'ForeignStore',
          code: foreignTenantId,
        },
      ],
    });
    await testPrisma.user.create({
      data: {
        id: customerId,
        email: `${customerId}@example.test`,
        passwordHash: 'fixture-password',
        firstName: 'Payment',
        lastName: 'Customer',
      },
    });
  });

  afterAll(async () => {
    await testPrisma.paymentRefund.deleteMany({ where: { tenantId } });
    await testPrisma.notificationPushJob.deleteMany({ where: { tenantId } });
    await testPrisma.notification.deleteMany({ where: { tenantId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.user.deleteMany({ where: { id: customerId } });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, foreignTenantId] } },
    });
    await testPrisma.$disconnect();
  });

  async function seedSettledRefund(
    tx: Parameters<Parameters<typeof testPrisma.$transaction>[0]>[0],
    orderId: string,
    paymentId: string,
    amount: string,
    providerRefundId: string,
  ) {
    return tx.paymentRefund.create({
      data: {
        tenantId,
        paymentId,
        orderId,
        provider: 'MYFATOORAH',
        method: 'CARD',
        amount,
        currency: 'USD',
        status: 'SUCCEEDED',
        idempotencyKey: `notif-ref-${randomUUID()}`,
        requestFingerprint: `fp-${randomUUID()}`,
        providerRefundId,
        reason: 'Notification test ledger-backed refund',
        requestedByUserId: customerId,
        submittedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  async function createOrderWithPayment(
    initialPaymentStatus: PaymentStatus = 'PENDING',
    amount = 100,
  ) {
    const order = await testPrisma.order.create({
      data: {
        tenantId,
        userId: customerId,
        orderNumber: `PAY-${randomUUID()}`,
        status: 'PENDING',
        paymentStatus: initialPaymentStatus,
        currency: 'USD',
        subtotal: amount,
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        totalAmount: amount,
        shippingAddress: {},
        billingAddress: {},
        payments: {
          create: {
            provider: 'MYFATOORAH',
            method: 'CARD',
            status: initialPaymentStatus,
            amount: amount,
            currency: 'USD',
            initiationState: 'INITIATED',
          },
        },
      },
      include: { payments: true },
    });
    return { order, payment: order.payments[0]! };
  }

  function getNotificationsForOrder(orderId: string) {
    return testPrisma.notification.findMany({
      where: { tenantId, data: { path: ['orderId'], equals: orderId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  it('1. Enqueues PAYMENT_PAID notification and outbox job on status transition to PAID', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING', 100);

    await paymentService.applyTrustedPaymentStatus(
      tenantId,
      payment.id,
      {
        status: 'PAID',
        providerPaymentId: `prov-${payment.id}`,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: 'MYFATOORAH',
        providerPaymentId: `prov-${payment.id}`,
      },
    );

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      tenantId,
      userId: customerId,
      type: 'PAYMENT',
      eventKey: `payment_paid_${payment.id}`,
      data: {
        paymentId: payment.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        eventType: 'PAYMENT_PAID',
        amount: '100',
        currency: 'USD',
        tenantSlug,
      },
    });

    const job = await testPrisma.notificationPushJob.findUniqueOrThrow({
      where: { notificationId: notifs[0]!.id },
    });
    expect(job).toMatchObject({ tenantId, state: 'READY' });
  });

  it('2. Enqueues PAYMENT_FAILED notification on status transition to FAILED', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING');

    await paymentService.updatePaymentStatus(tenantId, payment.id, {
      status: 'FAILED',
      failureCode: 'CARD_DECLINED',
      failureMessage: 'Insufficient funds',
    });

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      tenantId,
      userId: customerId,
      type: 'PAYMENT',
      eventKey: `payment_failed_${payment.id}`,
      data: {
        paymentId: payment.id,
        orderId: order.id,
        eventType: 'PAYMENT_FAILED',
      },
    });
  });

  it('3. Original payment 100, partial refund 20: notification displays exact amount 20 (not 100)', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING', 100);

    // Pay first
    await paymentService.applyTrustedPaymentStatus(
      tenantId,
      payment.id,
      {
        status: 'PAID',
        providerPaymentId: `prov-${payment.id}`,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: 'MYFATOORAH',
        providerPaymentId: `prov-${payment.id}`,
      },
    );

    // Partial refund 20 via trusted internal PAYMENT_REFUND boundary with persisted ledger proof
    await testPrisma.$transaction(async (tx) => {
      const seeded = await seedSettledRefund(
        tx,
        order.id,
        payment.id,
        '20',
        'txn-partial-20',
      );
      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: 'PARTIALLY_REFUNDED',
          refundId: seeded.id,
          refundAmount: '20',
          providerTransactionId: 'txn-partial-20',
        },
        tx,
        { transition: { kind: 'PAYMENT_REFUND', refundId: seeded.id } },
      );
    });

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(2); // PAID + PARTIALLY_REFUNDED

    const partialNotif = notifs[1]!;
    expect(partialNotif.body).toContain('20');
    expect((partialNotif.data as Record<string, unknown>).amount).toBe('20');
  });

  it('4. Two separate partial refunds of 20 and 30 create two distinct notifications', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING', 100);

    // Pay first
    await paymentService.applyTrustedPaymentStatus(
      tenantId,
      payment.id,
      {
        status: 'PAID',
        providerPaymentId: `prov-${payment.id}`,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: 'MYFATOORAH',
        providerPaymentId: `prov-${payment.id}`,
      },
    );

    // Partial refund 1: 20 (with persisted ledger proof)
    await testPrisma.$transaction(async (tx) => {
      const seeded1 = await seedSettledRefund(
        tx,
        order.id,
        payment.id,
        '20',
        'txn-refund-part-1',
      );
      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: 'PARTIALLY_REFUNDED',
          refundId: seeded1.id,
          refundAmount: '20',
        },
        tx,
        { transition: { kind: 'PAYMENT_REFUND', refundId: seeded1.id } },
      );
    });

    // Partial refund 2: 30 (cumulative 50 < 100 -> PARTIALLY_REFUNDED)
    await testPrisma.$transaction(async (tx) => {
      const seeded2 = await seedSettledRefund(
        tx,
        order.id,
        payment.id,
        '30',
        'txn-refund-part-2',
      );
      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: 'PARTIALLY_REFUNDED',
          refundId: seeded2.id,
          refundAmount: '30',
        },
        tx,
        { transition: { kind: 'PAYMENT_REFUND', refundId: seeded2.id } },
      );
    });

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(3); // 1 PAID + 2 PARTIALLY_REFUNDED

    expect((notifs[1]!.data as Record<string, unknown>).amount).toBe('20');
    expect((notifs[2]!.data as Record<string, unknown>).amount).toBe('30');
    expect(notifs[1]!.eventKey).not.toBe(notifs[2]!.eventKey);
  });

  it('5. Duplicate webhook for the same partial refund is deduplicated via providerTransactionId', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING', 100);

    await paymentService.applyTrustedPaymentStatus(
      tenantId,
      payment.id,
      {
        status: 'PAID',
        providerPaymentId: `prov-${payment.id}`,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: 'MYFATOORAH',
        providerPaymentId: `prov-${payment.id}`,
      },
    );

    // Webhook call 1 for partial refund
    let seededRefundId = '';
    await testPrisma.$transaction(async (tx) => {
      const seeded = await seedSettledRefund(
        tx,
        order.id,
        payment.id,
        '20',
        'txn-duplicate-refund',
      );
      seededRefundId = seeded.id;
      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: 'PARTIALLY_REFUNDED',
          refundId: seededRefundId,
          refundAmount: '20',
          providerTransactionId: 'txn-duplicate-refund',
        },
        tx,
        { transition: { kind: 'PAYMENT_REFUND', refundId: seededRefundId } },
      );
    });

    // Duplicate Webhook call 2 for same refund
    await testPrisma.$transaction(async (tx) => {
      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: 'PARTIALLY_REFUNDED',
          refundId: seededRefundId,
          refundAmount: '20',
          providerTransactionId: 'txn-duplicate-refund',
        },
        tx,
        { transition: { kind: 'PAYMENT_REFUND', refundId: seededRefundId } },
      );
    });

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(2); // PAID + 1 PARTIALLY_REFUNDED (duplicate suppressed!)
  });

  it('6. Full refund displays full payment amount in notification', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING', 100);

    await paymentService.applyTrustedPaymentStatus(
      tenantId,
      payment.id,
      {
        status: 'PAID',
        providerPaymentId: `prov-${payment.id}`,
      },
      {
        kind: 'PROVIDER_VERIFICATION',
        provider: 'MYFATOORAH',
        providerPaymentId: `prov-${payment.id}`,
      },
    );

    await testPrisma.$transaction(async (tx) => {
      const seededFull = await seedSettledRefund(
        tx,
        order.id,
        payment.id,
        '100',
        'txn-full-refund',
      );
      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: 'REFUNDED',
          refundId: seededFull.id,
          refundAmount: '100',
          providerTransactionId: 'txn-full-refund',
        },
        tx,
        { transition: { kind: 'PAYMENT_REFUND', refundId: seededFull.id } },
      );
    });

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(2);
    expect((notifs[1]!.data as Record<string, unknown>).amount).toBe('100');
    expect(notifs[1]!.title).toContain('Refund Processed');
  });

  it('7. Tenant isolation: foreign tenant status updates are rejected without generating notifications', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING');

    await expect(
      paymentService.updatePaymentStatus(foreignTenantId, payment.id, {
        status: 'PAID',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(0);
  });

  it('8. Transaction rollback safely removes payment notification and outbox job', async () => {
    const { order, payment } = await createOrderWithPayment('PENDING');

    let createdNotifId: string | undefined;

    await expect(
      testPrisma.$transaction(async (tx) => {
        await paymentService.applyPaymentStatusWithClient(
          tenantId,
          payment.id,
          { status: 'PAID', providerPaymentId: `prov-${payment.id}` },
          tx,
          {
            transition: {
              kind: 'PROVIDER_VERIFICATION',
              provider: 'MYFATOORAH',
              providerPaymentId: `prov-${payment.id}`,
            },
          },
        );

        const notif = await tx.notification.findFirst({
          where: { tenantId, eventKey: `payment_paid_${payment.id}` },
        });
        createdNotifId = notif?.id;

        throw new Error('Forced payment transaction rollback test');
      }),
    ).rejects.toThrow('Forced payment transaction rollback test');

    expect(createdNotifId).toBeDefined();

    const notifs = await getNotificationsForOrder(order.id);
    expect(notifs).toHaveLength(0);

    const dbPayment = await testPrisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(dbPayment.status).toBe('PENDING');
  });
});
