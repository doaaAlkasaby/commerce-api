import {
  PaymentMethod,
  PaymentProvider,
  PaymentRefundStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import type { PaymentRefund } from '../../generated/prisma/client.js';

export interface CreatePaymentRefundRecordInput {
  tenantId: string;
  paymentId: string;
  orderId: string;
  provider: PaymentProvider;
  method: PaymentMethod;
  amount: Prisma.Decimal;
  currency: string;
  idempotencyKey: string;
  requestFingerprint: string;
  reason: string;
  requestedByUserId: string;
  providerMetadata?: Prisma.InputJsonObject | null;
}

export interface UpdatePaymentRefundRecordInput {
  status?: PaymentRefundStatus;
  providerRefundId?: string | null;
  providerRefundReference?: string | null;
  providerRefundInvoiceId?: string | null;
  providerMetadata?: Prisma.InputJsonObject | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  reconciliationReason?: string | null;
  submittedAt?: Date | null;
  completedAt?: Date | null;
}

export class PaymentRefundRepository {
  async findPaymentOrderIdentity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
  ): Promise<{ orderId: string } | null> {
    return tx.payment.findFirst({
      where: { id: paymentId, order: { tenantId } },
      select: { orderId: true },
    });
  }

  async lockOrderForUpdate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
  ): Promise<boolean> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order"
      WHERE "id" = ${orderId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    return locked.length === 1;
  }

  async findPaymentAndOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
    orderId: string,
  ) {
    const [payment, order, siblingCount] = await Promise.all([
      tx.payment.findFirst({
        where: { id: paymentId, orderId, order: { tenantId } },
      }),
      tx.order.findFirst({
        where: { id: orderId, tenantId },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          status: true,
          paymentStatus: true,
          totalAmount: true,
          currency: true,
        },
      }),
      tx.payment.count({
        where: { orderId, order: { tenantId } },
      }),
    ]);

    return { payment, order, siblingCount };
  }

  async findRefundsByPayment(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
  ): Promise<PaymentRefund[]> {
    return tx.paymentRefund.findMany({
      where: { tenantId, paymentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findByIdempotencyKey(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
    idempotencyKey: string,
  ): Promise<PaymentRefund | null> {
    return tx.paymentRefund.findUnique({
      where: {
        tenantId_paymentId_idempotencyKey: {
          tenantId,
          paymentId,
          idempotencyKey,
        },
      },
    });
  }

  async findById(
    tx: Prisma.TransactionClient,
    tenantId: string,
    refundId: string,
  ): Promise<PaymentRefund | null> {
    return tx.paymentRefund.findFirst({
      where: { id: refundId, tenantId },
    });
  }

  async createRequested(
    tx: Prisma.TransactionClient,
    input: CreatePaymentRefundRecordInput,
  ): Promise<PaymentRefund> {
    return tx.paymentRefund.create({
      data: {
        tenantId: input.tenantId,
        paymentId: input.paymentId,
        orderId: input.orderId,
        provider: input.provider,
        method: input.method,
        amount: input.amount,
        currency: input.currency,
        status: PaymentRefundStatus.REQUESTED,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        reason: input.reason,
        requestedByUserId: input.requestedByUserId,
        ...(input.providerMetadata === undefined
          ? {}
          : {
              providerMetadata:
                input.providerMetadata === null
                  ? Prisma.DbNull
                  : input.providerMetadata,
            }),
      },
    });
  }

  async updateRefund(
    tx: Prisma.TransactionClient,
    tenantId: string,
    refundId: string,
    input: UpdatePaymentRefundRecordInput,
  ): Promise<PaymentRefund> {
    return tx.paymentRefund.update({
      where: { id: refundId, tenantId },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.providerRefundId === undefined
          ? {}
          : { providerRefundId: input.providerRefundId }),
        ...(input.providerRefundReference === undefined
          ? {}
          : { providerRefundReference: input.providerRefundReference }),
        ...(input.providerRefundInvoiceId === undefined
          ? {}
          : { providerRefundInvoiceId: input.providerRefundInvoiceId }),
        ...(input.providerMetadata === undefined
          ? {}
          : {
              providerMetadata:
                input.providerMetadata === null
                  ? Prisma.DbNull
                  : input.providerMetadata,
            }),
        ...(input.failureCode === undefined
          ? {}
          : { failureCode: input.failureCode }),
        ...(input.failureMessage === undefined
          ? {}
          : { failureMessage: input.failureMessage }),
        ...(input.reconciliationReason === undefined
          ? {}
          : { reconciliationReason: input.reconciliationReason }),
        ...(input.submittedAt === undefined
          ? {}
          : { submittedAt: input.submittedAt }),
        ...(input.completedAt === undefined
          ? {}
          : { completedAt: input.completedAt }),
      },
    });
  }
}

export const paymentRefundRepository = new PaymentRefundRepository();
