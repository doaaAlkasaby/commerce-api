import type {
  Order,
  OrderItem,
  Payment,
} from '../../generated/prisma/client.js';

import type {
  OrderItemResponse,
  OrderPaymentResponse,
  OrderResponse,
  PaginatedOrdersResponse,
} from './order.types.js';

type OrderWithRelations =
  Order & {
    items: OrderItem[];
    payments: Payment[];
  };

const mapOrderItem = (
  item: OrderItem,
): OrderItemResponse => ({
  id: item.id,

  productId: item.productId,
  variantId: item.variantId,

  productName: item.productName,
  sku: item.sku,

  quantity: item.quantity,

  unitPrice:
    item.unitPrice.toString(),

  itemDiscountAmount:
    item.itemDiscountAmount.toString(),

  finalUnitPrice:
    item.finalUnitPrice.toString(),

  totalPrice:
    item.totalPrice.toString(),

  variantSnapshot:
    item.variantSnapshot as OrderItemResponse['variantSnapshot'],

  createdAt:
    item.createdAt.toISOString(),
});

const mapPayment = (
  payment: Payment,
): OrderPaymentResponse => ({
  id: payment.id,

  provider:
    payment.provider,

  method:
    payment.method,

  status:
    payment.status,

  amount:
    payment.amount.toString(),

  currency:
    payment.currency,

  providerPaymentId:
    payment.providerPaymentId,

  providerTransactionId:
    payment.providerTransactionId,

  failureCode:
    payment.failureCode,

  failureMessage:
    payment.failureMessage,

  createdAt:
    payment.createdAt.toISOString(),

  updatedAt:
    payment.updatedAt.toISOString(),
});

export const mapOrder = (
  order: OrderWithRelations,
): OrderResponse => ({
  id: order.id,

  orderNumber:
    order.orderNumber,

  userId:
    order.userId,

  status:
    order.status,

  paymentStatus:
    order.paymentStatus,

  currency:
    order.currency,

  subtotal:
    order.subtotal.toString(),

  discountAmount:
    order.discountAmount.toString(),

  shippingAmount:
    order.shippingAmount.toString(),

  taxAmount:
    order.taxAmount.toString(),

  totalAmount:
    order.totalAmount.toString(),

  shippingAddress:
    order.shippingAddress,

  billingAddress:
    order.billingAddress,

  items:
    order.items.map(mapOrderItem),

  payments:
    order.payments.map(mapPayment),

  itemCount:
    order.items.reduce(
      (total, item) =>
        total + item.quantity,
      0,
    ),

  createdAt:
    order.createdAt.toISOString(),

  updatedAt:
    order.updatedAt.toISOString(),
});

export const mapOrders = (
  orders: OrderWithRelations[],
  page: number,
  limit: number,
  totalItems: number,
): PaginatedOrdersResponse => {
  return {
    items: orders.map(mapOrder),

    pagination: {
      page,
      limit,
      totalItems,
      totalPages:
        Math.ceil(
          totalItems / limit,
        ),
    },
  };
};