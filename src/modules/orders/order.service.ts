import type { Prisma } from '../../generated/prisma/client.js';
import {
  validateOrderTransition,
  isFinanciallyCommitted,
} from '../../common/domain/status-transitions.js';
import { paymentService } from '../payments/payment.service.instance.js';
import { OrderStatus, PaymentStatus } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

import { mapOrder, mapOrders } from './order.mapper.js';
import { prisma } from '../../config/database.js';
import { inventoryService } from '../inventory/inventory.service.instance.js';
import { orderNotificationService } from '../notifications/order-notification.service.js';
import type { OrderEventType } from '../notifications/order-notification.service.js';

import { orderRepository } from './order.repository.instance.js';

import type { OrderListQuery, UpdateOrderStatusInput } from './order.types.js';

export class OrderService {
  async getMyOrders(tenantId: string, userId: string, query: OrderListQuery) {
    const result = await orderRepository.findManyByUserId(
      tenantId,
      userId,
      query.page,
      query.limit,
      query.status,
      query.paymentStatus,
    );

    return mapOrders(result.orders, query.page, query.limit, result.totalItems);
  }

  async getMyOrder(tenantId: string, userId: string, orderId: string) {
    const order = await orderRepository.findByIdForUser(
      tenantId,
      orderId,
      userId,
    );

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    return mapOrder(order);
  }

  async getOrder(tenantId: string, orderId: string) {
    const order = await orderRepository.findById(tenantId, orderId);

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    return mapOrder(order);
  }

  async getOrders(tenantId: string, query: OrderListQuery) {
    const result = await orderRepository.findMany(
      tenantId,
      query.page,
      query.limit,
      query.status,
      query.paymentStatus,
    );

    return mapOrders(result.orders, query.page, query.limit, result.totalItems);
  }

  async updateStatus(
    tenantId: string,
    orderId: string,
    input: UpdateOrderStatusInput,
  ) {
    const order = await prisma.$transaction((tx) =>
      this.applyStatusWithClient(tenantId, orderId, input.status, tx),
    );
    return mapOrder(order);
  }

  async applyStatusWithClient(
    tenantId: string,
    orderId: string,
    status: OrderStatus,
    tx: Prisma.TransactionClient,
    requirePending = false,
  ) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "id"=${orderId} AND "tenantId"=${tenantId} FOR UPDATE
    `;
    if (!locked.length)
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    const order = await tx.order.findFirstOrThrow({
      where: { id: orderId, tenantId },
      include: { items: true, payments: true },
    });
    if (order.status === status) return order; // Duplicate updates are no-ops.
    if (
      requirePending &&
      (order.status !== 'PENDING' ||
        isFinanciallyCommitted(order.paymentStatus))
    )
      throw new AppError(
        'Only pending unpaid orders can expire',
        409,
        'ORDER_NOT_EXPIRABLE',
      );
    validateOrderTransition(order.status, status);
    if (
      order.payments.length !== 1 ||
      order.payments[0]!.status !== order.paymentStatus
    )
      throw new AppError(
        'Legacy order/payment state requires reconciliation',
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
      );
    let updatedOrder: Prisma.OrderGetPayload<{
      include: { items: true; payments: true };
    }>;
    if (status === 'CANCELLED') {
      if (
        isFinanciallyCommitted(order.paymentStatus) ||
        order.payments.some((p) => isFinanciallyCommitted(p.status))
      )
        throw new AppError(
          'Paid orders require a refund workflow before cancellation',
          409,
          'PAID_ORDER_CANCELLATION_REQUIRES_REFUND',
        );
      // Unknown initiation outcomes are not failures. Explicit cancellation or
      // expiry closes the local reservation; any later success needs reconciliation.
      for (const payment of [...order.payments].sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        if (payment.status !== 'FAILED' && payment.status !== 'CANCELLED')
          await paymentService.applyPaymentStatusWithClient(
            tenantId,
            payment.id,
            { status: PaymentStatus.CANCELLED },
            tx,
          );
      }
      await inventoryService.releaseOrderReservation(tenantId, orderId, tx);
      updatedOrder = await tx.order.update({
        where: { id: orderId, tenantId },
        data: { status },
        include: { items: true, payments: true },
      });
    } else {
      if (
        ['PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(status) &&
        order.paymentStatus !== 'PAID' &&
        order.paymentStatus !== 'AUTHORIZED'
      )
        throw new AppError(
          'Payment must be authorized or paid for fulfillment',
          409,
          'PAYMENT_NOT_READY',
        );
      if (['FAILED', 'CANCELLED'].includes(order.paymentStatus))
        throw new AppError(
          'Order reservation has ended',
          409,
          'ORDER_INVENTORY_RESERVATION_RELEASED',
        );
      updatedOrder = await tx.order.update({
        where: { id: orderId, tenantId },
        data: { status },
        include: { items: true, payments: true },
      });
    }

    const eventTypeMap: Record<OrderStatus, OrderEventType | null> = {
      PENDING: null,
      CONFIRMED: 'ORDER_CONFIRMED',
      PROCESSING: 'ORDER_PROCESSING',
      SHIPPED: 'ORDER_SHIPPED',
      DELIVERED: 'ORDER_DELIVERED',
      COMPLETED: 'ORDER_COMPLETED',
      CANCELLED: 'ORDER_CANCELLED',
    };

    const targetEventType = eventTypeMap[status];
    if (targetEventType) {
      await orderNotificationService.createOrderNotification({
        eventType: targetEventType,
        orderId: updatedOrder.id,
        expectedTenantId: tenantId,
        tx,
      });
    }

    return updatedOrder;
  }

  /**
   * Called by an expiration worker after it has determined that the
   * pending order's payment deadline has elapsed. The recovery worker adds
   * its own stricter external-payment and lease checks before using this lifecycle.
   */
  async expirePendingOrder(tenantId: string, orderId: string) {
    const order = await prisma.$transaction((tx) =>
      this.applyStatusWithClient(
        tenantId,
        orderId,
        OrderStatus.CANCELLED,
        tx,
        true,
      ),
    );
    return mapOrder(order);
  }
}
