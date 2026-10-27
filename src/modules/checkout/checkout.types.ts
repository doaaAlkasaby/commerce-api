import type {
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../generated/prisma/client.js';




export interface CheckoutInput {
  shippingAddressId: string;
  billingAddressId?: string;
  billingSameAsShipping?: boolean;
  couponCode?: string;

  shippingMethodId?: string;

  paymentMethod: PaymentMethod;
  paymentProvider?: PaymentProvider;
  currency?: string;
}

export interface CheckoutContext {
  tenantId: string;
  userId: string;
  idempotencyKey: string;
}

export interface CheckoutResult {
  order: CheckoutOrderResponse;
  payment: CheckoutPaymentResponse | null;
  idempotent: boolean;
}

export interface CheckoutOrderItemResponse {
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
  variantSnapshot: Record<string, unknown>;
}

export interface CheckoutOrderResponse {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;

  shippingMethodId: string | null;
  shippingMethodCode: string | null;
  shippingMethodName: string | null;


  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  items: CheckoutOrderItemResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutPaymentResponse {
  id: string;
  provider: PaymentProvider;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: string;
  currency: string;
  providerPaymentId: string | null;
  providerTransactionId: string | null;
  checkoutUrl?: string | null;
  clientSecret?: string | null;
}

export interface CheckoutInput {
  shippingAddressId: string;
  billingAddressId?: string;
  billingSameAsShipping?: boolean;
  couponCode?: string;

  shippingMethodCode?: string;

  paymentMethod: PaymentMethod;
  paymentProvider?: PaymentProvider;
  currency?: string;
}
