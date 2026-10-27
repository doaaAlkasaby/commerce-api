import {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';

import { prisma } from '../../config/database.js';

import { AppError } from '../../common/errors/app-error.js';

import { paymentRepository } from './payment.repository.instance.js';

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

    const provider = this.providerRegistry.resolveProviderForMethod(
      input.method,
    );

    if (input.provider !== provider) {
      throw new AppError(
        `Payment provider ${input.provider} is invalid for ${input.method}`,
        400,
        'INVALID_PAYMENT_PROVIDER',
      );
    }

    const payment = await this.repository.create(tenantId, {
      ...input,
      provider,
    });

    try {
      const adapter = this.providerRegistry.getProvider(provider);

      const providerResult = await adapter.createPayment({
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount.toString(),
        currency: payment.currency,
        method: payment.method,
        metadata: payment.metadata as Record<string, unknown> | null,
      });

      return await prisma.$transaction(async (tx) => {
        const updatedPayment = await tx.payment.update({
          where: {
            id: payment.id,
            order: { tenantId },
          },

          data: {
            status: providerResult.status,

            ...(providerResult.providerPaymentId === undefined
              ? {}
              : { providerPaymentId: providerResult.providerPaymentId }),

            ...(providerResult.providerTransactionId === undefined
              ? {}
              : {
                  providerTransactionId: providerResult.providerTransactionId,
                }),

            ...(providerResult.failureCode === undefined
              ? {}
              : { failureCode: providerResult.failureCode }),

            ...(providerResult.failureMessage === undefined
              ? {}
              : { failureMessage: providerResult.failureMessage }),

            ...(providerResult.metadata == null
              ? {}
              : {
                  metadata: providerResult.metadata as Prisma.InputJsonObject,
                }),
          },
        });

        const paymentStatus = await this.calculateOrderPaymentStatus(
          tenantId,
          input.orderId,
          tx,
        );

        await tx.order.update({
          where: {
            id: input.orderId,
            tenantId,
          },

          data: {
            paymentStatus,
          },
        });

        return updatedPayment;
      });
    } catch (error) {
      await this.markPaymentAsFailed(tenantId, payment.id, error);

      throw error;
    }
  }

  async getPayment(tenantId: string, paymentId: string) {
    const payment = await this.repository.findById(tenantId, paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    return payment;
  }

  async getPaymentForOrder(tenantId: string, paymentId: string, orderId: string) {
    const payment = await this.repository.findByIdForOrder(tenantId, paymentId, orderId);

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
    const payment = await this.repository.findById(tenantId, paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    this.validateStatusTransition(payment.status, input.status);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await this.repository.updateStatusWithClient(
        tenantId,
        paymentId,
        input,
        tx,
      );

      const paymentStatus = await this.calculateOrderPaymentStatus(
        tenantId,
        payment.orderId,
        tx,
      );

      await tx.order.update({
        where: {
          id: payment.orderId,
          tenantId,
        },

        data: {
          paymentStatus,
        },
      });

      return result;
    });

    return updated;
  }

  async cancelPayment(tenantId: string, paymentId: string) {
    const payment = await this.repository.findById(tenantId, paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    if (
      payment.status === PaymentStatus.PAID ||
      payment.status === PaymentStatus.REFUNDED ||
      payment.status === PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new AppError(
        'A completed payment cannot be cancelled',
        400,
        'PAYMENT_CANNOT_BE_CANCELLED',
      );
    }

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
      where: {
        orderId,
        order: { tenantId },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (payments.length === 0) {
      return PaymentStatus.PENDING;
    }

    if (payments.some((payment) => payment.status === PaymentStatus.PAID)) {
      const paidPayments = payments.filter(
        (payment) => payment.status === PaymentStatus.PAID,
      );

      const totalPaid = paidPayments.reduce(
        (total, payment) => total.plus(payment.amount),
        new Prisma.Decimal(0),
      );

      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          tenantId,
        },
        select: {
          totalAmount: true,
        },
      });

      if (order && totalPaid.gte(order.totalAmount)) {
        return PaymentStatus.PAID;
      }

      return PaymentStatus.PARTIALLY_REFUNDED;
    }

    if (
      payments.some(
        (payment) => payment.status === PaymentStatus.REQUIRES_ACTION,
      )
    ) {
      return PaymentStatus.REQUIRES_ACTION;
    }

    if (
      payments.some((payment) => payment.status === PaymentStatus.AUTHORIZED)
    ) {
      return PaymentStatus.AUTHORIZED;
    }

    if (
      payments.some(
        (payment) => payment.status === PaymentStatus.REFUND_PENDING,
      )
    ) {
      return PaymentStatus.REFUND_PENDING;
    }

    if (
      payments.some(
        (payment) => payment.status === PaymentStatus.PARTIALLY_REFUNDED,
      )
    ) {
      return PaymentStatus.PARTIALLY_REFUNDED;
    }

    if (
      payments.every((payment) => payment.status === PaymentStatus.CANCELLED)
    ) {
      return PaymentStatus.CANCELLED;
    }

    if (payments.some((payment) => payment.status === PaymentStatus.FAILED)) {
      return PaymentStatus.FAILED;
    }

    return PaymentStatus.PENDING;
  }

  private validateStatusTransition(
    current: PaymentStatus,
    next: PaymentStatus,
  ): void {
    if (current === next) {
      return;
    }

    const transitions: Record<PaymentStatus, PaymentStatus[]> = {
      PENDING: [
        PaymentStatus.REQUIRES_ACTION,
        PaymentStatus.AUTHORIZED,
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
      ],

      REQUIRES_ACTION: [
        PaymentStatus.AUTHORIZED,
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
      ],

      AUTHORIZED: [
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
      ],

      PAID: [
        PaymentStatus.REFUND_PENDING,
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ],

      FAILED: [PaymentStatus.PENDING, PaymentStatus.CANCELLED],

      CANCELLED: [],

      REFUND_PENDING: [
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ],

      PARTIALLY_REFUNDED: [
        PaymentStatus.REFUND_PENDING,
        PaymentStatus.REFUNDED,
      ],

      REFUNDED: [],
    };

    if (!transitions[current].includes(next)) {
      throw new AppError(
        `Invalid payment status transition from ${current} to ${next}`,
        400,
        'INVALID_PAYMENT_STATUS_TRANSITION',
      );
    }
  }

  private async markPaymentAsFailed(
    tenantId: string,
    paymentId: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.repository.updateStatus(tenantId, paymentId, {
        status: PaymentStatus.FAILED,

        failureCode: 'PAYMENT_PROVIDER_ERROR',

        failureMessage:
          error instanceof Error ? error.message : 'Payment provider error',
      });
    } catch {
      // Do not hide the original provider error.
    }
  }
}
