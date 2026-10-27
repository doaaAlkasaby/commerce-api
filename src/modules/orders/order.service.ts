import {
  OrderStatus,
  PaymentStatus,
} from '../../generated/prisma/client.js';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  mapOrder,
  mapOrders,
} from './order.mapper.js';

import {
  orderRepository,
} from './order.repository.instance.js';

import type {
  OrderListQuery,
  UpdateOrderStatusInput,
} from './order.types.js';

const allowedTransitions: Record<
  OrderStatus,
  OrderStatus[]
> = {
  [OrderStatus.PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],

  [OrderStatus.CONFIRMED]: [
    OrderStatus.PROCESSING,
    OrderStatus.CANCELLED,
  ],

  [OrderStatus.PROCESSING]: [
    OrderStatus.SHIPPED,
  ],

  [OrderStatus.SHIPPED]: [
    OrderStatus.DELIVERED,
  ],

  [OrderStatus.DELIVERED]: [
    OrderStatus.COMPLETED,
  ],

  [OrderStatus.CANCELLED]: [],

  [OrderStatus.COMPLETED]: [],
};

export class OrderService {
  async getMyOrders(
    tenantId: string,
    userId: string,
    query: OrderListQuery,
  ) {
    const result =
      await orderRepository.findManyByUserId(
        tenantId,
        userId,
        query.page,
        query.limit,
        query.status,
        query.paymentStatus,
      );

    return mapOrders(
      result.orders,
      query.page,
      query.limit,
      result.totalItems,
    );
  }

  async getMyOrder(
    tenantId: string,
    userId: string,
    orderId: string,
  ) {
    const order =
      await orderRepository.findByIdForUser(
        tenantId,
        orderId,
        userId,
      );

    if (!order) {
      throw new AppError(
        'Order not found',
        404,
        'ORDER_NOT_FOUND',
      );
    }

    return mapOrder(order);
  }

  async getOrder(
    tenantId: string,
    orderId: string,
  ) {
    const order =
      await orderRepository.findById(
        tenantId,
        orderId,
      );

    if (!order) {
      throw new AppError(
        'Order not found',
        404,
        'ORDER_NOT_FOUND',
      );
    }

    return mapOrder(order);
  }

  async getOrders(
    tenantId: string,
    query: OrderListQuery,
  ) {
    const result =
      await orderRepository.findMany(
        tenantId,
        query.page,
        query.limit,
        query.status,
        query.paymentStatus,
      );

    return mapOrders(
      result.orders,
      query.page,
      query.limit,
      result.totalItems,
    );
  }

  async updateStatus(
    tenantId: string,
    orderId: string,
    input: UpdateOrderStatusInput,
  ) {
    const order =
      await orderRepository.findById(
        tenantId,
        orderId,
      );

    if (!order) {
      throw new AppError(
        'Order not found',
        404,
        'ORDER_NOT_FOUND',
      );
    }

    if (
      order.status ===
      input.status
    ) {
      throw new AppError(
        'Order is already in this status',
        409,
        'ORDER_ALREADY_IN_STATUS',
      );
    }

    const allowed =
      allowedTransitions[
        order.status
      ];

    if (
      !allowed.includes(
        input.status,
      )
    ) {
      throw new AppError(
        `Cannot change order status from ${order.status} to ${input.status}`,
        409,
        'INVALID_ORDER_STATUS_TRANSITION',
      );
    }

    /*
     * Payment-dependent protection.
     *
     * We should not move an order to
     * PROCESSING unless its payment is
     * already authorized/paid.
     *
     * CASH_ON_DELIVERY is handled by the
     * payment module/business flow.
     */
    if (
      input.status ===
        OrderStatus.PROCESSING &&
      order.paymentStatus !==
        PaymentStatus.PAID &&
      order.paymentStatus !==
        PaymentStatus.AUTHORIZED
    ) {
      throw new AppError(
        'Order cannot be processed before payment is authorized or paid',
        409,
        'PAYMENT_NOT_READY',
      );
    }

    const updated =
      await orderRepository.updateStatus(
        tenantId,
        orderId,
        input.status,
      );

    return mapOrder(updated);
  }
}
