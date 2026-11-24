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

export type CodReceivedCondition = 'RESELLABLE' | 'DAMAGED';

export type CodCollectionStatus =
  | 'NOT_APPLICABLE'
  | 'AWAITING_DELIVERY'
  | 'AWAITING_COLLECTION'
  | 'COLLECTED'
  | 'REFUSED_WITH_COURIER'
  | 'RETURNED_TO_WAREHOUSE'
  | 'CANCELLED';

export interface ConfirmCodPaymentInput {
  referenceId: string;
  collectedAmount: string;
  currency: string;
  note?: string;
}

export interface MarkCodRefusedInput {
  referenceId: string;
  reason: string;
  courierReference?: string;
}

export interface ConfirmCodReturnInput {
  referenceId: string;
  warehouseId: string;
  receivedCondition: CodReceivedCondition;
  note: string;
}

export interface OrderCodCollectionSummary {
  referenceId: string;
  collectedAmount: string;
  currency: string;
  collectedByUserId: string;
  collectedAt: string;
  note: string | null;
}

export interface OrderCodReturnSummary {
  state: 'REFUSED_WITH_COURIER' | 'RETURNED_TO_WAREHOUSE';
  refusalReferenceId: string;
  refusedByUserId: string;
  refusedAt: string;
  reason: string;
  courierReference: string | null;
  returnReferenceId: string | null;
  returnedByUserId: string | null;
  returnedAt: string | null;
  warehouseId: string | null;
  receivedCondition: CodReceivedCondition | null;
  returnNote: string | null;
}

export interface OrderCodSummary {
  isCod: boolean;
  collectionStatus: CodCollectionStatus;
  canConfirmPayment: boolean;
  canMarkRefused: boolean;
  canConfirmReturn: boolean;
  deliveredAt: string | null;
  unpaidDeliveredAgeHours: number | null;
  collection: OrderCodCollectionSummary | null;
  returnInfo: OrderCodReturnSummary | null;
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

  taxCategoryCode: string | null;
  taxCategoryId: string | null;
  taxRuleId: string | null;
  taxTreatment: string | null;
  taxRate: string | null;
  taxableAmount: string;
  taxAmount: string;
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
  warehouseId: string | null;
  fulfillmentSnapshot: import('../../generated/prisma/client.js').Prisma.JsonValue;
  id: string;
  orderNumber: string;

  userId: string;

  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  codSummary: OrderCodSummary;

  currency: string;

  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;

  couponSnapshot: unknown | null;
  shippingProfileSnapshot: unknown | null;
  taxProfileSnapshot: unknown | null;
  pricesIncludeTax: boolean;
  shippingMethodId: string | null;
  shippingMethodCode: string | null;
  shippingMethodName: string | null;
  shippingRuleId: string | null;
  shippingDistanceKm: string | null;
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
