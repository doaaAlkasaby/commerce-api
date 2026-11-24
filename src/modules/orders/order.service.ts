import {
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import {
  validateOrderTransition,
  isFinanciallyCommitted,
} from '../../common/domain/status-transitions.js';
import { logger } from '../../common/logger/logger.js';
import { paymentService } from '../payments/payment.service.instance.js';
import {
  computeRefundAccountingDecimals,
  deriveAggregatePaymentStatusFromLedger,
} from '../payments/payment-refund.accounting.js';

import { AppError } from '../../common/errors/app-error.js';

import { mapOrder, mapOrders, parseCodMetadata } from './order.mapper.js';
import { prisma } from '../../config/database.js';
import { inventoryService } from '../inventory/inventory.service.instance.js';
import { orderNotificationService } from '../notifications/order-notification.service.js';
import type { OrderEventType } from '../notifications/order-notification.service.js';

import { orderIncludeRelations } from './order.repository.js';
import { orderRepository } from './order.repository.instance.js';

import type {
  ConfirmCodPaymentInput,
  ConfirmCodReturnInput,
  MarkCodRefusedInput,
  OrderListQuery,
  UpdateOrderStatusInput,
} from './order.types.js';

type LockedOrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof orderIncludeRelations;
}>;

const normalizeOptionalText = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergePaymentMetadata = (
  existing: Prisma.JsonValue | null,
  patch: Record<string, unknown>,
): Prisma.InputJsonObject =>
  ({
    ...(isPlainObject(existing) ? existing : {}),
    ...patch,
  }) as Prisma.InputJsonObject;

const isEligibleCodOrder = (order: {
  paymentStatus: PaymentStatus;
  payments: Array<{ method: string; provider: string; status: PaymentStatus }>;
}): boolean =>
  order.payments.length === 1 &&
  order.payments[0]!.method === 'CASH_ON_DELIVERY' &&
  order.payments[0]!.provider === 'NONE' &&
  order.payments[0]!.status === order.paymentStatus;

const getSingleCodPaymentOrThrow = (order: LockedOrderWithRelations) => {
  if (
    order.payments.length !== 1 ||
    order.payments[0]!.status !== order.paymentStatus
  ) {
    throw new AppError(
      'Legacy order/payment state requires reconciliation',
      409,
      'PAYMENT_RECONCILIATION_REQUIRED',
    );
  }
  const payment = order.payments[0]!;
  if (payment.method !== 'CASH_ON_DELIVERY' || payment.provider !== 'NONE') {
    throw new AppError(
      'Order payment method is not Cash on Delivery',
      409,
      'PAYMENT_METHOD_NOT_COD',
    );
  }
  return payment;
};

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

    return mapOrders(result.orders, query.page, query.limit, result.totalItems, {
      audience: 'customer',
    });
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

    return mapOrder(order, { audience: 'customer' });
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
    actorUserId?: string,
  ) {
    const order = await prisma.$transaction((tx) =>
      this.applyStatusWithClient(
        tenantId,
        orderId,
        input.status,
        tx,
        false,
        actorUserId,
      ),
    );
    return mapOrder(order);
  }

  async applyStatusWithClient(
    tenantId: string,
    orderId: string,
    status: OrderStatus,
    tx: Prisma.TransactionClient,
    requirePending = false,
    actorUserId?: string,
    reason?: string,
  ) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "id"=${orderId} AND "tenantId"=${tenantId} FOR UPDATE
    `;
    if (!locked.length)
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    const order = await tx.order.findFirstOrThrow({
      where: { id: orderId, tenantId },
      include: orderIncludeRelations,
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
    const eligibleCod = isEligibleCodOrder(order);
    const allowProcessingCancellation =
      eligibleCod &&
      order.status === 'PROCESSING' &&
      order.paymentStatus === 'PENDING';

    validateOrderTransition(order.status, status, {
      allowProcessingCancellation,
    });
    if (
      order.payments.length !== 1 ||
      order.payments[0]!.status !== order.paymentStatus
    )
      throw new AppError(
        'Legacy order/payment state requires reconciliation',
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
      );
    const { codReturn } = parseCodMetadata(order.payments[0]!.metadata);
    let updatedOrder: LockedOrderWithRelations;
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
            {
              transition: { kind: 'ORDER_LIFECYCLE' },
              ...(allowProcessingCancellation
                ? { allowCodFulfillmentCancellation: true }
                : {}),
            },
          );
      }
      await inventoryService.releaseOrderReservation(tenantId, orderId, tx);
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: status,
          changedByUserId: actorUserId ?? null,
          reason:
            normalizeOptionalText(reason) ??
            (requirePending ? 'ORDER_EXPIRED' : null),
        },
      });
      updatedOrder = await tx.order.update({
        where: { id: orderId, tenantId },
        data: { status },
        include: orderIncludeRelations,
      });
    } else {
      if (['FAILED', 'CANCELLED'].includes(order.paymentStatus))
        throw new AppError(
          'Order reservation has ended',
          409,
          'ORDER_INVENTORY_RESERVATION_RELEASED',
        );
      if (
        status === 'DELIVERED' &&
        codReturn?.state === 'REFUSED_WITH_COURIER'
      ) {
        throw new AppError(
          'Cannot mark a refused COD delivery as delivered; confirm warehouse return instead',
          409,
          'COD_DELIVERY_REFUSED_AWAITING_RETURN',
        );
      }
      if (eligibleCod) {
        if (
          status === 'COMPLETED' &&
          order.paymentStatus !== PaymentStatus.PAID
        ) {
          throw new AppError(
            'COD cash collection must be confirmed before completing the order',
            409,
            'COD_PAYMENT_CONFIRMATION_REQUIRED',
          );
        }
        if (
          ['PROCESSING', 'SHIPPED', 'DELIVERED'].includes(status) &&
          order.paymentStatus !== PaymentStatus.PENDING &&
          order.paymentStatus !== PaymentStatus.PAID
        ) {
          throw new AppError(
            'Payment must be pending or paid for COD fulfillment',
            409,
            'PAYMENT_NOT_READY',
          );
        }
      } else if (
        ['PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(status)
      ) {
        const solePayment = order.payments[0]!;
        if (solePayment.reconciliationRequired) {
          throw new AppError(
            'Payment reconciliation must be resolved before fulfillment',
            409,
            'PAYMENT_RECONCILIATION_REQUIRED',
          );
        }

        const refunds = await tx.paymentRefund.findMany({
          where: {
            tenantId,
            orderId: order.id,
            paymentId: solePayment.id,
          },
        });

        const isRefundAggregateStatus =
          order.paymentStatus === PaymentStatus.REFUND_PENDING ||
          order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
          order.paymentStatus === PaymentStatus.REFUNDED;

        if (isRefundAggregateStatus && refunds.length === 0) {
          throw new AppError(
            'Refund status lacks backing ledger records and requires reconciliation',
            409,
            'PAYMENT_RECONCILIATION_REQUIRED',
          );
        }

        if (refunds.length > 0) {
          const accounting = computeRefundAccountingDecimals(
            solePayment,
            refunds,
          );
          const expectedAggregateStatus =
            deriveAggregatePaymentStatusFromLedger(accounting);
          if (expectedAggregateStatus !== order.paymentStatus) {
            throw new AppError(
              'Order payment status contradicts refund ledger and requires reconciliation',
              409,
              'PAYMENT_RECONCILIATION_REQUIRED',
            );
          }
          if (
            refunds.some(
              (r) => r.status === PaymentRefundStatus.RECONCILIATION_REQUIRED,
            )
          ) {
            throw new AppError(
              'Unresolved refund reconciliation blocks order fulfillment',
              409,
              'PAYMENT_RECONCILIATION_REQUIRED',
            );
          }
          if (accounting.reservedInFlightAmount.gt(0)) {
            throw new AppError(
              'Unresolved in-flight refund blocks order fulfillment',
              409,
              'PAYMENT_NOT_READY',
            );
          }
          if (
            order.paymentStatus === PaymentStatus.REFUNDED ||
            accounting.remainingRefundableAmount.lte(0)
          ) {
            throw new AppError(
              'Fully refunded payment blocks further order fulfillment',
              409,
              'PAYMENT_NOT_READY',
            );
          }
          const isPreShipment =
            status === OrderStatus.PROCESSING || status === OrderStatus.SHIPPED;
          if (
            isPreShipment &&
            (order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
              accounting.settledRefundedAmount.gt(0))
          ) {
            throw new AppError(
              'Settled partial refunds block pre-shipment fulfillment by default',
              409,
              'PAYMENT_NOT_READY',
            );
          }
        } else if (
          order.paymentStatus !== PaymentStatus.PAID &&
          order.paymentStatus !== PaymentStatus.AUTHORIZED
        ) {
          throw new AppError(
            'Payment must be authorized or paid for fulfillment',
            409,
            'PAYMENT_NOT_READY',
          );
        }
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: status,
          changedByUserId: actorUserId ?? null,
          reason: normalizeOptionalText(reason),
        },
      });
      updatedOrder = await tx.order.update({
        where: { id: orderId, tenantId },
        data: { status },
        include: orderIncludeRelations,
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

  async confirmCodPayment(
    tenantId: string,
    orderId: string,
    actorUserId: string,
    input: ConfirmCodPaymentInput,
  ) {
    const referenceId = input.referenceId.trim();
    const currency = input.currency.trim();
    const note = normalizeOptionalText(input.note);
    const collectedDecimal = new Prisma.Decimal(input.collectedAmount.trim());

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "id"=${orderId} AND "tenantId"=${tenantId} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
      }

      const order = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: orderIncludeRelations,
      });

      const payment = getSingleCodPaymentOrThrow(order);
      const { codCollection, codReturn } = parseCodMetadata(payment.metadata);

      if (payment.status === PaymentStatus.PAID) {
        if (codCollection) {
          const sameReference = codCollection.referenceId === referenceId;
          const sameAmount = new Prisma.Decimal(
            codCollection.collectedAmount,
          ).equals(collectedDecimal);
          const sameCurrency = codCollection.currency === currency;
          const sameNote = normalizeOptionalText(codCollection.note) === note;

          if (sameReference && sameAmount && sameCurrency && sameNote) {
            return { order, replayed: true };
          }
          if (sameReference) {
            throw new AppError(
              'COD payment confirmation referenceId was already used with different details',
              409,
              'IDEMPOTENCY_KEY_REUSED',
            );
          }
          throw new AppError(
            'COD payment has already been confirmed with a different referenceId',
            409,
            'COD_PAYMENT_ALREADY_CONFIRMED',
          );
        }
        throw new AppError(
          'Order payment is already paid',
          409,
          'PAYMENT_ALREADY_PAID',
        );
      }

      if (
        order.status === OrderStatus.CANCELLED ||
        payment.status === PaymentStatus.CANCELLED ||
        payment.status === PaymentStatus.FAILED
      ) {
        throw new AppError(
          'Cannot confirm COD payment for a cancelled or failed order',
          409,
          'ORDER_CANCELLED',
        );
      }

      if (
        codReturn?.state === 'REFUSED_WITH_COURIER' ||
        codReturn?.state === 'RETURNED_TO_WAREHOUSE'
      ) {
        throw new AppError(
          'Cannot confirm COD payment for a refused or returned delivery',
          409,
          'COD_DELIVERY_REFUSED_AWAITING_RETURN',
        );
      }

      if (order.status !== OrderStatus.DELIVERED) {
        throw new AppError(
          'COD cash collection can only be confirmed when the order is DELIVERED',
          409,
          'ORDER_NOT_READY_FOR_COD_COLLECTION',
        );
      }

      if (payment.status !== PaymentStatus.PENDING) {
        throw new AppError(
          'COD payment must be PENDING to confirm cash collection',
          409,
          'INVALID_PAYMENT_STATUS_TRANSITION',
        );
      }

      if (currency !== order.currency || currency !== payment.currency) {
        throw new AppError(
          'Collected currency does not match order currency',
          409,
          'PAYMENT_CURRENCY_MISMATCH',
        );
      }

      if (
        !collectedDecimal.equals(order.totalAmount) ||
        !collectedDecimal.equals(payment.amount)
      ) {
        throw new AppError(
          'Collected amount does not match order total',
          409,
          'PAYMENT_AMOUNT_MISMATCH',
        );
      }

      const collectedAt = new Date().toISOString();
      const nextMetadata = mergePaymentMetadata(payment.metadata, {
        codCollection: {
          referenceId,
          collectedAmount: order.totalAmount.toString(),
          currency,
          collectedByUserId: actorUserId,
          collectedAt,
          note,
        },
      });

      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: PaymentStatus.PAID,
          metadata: nextMetadata,
        },
        tx,
        {
          transition: {
            kind: 'COD_CONFIRMATION',
            referenceId,
            actorUserId,
          },
        },
      );

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: order.status,
          changedByUserId: actorUserId,
          reason: note
            ? `COD_PAYMENT_CONFIRMED:${referenceId} (${note})`
            : `COD_PAYMENT_CONFIRMED:${referenceId}`,
        },
      });

      const updatedOrder = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: orderIncludeRelations,
      });

      return { order: updatedOrder, replayed: false };
    });

    logger.info(
      {
        operation: 'cod_confirm_payment',
        tenantId,
        orderId,
        actorUserId,
        referenceId,
        replayed: result.replayed,
      },
      'COD cash collection confirmation completed',
    );

    return mapOrder(result.order);
  }

  async markCodDeliveryRefused(
    tenantId: string,
    orderId: string,
    actorUserId: string,
    input: MarkCodRefusedInput,
  ) {
    const referenceId = input.referenceId.trim();
    const reason = input.reason.trim();
    const courierReference = normalizeOptionalText(input.courierReference);

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "id"=${orderId} AND "tenantId"=${tenantId} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
      }

      const order = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: orderIncludeRelations,
      });

      const payment = getSingleCodPaymentOrThrow(order);
      const { codReturn } = parseCodMetadata(payment.metadata);

      if (codReturn?.state === 'REFUSED_WITH_COURIER') {
        const sameReference = codReturn.refusalReferenceId === referenceId;
        const sameReason = codReturn.reason === reason;
        const sameCourierRef =
          normalizeOptionalText(codReturn.courierReference) ===
          courierReference;

        if (sameReference && sameReason && sameCourierRef) {
          return { order, replayed: true };
        }
        if (sameReference) {
          throw new AppError(
            'COD delivery refusal referenceId was already used with different details',
            409,
            'IDEMPOTENCY_KEY_REUSED',
          );
        }
        throw new AppError(
          'COD delivery refusal has already been recorded with a different referenceId',
          409,
          'COD_DELIVERY_ALREADY_REFUSED',
        );
      }

      if (codReturn?.state === 'RETURNED_TO_WAREHOUSE') {
        throw new AppError(
          'COD delivery has already been returned to warehouse',
          409,
          'COD_RETURN_ALREADY_CONFIRMED',
        );
      }

      if (
        order.status === OrderStatus.CANCELLED ||
        payment.status === PaymentStatus.CANCELLED ||
        payment.status === PaymentStatus.FAILED
      ) {
        throw new AppError(
          'Cannot mark a cancelled order as refused',
          409,
          'ORDER_CANCELLED',
        );
      }

      if (
        order.status !== OrderStatus.SHIPPED ||
        payment.status !== PaymentStatus.PENDING
      ) {
        throw new AppError(
          'COD delivery can only be marked refused while order is SHIPPED and payment is PENDING',
          409,
          'ORDER_NOT_REFUSABLE',
        );
      }

      const refusedAt = new Date().toISOString();
      const nextMetadata = mergePaymentMetadata(payment.metadata, {
        codReturn: {
          state: 'REFUSED_WITH_COURIER',
          refusalReferenceId: referenceId,
          refusedByUserId: actorUserId,
          refusedAt,
          reason,
          courierReference,
          returnReferenceId: null,
          returnedByUserId: null,
          returnedAt: null,
          warehouseId: null,
          receivedCondition: null,
          returnNote: null,
        },
      });

      await tx.payment.update({
        where: { id: payment.id, order: { tenantId } },
        data: { metadata: nextMetadata },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: order.status,
          changedByUserId: actorUserId,
          reason: courierReference
            ? `COD_DELIVERY_REFUSED:${referenceId} (${reason}; courierRef=${courierReference})`
            : `COD_DELIVERY_REFUSED:${referenceId} (${reason})`,
        },
      });

      const updatedOrder = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: orderIncludeRelations,
      });

      return { order: updatedOrder, replayed: false };
    });

    logger.info(
      {
        operation: 'cod_mark_refused',
        tenantId,
        orderId,
        actorUserId,
        referenceId,
        replayed: result.replayed,
      },
      'COD delivery marked refused while parcel remains with courier',
    );

    return mapOrder(result.order);
  }

  async confirmCodWarehouseReturn(
    tenantId: string,
    orderId: string,
    actorUserId: string,
    input: ConfirmCodReturnInput,
  ) {
    const referenceId = input.referenceId.trim();
    const warehouseId = input.warehouseId.trim();
    const receivedCondition = input.receivedCondition;
    const note = input.note.trim();

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "id"=${orderId} AND "tenantId"=${tenantId} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
      }

      const order = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: orderIncludeRelations,
      });

      const payment = getSingleCodPaymentOrThrow(order);
      const { codReturn } = parseCodMetadata(payment.metadata);

      if (
        codReturn?.state === 'RETURNED_TO_WAREHOUSE' &&
        order.status === OrderStatus.CANCELLED
      ) {
        const sameReference = codReturn.returnReferenceId === referenceId;
        const sameWarehouse = codReturn.warehouseId === warehouseId;
        const sameCondition =
          codReturn.receivedCondition === receivedCondition;
        const sameNote = normalizeOptionalText(codReturn.returnNote) === note;

        if (sameReference && sameWarehouse && sameCondition && sameNote) {
          return { order, replayed: true };
        }
        if (sameReference) {
          throw new AppError(
            'COD warehouse return referenceId was already used with different details',
            409,
            'IDEMPOTENCY_KEY_REUSED',
          );
        }
        throw new AppError(
          'COD warehouse return has already been confirmed with a different referenceId',
          409,
          'COD_RETURN_ALREADY_CONFIRMED',
        );
      }

      if (
        isFinanciallyCommitted(order.paymentStatus) ||
        isFinanciallyCommitted(payment.status)
      ) {
        throw new AppError(
          'Paid orders require a refund workflow before cancellation',
          409,
          'PAID_ORDER_CANCELLATION_REQUIRES_REFUND',
        );
      }

      if (
        order.status === OrderStatus.CANCELLED ||
        payment.status === PaymentStatus.CANCELLED ||
        payment.status === PaymentStatus.FAILED
      ) {
        throw new AppError(
          'Order is already cancelled',
          409,
          'ORDER_CANCELLED',
        );
      }

      if (
        order.status !== OrderStatus.SHIPPED ||
        payment.status !== PaymentStatus.PENDING ||
        codReturn?.state !== 'REFUSED_WITH_COURIER'
      ) {
        throw new AppError(
          'COD warehouse return requires a SHIPPED unpaid order marked as REFUSED_WITH_COURIER',
          409,
          'COD_RETURN_REQUIRES_REFUSAL',
        );
      }

      const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, tenantId },
        select: { id: true },
      });
      if (!warehouse) {
        throw new AppError(
          'Warehouse not found for tenant',
          404,
          'WAREHOUSE_NOT_FOUND',
        );
      }

      if (order.warehouseId && order.warehouseId !== warehouseId) {
        throw new AppError(
          'Return warehouse does not match order fulfillment warehouse',
          409,
          'RETURN_WAREHOUSE_MISMATCH',
        );
      }

      const returnedAt = new Date().toISOString();
      const nextMetadata = mergePaymentMetadata(payment.metadata, {
        codReturn: {
          ...codReturn,
          state: 'RETURNED_TO_WAREHOUSE',
          returnReferenceId: referenceId,
          returnedByUserId: actorUserId,
          returnedAt,
          warehouseId,
          receivedCondition,
          returnNote: note,
        },
      });

      await paymentService.applyPaymentStatusWithClient(
        tenantId,
        payment.id,
        {
          status: PaymentStatus.CANCELLED,
          metadata: nextMetadata,
        },
        tx,
        {
          transition: { kind: 'ORDER_LIFECYCLE' },
          allowCodFulfillmentCancellation: true,
          skipInventorySideEffects: true,
        },
      );

      if (receivedCondition === 'RESELLABLE') {
        await inventoryService.releaseOrderReservation(tenantId, orderId, tx);
      } else {
        await inventoryService.releaseOrderReservationAsDamaged(
          tenantId,
          orderId,
          tx,
          note,
        );
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: OrderStatus.CANCELLED,
          changedByUserId: actorUserId,
          reason: `COD_RETURN_CONFIRMED:${referenceId} (${receivedCondition}; warehouse=${warehouseId}; ${note})`,
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId, tenantId },
        data: { status: OrderStatus.CANCELLED },
        include: orderIncludeRelations,
      });

      await orderNotificationService.createOrderNotification({
        eventType: 'ORDER_CANCELLED',
        orderId: updatedOrder.id,
        expectedTenantId: tenantId,
        tx,
      });

      return { order: updatedOrder, replayed: false };
    });

    logger.info(
      {
        operation: 'cod_confirm_return',
        tenantId,
        orderId,
        actorUserId,
        referenceId,
        warehouseId,
        receivedCondition,
        replayed: result.replayed,
      },
      'COD warehouse return confirmation completed',
    );

    return mapOrder(result.order);
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
