import type {
  OrderStatus,
  PaymentStatus,
} from '../../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';

export const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};
export const paymentTransitions: Record<
  PaymentStatus,
  readonly PaymentStatus[]
> = {
  PENDING: ['REQUIRES_ACTION', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
  REQUIRES_ACTION: ['AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: ['CANCELLED'],
  CANCELLED: [],
  REFUND_PENDING: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
  REFUNDED: [],
};
export function validateOrderTransition(
  current: OrderStatus,
  next: OrderStatus,
) {
  if (current !== next && !orderTransitions[current].includes(next))
    throw new AppError(
      `Cannot change order status from ${current} to ${next}`,
      409,
      'INVALID_ORDER_STATUS_TRANSITION',
    );
}
export function validatePaymentTransition(
  current: PaymentStatus,
  next: PaymentStatus,
) {
  if (current === 'FAILED' && next === 'PENDING')
    throw new AppError(
      'Released reservations cannot be restarted',
      409,
      'ORDER_INVENTORY_RESERVATION_RELEASED',
    );
  if (current !== next && !paymentTransitions[current].includes(next))
    throw new AppError(
      `Cannot change payment status from ${current} to ${next}`,
      409,
      'INVALID_PAYMENT_STATUS_TRANSITION',
    );
}
export const isFinanciallyCommitted = (status: PaymentStatus) =>
  ['PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(status);
