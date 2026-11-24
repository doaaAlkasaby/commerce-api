import { logger } from '../../common/logger/logger.js';
import { observePayment, metrics } from '../../common/observability/metrics.js';
import { validateAmount } from '../../common/pricing/money.js';
import {
  validatePaymentTransition,
  isFinanciallyCommitted,
} from '../../common/domain/status-transitions.js';
import {
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';

import { prisma } from '../../config/database.js';

import { AppError } from '../../common/errors/app-error.js';

import { paymentRepository } from './payment.repository.instance.js';
import { inventoryService } from '../inventory/inventory.service.instance.js';
import { paymentNotificationService } from '../notifications/payment-notification.service.js';
import type { PaymentEventType } from '../notifications/payment-notification.service.js';

import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';
import {
  computeRefundAccountingDecimals,
  deriveAggregatePaymentStatusFromLedger,
} from './payment-refund.accounting.js';

import type {
  ApplyPaymentStatusOptions,
  CreatePaymentInput,
  PaymentFilterInput,
  TrustedPaymentTransition,
  UpdatePaymentStatusInput,
} from './payment.types.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export class PaymentService {
  constructor(
    private readonly repository = paymentRepository,

    private readonly providerRegistry = new PaymentProviderRegistry(),
  ) {}

  async createPayment(tenantId: string, input: CreatePaymentInput) {
    const order = await prisma.order.findFirst({
      where: {
        id: input.orderId,
        tenantId,
      },
    });

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    if (order.status === 'CANCELLED') {
      throw new AppError(
        'Cannot create payment for a cancelled order',
        400,
        'ORDER_CANCELLED',
      );
    }

    if (order.status === 'COMPLETED') {
      throw new AppError(
        'Cannot create payment for a completed order',
        400,
        'ORDER_COMPLETED',
      );
    }

    if (
      order.paymentStatus === PaymentStatus.FAILED ||
      order.paymentStatus === PaymentStatus.CANCELLED
    ) {
      throw new AppError(
        'This order payment ended and its inventory reservation is no longer active',
        409,
        'ORDER_INVENTORY_RESERVATION_RELEASED',
      );
    }

    if (input.currency !== order.currency) {
      throw new AppError(
        'Payment currency does not match order currency',
        400,
        'PAYMENT_CURRENCY_MISMATCH',
      );
    }

    const orderTotal = new Prisma.Decimal(order.totalAmount);

    const paymentAmount = new Prisma.Decimal(input.amount);

    if (!paymentAmount.equals(orderTotal)) {
      throw new AppError(
        'Payment amount does not match order total',
        400,
        'PAYMENT_AMOUNT_MISMATCH',
      );
    }

    // Compatibility entry point: initiate the checkout-created payment, never
    // create another local payment from client-supplied money or method fields.
    const payment = await this.repository.findMany(tenantId, {
      orderId: order.id,
    });
    const original = payment.at(-1);
    if (!original)
      throw new AppError(
        'Checkout payment not found',
        404,
        'PAYMENT_NOT_FOUND',
      );
    if (
      original.method !== input.method ||
      original.provider !== input.provider
    ) {
      throw new AppError(
        'Payment configuration does not match checkout',
        400,
        'PAYMENT_CONFIGURATION_MISMATCH',
      );
    }
    return this.initiatePayment(tenantId, order.userId, original.id);
  }

  async getPaymentForUser(tenantId: string, userId: string, paymentId: string) {
    const payment = await this.repository.findForUser(
      tenantId,
      userId,
      paymentId,
    );
    if (!payment)
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    return payment;
  }

  async getOrderPaymentsForUser(
    tenantId: string,
    userId: string,
    orderId: string,
  ) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, userId },
      select: { id: true },
    });
    if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    return this.repository.findMany(tenantId, { orderId });
  }

  async initiatePayment(
    tenantId: string,
    userId: string,
    paymentId: string,
    guard?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    return observePayment(
      'initiation',
      async () => {
        const result = await this.initiatePaymentObserved(
          tenantId,
          userId,
          paymentId,
          guard,
        );
        logger.info(
          {
            operation: 'initiation',
            tenantId,
            paymentId,
            outcome: result.initiationState,
          },
          'Payment initiation observed',
        );
        metrics.payment(
          'initiation',
          result.initiationState === 'UNKNOWN' ? 'unknown' : 'success',
        );
        return result;
      },
      { tenantId, paymentId },
    );
  }

  private async initiatePaymentObserved(
    tenantId: string,
    userId: string,
    paymentId: string,
    guard?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const claim = await prisma.$transaction(async (tx) => {
      await this.repository.lockOrderForUser(tx, tenantId, userId, paymentId);
      await guard?.(tx);
      const payment = await this.repository.findForUser(
        tenantId,
        userId,
        paymentId,
        tx,
      );
      if (!payment)
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      if (payment.initiationState === 'INITIATED')
        return { payment, adapter: null };
      if (payment.initiationState === 'IN_PROGRESS') {
        throw new AppError(
          'Payment initiation is in progress; retrieve status before retrying',
          409,
          'PAYMENT_INITIATION_IN_PROGRESS',
        );
      }
      const order = payment.order;
      if (
        payment.status !== PaymentStatus.PENDING ||
        order.status === 'CANCELLED' ||
        order.status === 'COMPLETED' ||
        order.paymentStatus === PaymentStatus.FAILED ||
        order.paymentStatus === PaymentStatus.CANCELLED ||
        order.paymentStatus === PaymentStatus.PAID
      ) {
        throw new AppError(
          'Payment cannot be initiated in its current state',
          409,
          'PAYMENT_NOT_INITIABLE',
        );
      }
      if (
        !payment.amount.equals(order.totalAmount) ||
        payment.currency !== order.currency
      ) {
        throw new AppError(
          'Local payment does not match the persisted order',
          409,
          'PAYMENT_ORDER_MISMATCH',
        );
      }
      const provider = this.providerRegistry.resolveProviderForMethod(
        payment.method,
      );
      if (provider !== payment.provider)
        throw new AppError(
          'Payment provider does not match checkout',
          409,
          'PAYMENT_CONFIGURATION_MISMATCH',
        );
      const adapter = this.providerRegistry.getProvider(provider);
      if (
        payment.initiationState === 'UNKNOWN' &&
        !adapter.supportsIdempotentInitiation
      ) {
        throw new AppError(
          'Payment outcome requires provider reconciliation before another initiation',
          409,
          'PAYMENT_RECONCILIATION_REQUIRED',
        );
      }
      validateAmount(order.totalAmount.toString(), order.currency);
      adapter.validatePayment?.({
        amount: order.totalAmount.toString(),
        currency: order.currency,
      });
      await this.repository.setInitiationState(
        tx,
        tenantId,
        userId,
        paymentId,
        'IN_PROGRESS',
      );
      return { payment, adapter };
    });
    if (!claim.adapter) return claim.payment;

    // This call is deliberately outside every Prisma transaction. The short
    // claim above has committed, as has the original checkout transaction.
    try {
      const result = await claim.adapter.createPayment({
        idempotencyKey: `payment:${paymentId}`,
        paymentId,
        orderId: claim.payment.orderId,
        amount: claim.payment.order.totalAmount.toString(),
        currency: claim.payment.order.currency,
        method: claim.payment.method,
        metadata: claim.payment.metadata as Record<string, unknown> | null,
      });
      const supported: PaymentStatus[] = [
        PaymentStatus.PENDING,
        PaymentStatus.REQUIRES_ACTION,
        PaymentStatus.AUTHORIZED,
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
      ];
      if (!supported.includes(result.status))
        throw new Error('Unsupported provider initiation result');
      return await prisma.$transaction(async (tx) => {
        await this.repository.lockOrderForUser(tx, tenantId, userId, paymentId);
        await guard?.(tx);
        const current = await this.repository.findForUser(
          tenantId,
          userId,
          paymentId,
          tx,
        );
        if (current?.provider === 'MYFATOORAH' && result.providerPaymentId) {
          await this.repository.bindMyFatoorahInvoice(
            tx,
            tenantId,
            paymentId,
            result.providerPaymentId,
          );
          if (
            current.initiationState === 'INITIATED' &&
            current.providerPaymentId === result.providerPaymentId &&
            !['PENDING', 'REQUIRES_ACTION'].includes(current.status)
          )
            return current;
        }
        await this.applyPaymentStatusWithClient(
          tenantId,
          paymentId,
          {
            status: result.status,
            ...(result.providerPaymentId === undefined
              ? {}
              : { providerPaymentId: result.providerPaymentId }),
            ...(result.providerTransactionId === undefined
              ? {}
              : { providerTransactionId: result.providerTransactionId }),
            ...(result.failureCode === undefined
              ? {}
              : { failureCode: result.failureCode }),
            ...(result.failureMessage === undefined
              ? {}
              : { failureMessage: result.failureMessage }),
            metadata: {
              ...(claim.payment.metadata as Record<string, unknown> | null),
              providerMetadata: result.metadata ?? null,
              ...(result.checkoutUrl === undefined
                ? {}
                : { checkoutUrl: result.checkoutUrl }),
              ...(result.clientSecret === undefined
                ? {}
                : { clientSecret: result.clientSecret }),
            },
          },
          tx,
          { transition: { kind: 'PROVIDER_INITIATION' } },
        );
        return this.repository.setInitiationState(
          tx,
          tenantId,
          userId,
          paymentId,
          'INITIATED',
        );
      });
    } catch (error) {
      // A transport error (or failure to persist a provider reply) is not proof
      // of payment failure. Keep reservation and committed checkout intact.
      const markedUnknown = await prisma.$transaction(async (tx) => {
        await this.repository.lockOrderForUser(tx, tenantId, userId, paymentId);
        await guard?.(tx);
        const payment = await this.repository.findForUser(
          tenantId,
          userId,
          paymentId,
          tx,
        );
        if (payment?.initiationState === 'IN_PROGRESS') {
          await this.repository.setInitiationState(
            tx,
            tenantId,
            userId,
            paymentId,
            'UNKNOWN',
          );
          if (payment.provider === 'MYFATOORAH') {
            const categories: Readonly<Record<string, string>> = {
              MYFATOORAH_REJECTED: 'INITIATION_REJECTED',
              MYFATOORAH_TIMEOUT: 'INITIATION_TIMEOUT',
              MYFATOORAH_AUTHENTICATION_FAILED:
                'INITIATION_AUTHENTICATION_FAILED',
              MYFATOORAH_INVALID_RESPONSE: 'INITIATION_INVALID_RESPONSE',
            };
            const category =
              error instanceof AppError
                ? (categories[error.code] ?? 'INITIATION_UNKNOWN')
                : 'INITIATION_UNKNOWN';
            await this.repository.recordInitiationFailure(
              tx,
              tenantId,
              payment.orderId,
              category,
            );
          }
          return true;
        }
        return false;
      });
      if (markedUnknown) {
        metrics.increment('commerce_payment_initiation_uncertain_total');
        logger.warn(
          { operation: 'initiation', outcome: 'unknown', tenantId, paymentId },
          'Payment initiation requires reconciliation',
        );
      }
      if (error instanceof AppError && error.code.startsWith('MYFATOORAH_'))
        throw error;
      throw new AppError(
        'Payment outcome is unknown; check status and retry only when safe',
        503,
        'PAYMENT_INITIATION_UNKNOWN',
      );
    }
  }

  async getPayment(tenantId: string, paymentId: string) {
    const payment = await this.repository.findById(tenantId, paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    return payment;
  }

  async getPaymentForOrder(
    tenantId: string,
    paymentId: string,
    orderId: string,
  ) {
    const payment = await this.repository.findByIdForOrder(
      tenantId,
      paymentId,
      orderId,
    );

    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    return payment;
  }

  async getPayments(tenantId: string, filters: PaymentFilterInput) {
    return this.repository.findMany(tenantId, filters);
  }

  async getOrderPayments(tenantId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        tenantId,
      },
    });

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    return this.repository.findMany(tenantId, {
      orderId,
    });
  }

  async updatePaymentStatusByMerchant(
    tenantId: string,
    paymentId: string,
    input: UpdatePaymentStatusInput,
  ) {
    return prisma.$transaction((tx) =>
      this.applyPaymentStatusWithClient(tenantId, paymentId, input, tx),
    );
  }

  /**
   * Fail-closed by default: direct calls without a trusted internal transition
   * are treated as manual merchant mutations and cannot mark payments PAID or
   * AUTHORIZED or tamper with COD metadata.
   */
  async updatePaymentStatus(
    tenantId: string,
    paymentId: string,
    input: UpdatePaymentStatusInput,
  ) {
    return prisma.$transaction((tx) =>
      this.applyPaymentStatusWithClient(tenantId, paymentId, input, tx),
    );
  }

  async applyTrustedPaymentStatus(
    tenantId: string,
    paymentId: string,
    input: UpdatePaymentStatusInput,
    transition: TrustedPaymentTransition,
    options?: Omit<ApplyPaymentStatusOptions, 'transition'>,
  ) {
    return prisma.$transaction((tx) =>
      this.applyPaymentStatusWithClient(tenantId, paymentId, input, tx, {
        ...options,
        transition,
      }),
    );
  }

  async applyPaymentStatusWithClient(
    tenantId: string,
    paymentId: string,
    input: UpdatePaymentStatusInput,
    tx: Prisma.TransactionClient,
    options?: ApplyPaymentStatusOptions,
  ) {
    const paymentIdentity = await tx.payment.findFirst({
      where: { id: paymentId, order: { tenantId } },
      select: { orderId: true },
    });
    if (!paymentIdentity) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order"
      WHERE "id" = ${paymentIdentity.orderId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (lockedOrders.length !== 1) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    const [payment, order] = await Promise.all([
      tx.payment.findFirst({
        where: { id: paymentId, order: { tenantId } },
      }),
      tx.order.findFirst({
        where: { id: paymentIdentity.orderId, tenantId },
        select: {
          id: true,
          userId: true,
          status: true,
          paymentStatus: true,
          totalAmount: true,
          warehouseId: true,
          currency: true,
        },
      }),
    ]);
    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }
    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    this.assertTransitionAuthorized(payment, order, input, options);
    this.validateRefundAmountInput(payment, input);
    let ledgerVerifiedRollbackToPaid = false;
    if (options?.transition?.kind === 'PAYMENT_REFUND') {
      ledgerVerifiedRollbackToPaid =
        await this.verifyRefundLedgerTransitionProof(
          tx,
          tenantId,
          payment,
          order,
          input,
          options.transition,
        );
    }

    // Already cancelled negative notifications are harmless, never resurrect state.
    if (payment.status === 'CANCELLED' && input.status === 'FAILED')
      return payment;
    const isTrustedRefundRollbackToPaid =
      ledgerVerifiedRollbackToPaid &&
      payment.status === PaymentStatus.REFUND_PENDING &&
      input.status === PaymentStatus.PAID;
    validatePaymentTransition(payment.status, input.status, {
      allowRefundPendingRollback:
        options?.allowRefundPendingRollback === true &&
        isTrustedRefundRollbackToPaid,
    });
    if (
      order.status === 'CANCELLED' &&
      ['PAID', 'AUTHORIZED', 'PENDING', 'REQUIRES_ACTION'].includes(
        input.status,
      )
    )
      throw new AppError(
        'Cancelled or expired order requires reconciliation for late payment',
        409,
        'ORDER_CANCELLED',
      );
    const siblings = await tx.payment.findMany({
      where: { orderId: order.id, order: { tenantId } },
    });
    if (siblings.length !== 1 || order.paymentStatus !== payment.status)
      throw new AppError(
        'Legacy payment/order state requires reconciliation',
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
      );
    if (
      ['PAID', 'AUTHORIZED'].includes(input.status) &&
      (!payment.amount.equals(order.totalAmount) ||
        payment.currency !== order.currency)
    )
      throw new AppError(
        'Payment money does not match order',
        409,
        'PAYMENT_ORDER_MISMATCH',
      );
    if (
      ['PAID', 'AUTHORIZED', 'PENDING', 'REQUIRES_ACTION'].includes(
        input.status,
      )
    ) {
      const released = await tx.inventoryTransaction.findFirst({
        where: {
          referenceId: order.id,
          type: 'RELEASE',
          inventory: {
            tenantId,
            ...(order.warehouseId ? { warehouseId: order.warehouseId } : {}),
            variant: { product: { tenantId } },
          },
        },
      });
      if (released)
        throw new AppError(
          'Reservation was released; payment requires reconciliation',
          409,
          'ORDER_INVENTORY_RESERVATION_RELEASED',
        );
    }
    const isAllowedCodFulfillmentCancellation =
      options?.transition?.kind === 'ORDER_LIFECYCLE' &&
      options?.allowCodFulfillmentCancellation === true &&
      input.status === PaymentStatus.CANCELLED &&
      payment.method === 'CASH_ON_DELIVERY' &&
      payment.provider === 'NONE' &&
      ['PROCESSING', 'SHIPPED'].includes(order.status);

    if (
      ['FAILED', 'CANCELLED'].includes(input.status) &&
      !['PENDING', 'CONFIRMED', 'CANCELLED'].includes(order.status) &&
      !isAllowedCodFulfillmentCancellation
    )
      throw new AppError(
        'Fulfillment is underway; payment outcome requires reconciliation',
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
      );
    if (
      payment.providerPaymentId &&
      input.providerPaymentId !== undefined &&
      payment.providerPaymentId !== input.providerPaymentId
    )
      throw new AppError(
        'Provider reference conflicts with stored payment',
        409,
        'PAYMENT_PROVIDER_REFERENCE_CONFLICT',
      );
    let updatedPayment = await tx.payment.update({
      where: { id: paymentId, order: { tenantId } },
      data: {
        status: input.status,
        ...(input.providerPaymentId === undefined ||
        options?.preserveProviderTransactionId === true
          ? {}
          : { providerPaymentId: input.providerPaymentId }),
        ...(input.providerTransactionId === undefined ||
        options?.preserveProviderTransactionId === true
          ? {}
          : { providerTransactionId: input.providerTransactionId }),
        ...(input.failureCode === undefined
          ? {}
          : { failureCode: input.failureCode }),
        ...(input.failureMessage === undefined
          ? {}
          : { failureMessage: input.failureMessage }),
        ...(input.metadata === undefined
          ? {}
          : {
              metadata:
                input.metadata === null
                  ? Prisma.DbNull
                  : (input.metadata as Prisma.InputJsonObject),
            }),
      },
    });
    // A trusted provider/admin confirmation reconciles an uncertain initiation.
    // Do not reset to NOT_STARTED or call a provider again after confirmation.
    if (
      input.status !== PaymentStatus.PENDING &&
      (payment.initiationState === 'IN_PROGRESS' ||
        payment.initiationState === 'UNKNOWN')
    ) {
      updatedPayment = await this.repository.setInitiationState(
        tx,
        tenantId,
        order.userId,
        paymentId,
        ['FAILED', 'CANCELLED'].includes(input.status)
          ? 'UNKNOWN'
          : 'INITIATED',
      );
    }
    const paymentStatus = await this.calculateOrderPaymentStatus(
      tenantId,
      payment.orderId,
      tx,
    );

    await tx.order.update({
      where: { id: payment.orderId, tenantId },
      data: { paymentStatus },
    });

    const skipInventory =
      options?.skipInventorySideEffects === true ||
      isTrustedRefundRollbackToPaid;

    if (!skipInventory) {
      if (paymentStatus === PaymentStatus.PAID) {
        await inventoryService.commitOrderSale(tenantId, payment.orderId, tx);
      } else if (
        paymentStatus === PaymentStatus.FAILED ||
        paymentStatus === PaymentStatus.CANCELLED
      ) {
        await inventoryService.releaseOrderReservation(
          tenantId,
          payment.orderId,
          tx,
        );
      }
    }

    const paymentEventTypeMap: Record<PaymentStatus, PaymentEventType | null> = {
      PENDING: null,
      REQUIRES_ACTION: null,
      AUTHORIZED: null,
      PAID: 'PAYMENT_PAID',
      FAILED: 'PAYMENT_FAILED',
      CANCELLED: null,
      REFUND_PENDING: null,
      PARTIALLY_REFUNDED: 'PAYMENT_PARTIALLY_REFUNDED',
      REFUNDED: 'PAYMENT_REFUNDED',
    };

    const skipNotification =
      options?.skipPaymentNotification === true ||
      isTrustedRefundRollbackToPaid;

    const targetPaymentEventType = paymentEventTypeMap[input.status];
    if (targetPaymentEventType && !skipNotification) {
      await paymentNotificationService.createPaymentNotification({
        eventType: targetPaymentEventType,
        paymentId: updatedPayment.id,
        expectedTenantId: tenantId,
        tx,
        ...(input.refundId ? { refundId: input.refundId } : {}),
        ...(input.refundAmount ? { refundAmount: input.refundAmount } : {}),
        ...(updatedPayment.providerTransactionId
          ? { providerTransactionId: updatedPayment.providerTransactionId }
          : {}),
      });
    }

    return updatedPayment;
  }

  async cancelPayment(tenantId: string, paymentId: string) {
    const payment = await this.repository.findById(tenantId, paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    if (payment.status === PaymentStatus.CANCELLED) return payment;
    if (isFinanciallyCommitted(payment.status)) {
      throw new AppError(
        'A financially committed payment cannot be cancelled',
        409,
        'PAYMENT_CANNOT_BE_CANCELLED',
      );
    }
    if (payment.status === PaymentStatus.FAILED)
      return this.applyTrustedPaymentStatus(
        tenantId,
        payment.id,
        {
          status: PaymentStatus.CANCELLED,
        },
        { kind: 'PAYMENT_CANCEL' },
      );

    if (!payment.providerPaymentId) {
      return this.applyTrustedPaymentStatus(
        tenantId,
        payment.id,
        {
          status: PaymentStatus.CANCELLED,
        },
        { kind: 'PAYMENT_CANCEL' },
      );
    }

    const provider = this.providerRegistry.getProvider(payment.provider);

    const result = await provider.cancelPayment(payment.providerPaymentId);

    return this.applyTrustedPaymentStatus(
      tenantId,
      payment.id,
      {
        status: result.status,
      },
      { kind: 'PAYMENT_CANCEL' },
    );
  }

  async refundPayment(
    tenantId: string,
    paymentId: string,
    amount?: string,
    options?: {
      idempotencyKey?: string;
      reason?: string;
      requestedByUserId?: string;
    },
  ) {
    const { PaymentRefundService } = await import(
      './payment-refund.service.js'
    );
    const refundService = new PaymentRefundService(
      undefined,
      this,
      this.providerRegistry,
    );
    return refundService.refundPayment(tenantId, paymentId, {
      ...(amount === undefined ? {} : { amount }),
      ...(options?.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: options.idempotencyKey }),
      ...(options?.reason === undefined ? {} : { reason: options.reason }),
      requestedByUserId: options?.requestedByUserId ?? '',
    });
  }

  private assertTransitionAuthorized(
    payment: {
      method: string;
      provider: string;
      status: PaymentStatus;
      initiationState: string;
      providerPaymentId: string | null;
      amount: Prisma.Decimal;
      currency: string;
    },
    order: {
      status: string;
      totalAmount: Prisma.Decimal;
      currency: string;
    },
    input: UpdatePaymentStatusInput,
    options?: ApplyPaymentStatusOptions,
  ): void {
    const transition = options?.transition;

    if (!transition) {
      if (
        input.status === PaymentStatus.PAID ||
        input.status === PaymentStatus.AUTHORIZED
      ) {
        if (payment.method === 'CASH_ON_DELIVERY') {
          throw new AppError(
            'COD payment confirmation requires the dedicated delivered order confirmation workflow',
            409,
            'COD_PAYMENT_CONFIRMATION_REQUIRED',
          );
        }
        throw new AppError(
          'Payment confirmation requires authoritative provider verification',
          409,
          'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
        );
      }

      if (
        payment.method === 'CASH_ON_DELIVERY' &&
        input.metadata !== undefined
      ) {
        throw new AppError(
          'COD payment metadata cannot be modified directly',
          409,
          'COD_METADATA_IMMUTABLE',
        );
      }

      if (
        isPlainObject(input.metadata) &&
        ('codCollection' in input.metadata || 'codReturn' in input.metadata)
      ) {
        throw new AppError(
          'Protected COD payment metadata cannot be set directly',
          409,
          'COD_METADATA_IMMUTABLE',
        );
      }

      if (
        input.status === PaymentStatus.REFUND_PENDING ||
        input.status === PaymentStatus.PARTIALLY_REFUNDED ||
        input.status === PaymentStatus.REFUNDED
      ) {
        throw new AppError(
          'Refund status transitions require a verified refund workflow',
          409,
          'PAYMENT_REFUND_VERIFICATION_REQUIRED',
        );
      }

      return;
    }

    switch (transition.kind) {
      case 'COD_CONFIRMATION': {
        if (
          payment.method !== 'CASH_ON_DELIVERY' ||
          payment.provider !== 'NONE' ||
          order.status !== 'DELIVERED' ||
          input.status !== PaymentStatus.PAID
        ) {
          throw new AppError(
            'COD confirmation requires a DELIVERED Cash on Delivery order transitioning to PAID',
            409,
            'COD_PAYMENT_CONFIRMATION_REQUIRED',
          );
        }

        const codCollection = isPlainObject(input.metadata)
          ? input.metadata.codCollection
          : null;
        if (!isPlainObject(codCollection)) {
          throw new AppError(
            'COD confirmation requires validated collection audit metadata',
            409,
            'COD_PAYMENT_CONFIRMATION_INVALID',
          );
        }

        const metaRef = asNonEmptyString(codCollection.referenceId);
        const metaActor = asNonEmptyString(codCollection.collectedByUserId);
        const metaCollectedAt = asNonEmptyString(codCollection.collectedAt);
        const metaCurrency = asNonEmptyString(codCollection.currency);
        const metaAmount = asNonEmptyString(codCollection.collectedAmount);

        if (
          !metaRef ||
          metaRef !== transition.referenceId.trim() ||
          !metaActor ||
          metaActor !== transition.actorUserId.trim() ||
          !metaCollectedAt ||
          !metaCurrency ||
          metaCurrency !== order.currency ||
          !metaAmount
        ) {
          throw new AppError(
            'COD confirmation audit metadata does not match the order',
            409,
            'COD_PAYMENT_CONFIRMATION_INVALID',
          );
        }

        let collectedDecimal: Prisma.Decimal;
        try {
          collectedDecimal = new Prisma.Decimal(metaAmount);
        } catch {
          throw new AppError(
            'COD confirmation amount metadata is invalid',
            409,
            'COD_PAYMENT_CONFIRMATION_INVALID',
          );
        }

        if (
          !collectedDecimal.equals(order.totalAmount) ||
          !collectedDecimal.equals(payment.amount)
        ) {
          throw new AppError(
            'COD confirmation amount does not match order total',
            409,
            'PAYMENT_AMOUNT_MISMATCH',
          );
        }
        return;
      }

      case 'PROVIDER_VERIFICATION': {
        if (
          input.status === PaymentStatus.REFUND_PENDING ||
          input.status === PaymentStatus.PARTIALLY_REFUNDED ||
          input.status === PaymentStatus.REFUNDED
        ) {
          throw new AppError(
            'Refund status transitions require a verified refund workflow',
            409,
            'PAYMENT_REFUND_VERIFICATION_REQUIRED',
          );
        }
        const verifiedInvoiceId = transition.providerPaymentId.trim();
        if (
          payment.method === 'CASH_ON_DELIVERY' ||
          payment.provider === 'NONE' ||
          transition.provider !== payment.provider ||
          verifiedInvoiceId.length === 0 ||
          (payment.providerPaymentId &&
            payment.providerPaymentId !== verifiedInvoiceId) ||
          (input.providerPaymentId !== undefined &&
            input.providerPaymentId !== null &&
            input.providerPaymentId !== verifiedInvoiceId)
        ) {
          throw new AppError(
            'Payment confirmation requires authoritative provider verification',
            409,
            'PAYMENT_PROVIDER_VERIFICATION_REQUIRED',
          );
        }
        return;
      }

      case 'PROVIDER_INITIATION': {
        const persistedInvoiceId = asNonEmptyString(payment.providerPaymentId);
        const incomingInvoiceId = asNonEmptyString(input.providerPaymentId);
        const isEarlyPendingWebhookCompletion =
          payment.initiationState === 'INITIATED' &&
          payment.provider === 'MYFATOORAH' &&
          persistedInvoiceId !== null &&
          incomingInvoiceId !== null &&
          persistedInvoiceId === incomingInvoiceId &&
          (payment.status === PaymentStatus.PENDING ||
            payment.status === PaymentStatus.REQUIRES_ACTION) &&
          input.status === PaymentStatus.REQUIRES_ACTION;

        if (
          payment.initiationState !== 'IN_PROGRESS' &&
          !isEarlyPendingWebhookCompletion
        ) {
          throw new AppError(
            'Provider initiation update requires an active in-progress initiation',
            409,
            'PAYMENT_INITIATION_NOT_IN_PROGRESS',
          );
        }
        if (
          payment.method === 'CASH_ON_DELIVERY' &&
          (input.status === PaymentStatus.PAID ||
            input.status === PaymentStatus.AUTHORIZED)
        ) {
          throw new AppError(
            'COD payment confirmation requires the dedicated delivered order confirmation workflow',
            409,
            'COD_PAYMENT_CONFIRMATION_REQUIRED',
          );
        }
        return;
      }

      case 'ORDER_LIFECYCLE':
      case 'PAYMENT_CANCEL': {
        if (input.status !== PaymentStatus.CANCELLED) {
          throw new AppError(
            'Cancellation transition may only set payment status to CANCELLED',
            409,
            'INVALID_PAYMENT_STATUS_TRANSITION',
          );
        }
        return;
      }

      case 'PAYMENT_REFUND': {
        if (
          payment.method === 'CASH_ON_DELIVERY' ||
          payment.provider === 'NONE'
        ) {
          throw new AppError(
            'COD refunds require a dedicated auditable refund workflow',
            409,
            'COD_REFUND_WORKFLOW_REQUIRED',
          );
        }
        const isAllowedRollbackToPaid =
          input.status === PaymentStatus.PAID &&
          payment.status === PaymentStatus.REFUND_PENDING &&
          transition.allowRollbackToPaid === true;
        if (
          !isAllowedRollbackToPaid &&
          ![
            PaymentStatus.REFUND_PENDING,
            PaymentStatus.PARTIALLY_REFUNDED,
            PaymentStatus.REFUNDED,
          ].some((allowed) => allowed === input.status)
        ) {
          throw new AppError(
            'Refund transition may only set refund payment statuses',
            409,
            'INVALID_PAYMENT_STATUS_TRANSITION',
          );
        }
        return;
      }
    }
  }

  private async verifyRefundLedgerTransitionProof(
    tx: Prisma.TransactionClient,
    tenantId: string,
    payment: {
      id: string;
      status: PaymentStatus;
      amount: Prisma.Decimal;
      currency: string;
      provider: 'NONE' | 'STRIPE' | 'PAYMOB' | 'MYFATOORAH';
      method: 'CASH_ON_DELIVERY' | 'CARD' | 'DIGITAL_WALLET' | 'BANK_TRANSFER';
    },
    order: { id: string },
    input: UpdatePaymentStatusInput,
    transition: Extract<TrustedPaymentTransition, { kind: 'PAYMENT_REFUND' }>,
  ): Promise<boolean> {
    const referencedRefundId = asNonEmptyString(
      transition.refundId ?? input.refundId,
    );
    if (!referencedRefundId) {
      throw new AppError(
        'Refund payment transition requires a persisted refund ledger record',
        409,
        'PAYMENT_REFUND_VERIFICATION_REQUIRED',
      );
    }

    const refunds = await tx.paymentRefund.findMany({
      where: {
        tenantId,
        orderId: order.id,
        paymentId: payment.id,
      },
    });

    const referencedRow = refunds.find((row) => row.id === referencedRefundId);
    if (!referencedRow) {
      throw new AppError(
        'Referenced refund record does not exist for this payment and tenant',
        409,
        'PAYMENT_REFUND_VERIFICATION_REQUIRED',
      );
    }

    const accounting = computeRefundAccountingDecimals(payment, refunds);
    const derivedAggregateStatus =
      deriveAggregatePaymentStatusFromLedger(accounting);

    if (derivedAggregateStatus !== input.status) {
      throw new AppError(
        `Requested payment status ${input.status} contradicts refund ledger status ${derivedAggregateStatus}`,
        409,
        'PAYMENT_REFUND_LEDGER_MISMATCH',
      );
    }

    return (
      derivedAggregateStatus === PaymentStatus.PAID &&
      transition.allowRollbackToPaid === true &&
      referencedRow.status === PaymentRefundStatus.FAILED
    );
  }

  private validateRefundAmountInput(
    payment: { amount: Prisma.Decimal; currency: string },
    input: UpdatePaymentStatusInput,
  ): void {
    if (input.status === PaymentStatus.PARTIALLY_REFUNDED) {
      const rawAmount = asNonEmptyString(input.refundAmount);
      if (!rawAmount) {
        throw new AppError(
          'Refund amount is required for partial refund transitions',
          400,
          'INVALID_REFUND_AMOUNT',
        );
      }
      const refundDecimal = validateAmount(rawAmount, payment.currency);
      if (refundDecimal.lte(0) || refundDecimal.gte(payment.amount)) {
        throw new AppError(
          'Partial refund amount must be greater than zero and less than the payment amount',
          400,
          'INVALID_REFUND_AMOUNT',
        );
      }
      return;
    }

    if (
      input.status === PaymentStatus.REFUNDED &&
      input.refundAmount !== undefined
    ) {
      const rawAmount = asNonEmptyString(input.refundAmount);
      if (!rawAmount) {
        throw new AppError(
          'Invalid refund amount',
          400,
          'INVALID_REFUND_AMOUNT',
        );
      }
      const refundDecimal = validateAmount(rawAmount, payment.currency);
      if (refundDecimal.lte(0) || refundDecimal.gt(payment.amount)) {
        throw new AppError(
          'Invalid refund amount',
          400,
          'INVALID_REFUND_AMOUNT',
        );
      }
    }
  }

  private async calculateOrderPaymentStatus(
    tenantId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentStatus> {
    const payments = await tx.payment.findMany({
      where: { orderId, order: { tenantId } },
    });
    if (payments.length !== 1)
      throw new AppError(
        'Multiple or missing legacy payments require reconciliation',
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
      );
    return payments[0]!.status;
  }
}
