import type { Prisma, NotificationType } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { notificationRepository } from './notification.repository.instance.js';
import { mapNotification } from './notification.mapper.js';
import type { NotificationResponse } from './notification.types.js';

export type OrderEventType =
  | 'ORDER_PLACED'
  | 'ORDER_CANCELLED'
  | 'ORDER_SHIPPED'
  | 'ORDER_DELIVERED';

export interface CreateOrderNotificationInput {
  eventType: OrderEventType;
  orderId: string;
  expectedTenantId: string;
  tx: Prisma.TransactionClient;
  tenantSlug?: string;
}

export interface OrderNotificationResult {
  status: 'CREATED' | 'ALREADY_EXISTS';
  notification: NotificationResponse | null;
}

interface NotificationContent {
  type: NotificationType;
  title: string;
  body: string;
}

export class OrderNotificationService {
  constructor(private readonly repository = notificationRepository) {}

  private getContent(eventType: OrderEventType, orderNumber: string): NotificationContent {
    switch (eventType) {
      case 'ORDER_PLACED':
        return {
          type: 'ORDER',
          title: `Order Placed: #${orderNumber}`,
          body: `Your order #${orderNumber} has been placed successfully.`,
        };
      case 'ORDER_CANCELLED':
        return {
          type: 'ORDER',
          title: `Order Cancelled: #${orderNumber}`,
          body: `Your order #${orderNumber} has been cancelled.`,
        };
      case 'ORDER_SHIPPED':
        return {
          type: 'SHIPPING',
          title: `Order Shipped: #${orderNumber}`,
          body: `Great news! Your order #${orderNumber} has been shipped and is on its way.`,
        };
      case 'ORDER_DELIVERED':
        return {
          type: 'SHIPPING',
          title: `Order Delivered: #${orderNumber}`,
          body: `Your order #${orderNumber} has been delivered successfully.`,
        };
    }
  }

  async createOrderNotification(
    input: CreateOrderNotificationInput,
  ): Promise<OrderNotificationResult> {
    const { eventType, orderId, expectedTenantId, tx, tenantSlug } = input;

    if (!tx) {
      throw new AppError(
        'Transaction client is required for order notifications',
        500,
        'TRANSACTION_REQUIRED',
      );
    }

    if (!orderId || !orderId.trim()) {
      throw new AppError(
        'Order ID is required',
        400,
        'INVALID_ORDER_NOTIFICATION_CONTEXT',
      );
    }

    if (!expectedTenantId || !expectedTenantId.trim()) {
      throw new AppError(
        'Tenant context is required',
        400,
        'INVALID_ORDER_NOTIFICATION_CONTEXT',
      );
    }

    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        tenantId: expectedTenantId,
      },
      select: {
        id: true,
        orderNumber: true,
        tenantId: true,
        userId: true,
      },
    });

    if (!order) {
      throw new AppError(
        'Order not found or tenant context mismatch',
        404,
        'ORDER_NOT_FOUND',
      );
    }

    const eventKey = `${eventType.toLowerCase()}_${order.id}`;
    const content = this.getContent(eventType, order.orderNumber);

    const dataPayload = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      eventType,
      ...(tenantSlug ? { tenantSlug } : {}),
    };

    const notificationRecord = await this.repository.createIdempotent(
      {
        tenantId: order.tenantId,
        userId: order.userId,
        eventKey,
        type: content.type,
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

    return {
      status: 'CREATED',
      notification: mapNotification(notificationRecord),
    };
  }
}

export const orderNotificationService = new OrderNotificationService();
