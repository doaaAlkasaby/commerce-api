import type {
  OrderStatus,
  PaymentStatus,
} from '../../generated/prisma/client.js';

export interface OrderListQuery {
  page: number;
  limit: number;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
}

export interface UpdateOrderStatusInput {
  status: OrderStatus;
}

export interface OrderVariantSnapshot {
  attributes?: Array<{
    attributeId: string;
    attributeName: string;
    attributeValueId: string;
    attributeValue: string;
    imageUrl: string | null;
  }>;

  images?: Array<{
    id: string;
    url: string;
    altText: string | null;
    sortOrder: number;
    isPrimary: boolean;
  }>;

  [key: string]: unknown;
}

export interface OrderItemResponse {
  id: string;
  productId: string;
  variantId: string;

  productName: string;
  sku: string;

  quantity: number;

  unitPrice: string;
  itemDiscountAmount: string;
  finalUnitPrice: string;
  totalPrice: string;

  variantSnapshot: OrderVariantSnapshot;

  createdAt: string;
}

export interface OrderPaymentResponse {
  id: string;
  provider: string;
  method: string;
  status: PaymentStatus;

  amount: string;
  currency: string;

  providerPaymentId: string | null;
  providerTransactionId: string | null;

  failureCode: string | null;
  failureMessage: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface OrderResponse {
  id: string;
  orderNumber: string;

  userId: string;

  status: OrderStatus;
  paymentStatus: PaymentStatus;

  currency: string;

  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;

  shippingAddress: unknown;
  billingAddress: unknown;

  items: OrderItemResponse[];
  payments: OrderPaymentResponse[];

  itemCount: number;

  createdAt: string;
  updatedAt: string;
}

export interface PaginatedOrdersResponse {
  items: OrderResponse[];

  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}