import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { notificationRepository } from './notification.repository.instance.js';
import { mapNotification } from './notification.mapper.js';
import type { NotificationResponse } from './notification.types.js';

export type PaymentEventType =
  | 'PAYMENT_PAID'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_PARTIALLY_REFUNDED';

export interface CreatePaymentNotificationInput {
  eventType: PaymentEventType;
  paymentId: string;
  expectedTenantId: string;
  tx: Prisma.TransactionClient;
  tenantSlug?: string;
  refundId?: string;
  refundAmount?: string;
  isIncrementalFinalRefund?: boolean;
  providerTransactionId?: string;
}

export interface PaymentNotificationResult {
  status: 'CREATED' | 'ALREADY_EXISTS';
  notification: NotificationResponse | null;
}

interface NotificationContent {
  title: string;
  body: string;
}

export class PaymentNotificationService {
  constructor(private readonly repository = notificationRepository) {}

  private getContent(
    eventType: PaymentEventType,
    orderNumber: string,
    currency: string,
    amount: string,
    isIncrementalFinalRefund = false,
  ): NotificationContent {
    switch (eventType) {
      case 'PAYMENT_PAID':
        return {
          title: `Payment Received: #${orderNumber}`,
          body: `Payment of ${currency} ${amount} for order #${orderNumber} was processed successfully.`,
        };
      case 'PAYMENT_FAILED':
        return {
          title: `Payment Failed: #${orderNumber}`,
          body: `Payment for order #${orderNumber} failed. Please try placing your order again.`,
        };
      case 'PAYMENT_REFUNDED':
        return {
          title: `Refund Processed: #${orderNumber}`,
          body: isIncrementalFinalRefund
            ? `A refund of ${currency} ${amount} has been processed for order #${orderNumber}, completing the full refund for this order.`
            : `A full refund of ${currency} ${amount} has been processed for order #${orderNumber}.`,
        };
      case 'PAYMENT_PARTIALLY_REFUNDED':
        return {
          title: `Partial Refund Processed: #${orderNumber}`,
          body: `A partial refund of ${currency} ${amount} has been processed for order #${orderNumber}.`,
        };
    }
  }

  async createPaymentNotification(
    input: CreatePaymentNotificationInput,
  ): Promise<PaymentNotificationResult> {
    const {
      eventType,
      paymentId,
      expectedTenantId,
      tx,
      tenantSlug,
      refundId,
      refundAmount,
      isIncrementalFinalRefund,
      providerTransactionId,
    } = input;

    if (!tx) {
      throw new AppError(
        'Transaction client is required for payment notifications',
        500,
        'TRANSACTION_REQUIRED',
      );
    }

    if (!paymentId || !paymentId.trim()) {
      throw new AppError(
        'Payment ID is required',
        400,
        'INVALID_PAYMENT_NOTIFICATION_CONTEXT',
      );
    }

    if (!expectedTenantId || !expectedTenantId.trim()) {
      throw new AppError(
        'Tenant context is required',
        400,
        'INVALID_PAYMENT_NOTIFICATION_CONTEXT',
      );
    }

    if (eventType === 'PAYMENT_PARTIALLY_REFUNDED' && !refundAmount?.trim()) {
      throw new AppError(
        'Refund amount is required for partial refund notifications',
        400,
        'INVALID_PAYMENT_NOTIFICATION_CONTEXT',
      );
    }

    const payment = await tx.payment.findFirst({
      where: {
        id: paymentId,
        order: { tenantId: expectedTenantId },
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        orderId: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            tenantId: true,
            userId: true,
            tenant: { select: { slug: true } },
          },
        },
      },
    });

    if (!payment || !payment.order) {
      throw new AppError(
        'Payment not found or tenant context mismatch',
        404,
        'PAYMENT_NOT_FOUND',
      );
    }

    const order = payment.order;
    const displayAmount = refundAmount ?? payment.amount.toString();

    let eventKey: string;
    const normalizedRefundId = refundId?.trim();
    if (
      eventType === 'PAYMENT_PARTIALLY_REFUNDED' ||
      eventType === 'PAYMENT_REFUNDED'
    ) {
      if (normalizedRefundId) {
        eventKey = `${eventType.toLowerCase()}_${payment.id}_refund_${normalizedRefundId}`;
      } else {
        const txRef = providerTransactionId || displayAmount;
        eventKey = `${eventType.toLowerCase()}_${payment.id}_${txRef}`;
      }
    } else {
      eventKey = `${eventType.toLowerCase()}_${payment.id}`;
    }

    const content = this.getContent(
      eventType,
      order.orderNumber,
      payment.currency,
      displayAmount,
      isIncrementalFinalRefund === true,
    );

    const resolvedSlug = tenantSlug ?? order.tenant?.slug;
    const dataPayload = {
      paymentId: payment.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: displayAmount,
      currency: payment.currency,
      eventType,
      ...(normalizedRefundId ? { refundId: normalizedRefundId } : {}),
      ...(eventType === 'PAYMENT_REFUNDED'
        ? { aggregatePaymentStatus: 'REFUNDED' }
        : eventType === 'PAYMENT_PARTIALLY_REFUNDED'
          ? { aggregatePaymentStatus: 'PARTIALLY_REFUNDED' }
          : {}),
      ...(resolvedSlug ? { tenantSlug: resolvedSlug } : {}),
    };

    const notificationRecord = await this.repository.createIdempotent(
      {
        tenantId: order.tenantId,
        userId: order.userId,
        eventKey,
        type: 'PAYMENT',
        title: content.title,
        body: content.body,
        data: dataPayload,
      },
      tx,
    );

    if (!notificationRecord) {
      return {
        status: 'ALREADY_EXISTS',
        notification: null,
      };
    }

    await tx.notificationPushJob.create({
      data: {
        tenantId: order.tenantId,
        notificationId: notificationRecord.id,
        state: 'READY',
      },
    });

    return {
      status: 'CREATED',
      notification: mapNotification(notificationRecord),
    };
  }
}

export const paymentNotificationService = new PaymentNotificationService();
