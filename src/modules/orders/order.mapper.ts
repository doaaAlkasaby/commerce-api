import type {
  Order,
  OrderItem,
  OrderStatusHistory,
  Payment,
  Prisma,
} from '../../generated/prisma/client.js';

import type {
  CodCollectionStatus,
  CodReceivedCondition,
  OrderCodCollectionSummary,
  OrderCodReturnSummary,
  OrderCodSummary,
  OrderItemResponse,
  OrderPaymentResponse,
  OrderResponse,
  PaginatedOrdersResponse,
} from './order.types.js';

type OrderWithRelations = Order & {
  items: OrderItem[];
  payments: Payment[];
  statusHistory?: OrderStatusHistory[];
};

export interface MapOrderOptions {
  audience?: 'merchant' | 'customer';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const asOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const asReceivedCondition = (value: unknown): CodReceivedCondition | null =>
  value === 'RESELLABLE' || value === 'DAMAGED' ? value : null;

export const parseCodMetadata = (
  metadata: Prisma.JsonValue | null | undefined,
): {
  codCollection: OrderCodCollectionSummary | null;
  codReturn: OrderCodReturnSummary | null;
} => {
  if (!isRecord(metadata)) {
    return { codCollection: null, codReturn: null };
  }

  let codCollection: OrderCodCollectionSummary | null = null;
  const rawCollection = metadata.codCollection;
  if (isRecord(rawCollection)) {
    const referenceId = asNonEmptyString(rawCollection.referenceId);
    const collectedAmount = asNonEmptyString(rawCollection.collectedAmount);
    const currency = asNonEmptyString(rawCollection.currency);
    const collectedByUserId = asNonEmptyString(rawCollection.collectedByUserId);
    const collectedAt = asNonEmptyString(rawCollection.collectedAt);

    if (
      referenceId &&
      collectedAmount &&
      currency &&
      collectedByUserId &&
      collectedAt
    ) {
      codCollection = {
        referenceId,
        collectedAmount,
        currency,
        collectedByUserId,
        collectedAt,
        note: asOptionalString(rawCollection.note),
      };
    }
  }

  let codReturn: OrderCodReturnSummary | null = null;
  const rawReturn = metadata.codReturn;
  if (isRecord(rawReturn)) {
    const state =
      rawReturn.state === 'REFUSED_WITH_COURIER' ||
      rawReturn.state === 'RETURNED_TO_WAREHOUSE'
        ? rawReturn.state
        : null;
    const refusalReferenceId = asNonEmptyString(rawReturn.refusalReferenceId);
    const refusedByUserId = asNonEmptyString(rawReturn.refusedByUserId);
    const refusedAt = asNonEmptyString(rawReturn.refusedAt);
    const reason = asNonEmptyString(rawReturn.reason);

    if (state && refusalReferenceId && refusedByUserId && refusedAt && reason) {
      codReturn = {
        state,
        refusalReferenceId,
        refusedByUserId,
        refusedAt,
        reason,
        courierReference: asOptionalString(rawReturn.courierReference),
        returnReferenceId: asNonEmptyString(rawReturn.returnReferenceId),
        returnedByUserId: asNonEmptyString(rawReturn.returnedByUserId),
        returnedAt: asNonEmptyString(rawReturn.returnedAt),
        warehouseId: asNonEmptyString(rawReturn.warehouseId),
        receivedCondition: asReceivedCondition(rawReturn.receivedCondition),
        returnNote: asOptionalString(rawReturn.returnNote),
      };
    }
  }

  return { codCollection, codReturn };
};

const findDeliveredTransitionAt = (
  statusHistory?: OrderStatusHistory[],
): Date | null => {
  if (!statusHistory || statusHistory.length === 0) {
    return null;
  }

  let deliveredTransition: OrderStatusHistory | null = null;
  for (const entry of statusHistory) {
    if (entry.toStatus === 'DELIVERED' && entry.fromStatus !== 'DELIVERED') {
      deliveredTransition = entry;
    }
  }
  if (deliveredTransition) {
    return deliveredTransition.createdAt;
  }

  for (const entry of statusHistory) {
    if (entry.toStatus === 'DELIVERED') {
      deliveredTransition = entry;
    }
  }
  return deliveredTransition?.createdAt ?? null;
};

const buildCodSummary = (
  order: OrderWithRelations,
  audience: 'merchant' | 'customer',
): OrderCodSummary => {
  const solePayment = order.payments.length === 1 ? order.payments[0]! : null;
  const isCod =
    solePayment !== null &&
    solePayment.method === 'CASH_ON_DELIVERY' &&
    solePayment.provider === 'NONE';

  const { codCollection, codReturn } = solePayment
    ? parseCodMetadata(solePayment.metadata)
    : { codCollection: null, codReturn: null };

  const deliveredDate = findDeliveredTransitionAt(order.statusHistory);
  const deliveredAt = deliveredDate ? deliveredDate.toISOString() : null;

  let collectionStatus: CodCollectionStatus = 'NOT_APPLICABLE';
  if (isCod) {
    if (order.paymentStatus === 'PAID') {
      collectionStatus = 'COLLECTED';
    } else if (codReturn?.state === 'RETURNED_TO_WAREHOUSE') {
      collectionStatus = 'RETURNED_TO_WAREHOUSE';
    } else if (
      order.status === 'CANCELLED' ||
      order.paymentStatus === 'CANCELLED' ||
      order.paymentStatus === 'FAILED'
    ) {
      collectionStatus = 'CANCELLED';
    } else if (codReturn?.state === 'REFUSED_WITH_COURIER') {
      collectionStatus = 'REFUSED_WITH_COURIER';
    } else if (
      order.status === 'DELIVERED' &&
      order.paymentStatus === 'PENDING'
    ) {
      collectionStatus = 'AWAITING_COLLECTION';
    } else {
      collectionStatus = 'AWAITING_DELIVERY';
    }
  }

  const isMerchant = audience === 'merchant';
  const unpaidDeliveredAgeHours =
    isMerchant &&
    isCod &&
    order.status === 'DELIVERED' &&
    order.paymentStatus === 'PENDING' &&
    deliveredDate !== null
      ? Math.max(
          0,
          Number(
            ((Date.now() - deliveredDate.getTime()) / 3_600_000).toFixed(2),
          ),
        )
      : null;

  const canConfirmPayment =
    isMerchant &&
    isCod &&
    order.status === 'DELIVERED' &&
    order.paymentStatus === 'PENDING' &&
    solePayment.status === 'PENDING' &&
    codReturn === null;

  const canMarkRefused =
    isMerchant &&
    isCod &&
    order.status === 'SHIPPED' &&
    order.paymentStatus === 'PENDING' &&
    solePayment.status === 'PENDING' &&
    codReturn === null;

  const canConfirmReturn =
    isMerchant &&
    isCod &&
    order.status === 'SHIPPED' &&
    order.paymentStatus === 'PENDING' &&
    solePayment.status === 'PENDING' &&
    codReturn?.state === 'REFUSED_WITH_COURIER';

  return {
    isCod,
    collectionStatus,
    canConfirmPayment,
    canMarkRefused,
    canConfirmReturn,
    deliveredAt,
    unpaidDeliveredAgeHours,
    collection: isMerchant ? codCollection : null,
    returnInfo: isMerchant ? codReturn : null,
  };
};

const mapOrderItem = (item: OrderItem): OrderItemResponse => ({
  id: item.id,

  productId: item.productId,
  variantId: item.variantId,

  productName: item.productName,
  sku: item.sku,

  quantity: item.quantity,

  unitPrice: item.unitPrice.toString(),

  itemDiscountAmount: item.itemDiscountAmount.toString(),

  finalUnitPrice: item.finalUnitPrice.toString(),

  totalPrice: item.totalPrice.toString(),

  taxCategoryCode: item.taxCategoryCode,
  taxCategoryId: item.taxCategoryId,
  taxRuleId: item.taxRuleId,
  taxTreatment: item.taxTreatment,
  taxRate: item.taxRate?.toString() ?? null,
  taxableAmount: item.taxableAmount.toString(),
  taxAmount: item.taxAmount.toString(),
  variantSnapshot: item.variantSnapshot as OrderItemResponse['variantSnapshot'],

  createdAt: item.createdAt.toISOString(),
});

const mapPayment = (payment: Payment): OrderPaymentResponse => ({
  id: payment.id,

  provider: payment.provider,

  method: payment.method,

  status: payment.status,

  amount: payment.amount.toString(),

  currency: payment.currency,

  providerPaymentId: payment.providerPaymentId,

  providerTransactionId: payment.providerTransactionId,

  failureCode: payment.failureCode,

  failureMessage: payment.failureMessage,

  createdAt: payment.createdAt.toISOString(),

  updatedAt: payment.updatedAt.toISOString(),
});

export const mapOrder = (
  order: OrderWithRelations,
  options?: MapOrderOptions,
): OrderResponse => {
  const audience = options?.audience ?? 'merchant';

  return {
    warehouseId: order.warehouseId,
    fulfillmentSnapshot: order.fulfillmentSnapshot,
    id: order.id,

    orderNumber: order.orderNumber,

    userId: order.userId,

    status: order.status,

    paymentStatus: order.paymentStatus,
    paymentMethod: order.payments[0]?.method ?? null,
    codSummary: buildCodSummary(order, audience),

    currency: order.currency,

    subtotal: order.subtotal.toString(),

    discountAmount: order.discountAmount.toString(),

    shippingAmount: order.shippingAmount.toString(),

    taxAmount: order.taxAmount.toString(),

    totalAmount: order.totalAmount.toString(),

    couponSnapshot: order.couponSnapshot,
    shippingProfileSnapshot: order.shippingProfileSnapshot,
    taxProfileSnapshot: order.taxProfileSnapshot,
    pricesIncludeTax: order.pricesIncludeTax,
    shippingMethodId: order.shippingMethodId,
    shippingMethodCode: order.shippingMethodCode,
    shippingMethodName: order.shippingMethodName,
    shippingRuleId: order.shippingRuleId,
    shippingDistanceKm: order.shippingDistanceKm?.toString() ?? null,
    shippingAddress: order.shippingAddress,

    billingAddress: order.billingAddress,

    items: order.items.map(mapOrderItem),

    payments: order.payments.map(mapPayment),

    itemCount: order.items.reduce((total, item) => total + item.quantity, 0),

    createdAt: order.createdAt.toISOString(),

    updatedAt: order.updatedAt.toISOString(),
  };
};

export const mapOrders = (
  orders: OrderWithRelations[],
  page: number,
  limit: number,
  totalItems: number,
  options?: MapOrderOptions,
): PaginatedOrdersResponse => {
  return {
    items: orders.map((order) => mapOrder(order, options)),

    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };
};
