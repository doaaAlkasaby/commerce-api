import { logger } from '../../common/logger/logger.js';
import { observePayment, metrics } from '../../common/observability/metrics.js';
import { validateAmount } from '../../common/pricing/money.js';
import {
  validatePaymentTransition,
  isFinanciallyCommitted,
} from '../../common/domain/status-transitions.js';
import { PaymentStatus, Prisma } from '../../generated/prisma/client.js';

import { prisma } from '../../config/database.js';

import { AppError } from '../../common/errors/app-error.js';

import { paymentRepository } from './payment.repository.instance.js';
import { inventoryService } from '../inventory/inventory.service.instance.js';

import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';

import type {
  CreatePaymentInput,
  PaymentFilterInput,
  UpdatePaymentStatusInput,
} from './payment.types.js';

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

  async updatePaymentStatus(
    tenantId: string,
    paymentId: string,
    input: UpdatePaymentStatusInput,
  ) {
    return prisma.$transaction((tx) =>
      this.applyPaymentStatusWithClient(tenantId, paymentId, input, tx),
    );
  }

  async applyPaymentStatusWithClient(
    tenantId: string,
    paymentId: string,
    input: UpdatePaymentStatusInput,
    tx: Prisma.TransactionClient,
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

    // Already cancelled negative notifications are harmless, never resurrect state.
    if (payment.status === 'CANCELLED' && input.status === 'FAILED')
      return payment;
    validatePaymentTransition(payment.status, input.status);
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
          inventory: { variant: { product: { tenantId } } },
        },
      });
      if (released)
        throw new AppError(
          'Reservation was released; payment requires reconciliation',
          409,
          'ORDER_INVENTORY_RESERVATION_RELEASED',
        );
    }
    if (
      ['FAILED', 'CANCELLED'].includes(input.status) &&
      !['PENDING', 'CONFIRMED', 'CANCELLED'].includes(order.status)
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
        ...(input.providerPaymentId === undefined
          ? {}
          : { providerPaymentId: input.providerPaymentId }),
        ...(input.providerTransactionId === undefined
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
      return this.updatePaymentStatus(tenantId, payment.id, {
        status: PaymentStatus.CANCELLED,
      });

    if (!payment.providerPaymentId) {
      return this.updatePaymentStatus(tenantId, payment.id, {
        status: PaymentStatus.CANCELLED,
      });
    }

    const provider = this.providerRegistry.getProvider(payment.provider);

    const result = await provider.cancelPayment(payment.providerPaymentId);

    return this.updatePaymentStatus(tenantId, payment.id, {
      status: result.status,
    });
  }

  async refundPayment(tenantId: string, paymentId: string, amount?: string) {
    const payment = await this.repository.findById(tenantId, paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new AppError(
        'Only paid payments can be refunded',
        400,
        'PAYMENT_NOT_REFUNDABLE',
      );
    }

    const refundAmount = amount ?? payment.amount.toString();

    const refundDecimal = new Prisma.Decimal(refundAmount);

    const paymentDecimal = new Prisma.Decimal(payment.amount);

    if (refundDecimal.lte(0) || refundDecimal.gt(paymentDecimal)) {
      throw new AppError('Invalid refund amount', 400, 'INVALID_REFUND_AMOUNT');
    }

    if (!payment.providerPaymentId) {
      throw new AppError(
        'Payment does not have a provider payment ID',
        400,
        'MISSING_PROVIDER_PAYMENT_ID',
      );
    }

    const provider = this.providerRegistry.getProvider(payment.provider);

    const result = await provider.refundPayment(
      payment.providerPaymentId,
      refundAmount,
    );

    return this.updatePaymentStatus(tenantId, payment.id, {
      status: result.status,

      ...(result.providerTransactionId === undefined
        ? {}
        : {
            providerTransactionId: result.providerTransactionId,
          }),
    });
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
