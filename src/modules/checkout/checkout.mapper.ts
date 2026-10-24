import type {
  Payment,
  Order,
  OrderItem,
} from '../../generated/prisma/client.js';

import type {
  CheckoutOrderItemResponse,
  CheckoutOrderResponse,
  CheckoutPaymentResponse,
} from './checkout.types.js';

const toRecord = (
  value: unknown,
): Record<string, unknown> => {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return {};
};

export const mapCheckoutOrderItem = (
  item: OrderItem,
): CheckoutOrderItemResponse => ({
  id: item.id,
  productId: item.productId,
  variantId: item.variantId,
  productName: item.productName,
  sku: item.sku,
  quantity: item.quantity,
  unitPrice: item.unitPrice.toString(),
  itemDiscountAmount:
    item.itemDiscountAmount.toString(),
  finalUnitPrice:
    item.finalUnitPrice.toString(),
  totalPrice: item.totalPrice.toString(),
  variantSnapshot: toRecord(
    item.variantSnapshot,
  ),
});

export const mapCheckoutOrder = (
  order: Order & {
    items: OrderItem[];
  },
): CheckoutOrderResponse => ({
  id: order.id,
  orderNumber: order.orderNumber,
  status: order.status,
  paymentStatus: order.paymentStatus,
  currency: order.currency,
  subtotal: order.subtotal.toString(),
  discountAmount:
    order.discountAmount.toString(),
  shippingAmount:
    order.shippingAmount.toString(),
  taxAmount:
    order.taxAmount.toString(),
  totalAmount:
    order.totalAmount.toString(),
  shippingAddress: toRecord(
    order.shippingAddress,
  ),
  billingAddress: toRecord(
    order.billingAddress,
  ),
  items: order.items.map(
    mapCheckoutOrderItem,
  ),
  createdAt: order.createdAt.toISOString(),
  updatedAt: order.updatedAt.toISOString(),
});

export const mapCheckoutPayment = (
  payment: Payment,
): CheckoutPaymentResponse => ({
  id: payment.id,
  provider: payment.provider,
  method: payment.method,
  status: payment.status,
  amount: payment.amount.toString(),
  currency: payment.currency,
  providerPaymentId:
    payment.providerPaymentId,
  providerTransactionId:
    payment.providerTransactionId,
});