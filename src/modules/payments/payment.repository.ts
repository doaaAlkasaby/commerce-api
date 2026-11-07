import { AppError } from '../../common/errors/app-error.js';
import { Prisma } from '../../generated/prisma/client.js';

import type { Payment } from '../../generated/prisma/client.js';

import { prisma } from '../../config/database.js';

import type {
  CreatePaymentInput,
  PaymentFilterInput,
  UpdatePaymentStatusInput,
} from './payment.types.js';

export class PaymentRepository {
  async setMyFatoorahInvoiceId(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
    invoiceId: string,
  ) {
    return tx.payment.update({
      where: { id: paymentId, provider: 'MYFATOORAH', order: { tenantId } },
      data: { providerPaymentId: invoiceId },
    });
  }

  async findMyFatoorahInvoice(invoiceId: string) {
    return prisma.myFatoorahInvoice.findUnique({
      where: { invoiceId },
      include: { payment: { include: { order: true } } },
    });
  }

  async findMyFatoorahCustomerReference(paymentId: string) {
    return prisma.payment.findFirst({
      where: {
        id: paymentId,
        provider: 'MYFATOORAH',
        initiationState: { in: ['IN_PROGRESS', 'UNKNOWN'] },
      },
      include: { order: true },
    });
  }

  async bindMyFatoorahInvoice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
    invoiceId: string,
  ) {
    const owned = await tx.payment.findFirst({
      where: { id: paymentId, provider: 'MYFATOORAH', order: { tenantId } },
      select: { id: true },
    });
    if (!owned)
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    const existing = await tx.myFatoorahInvoice.findUnique({
      where: { paymentId },
    });
    if (existing && existing.invoiceId !== invoiceId)
      throw new AppError(
        'MyFatoorah invoice reference conflict',
        409,
        'MYFATOORAH_REFERENCE_CONFLICT',
      );
    return tx.myFatoorahInvoice.upsert({
      where: { paymentId },
      create: { paymentId, invoiceId },
      update: {},
    });
  }

  async findWebhookEvent(
    reference: string,
    hash: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return client.myFatoorahWebhookEvent.findFirst({
      where: { OR: [{ eventReference: reference }, { canonicalHash: hash }] },
    });
  }

  async recordWebhookEvent(
    tx: Prisma.TransactionClient,
    data: {
      eventReference: string;
      canonicalHash: string;
      paymentId: string;
      invoiceId: string;
      transactionPaymentId: string;
      state: 'PROCESSED' | 'RECONCILIATION_REQUIRED';
      reason?: string;
    },
  ) {
    return tx.myFatoorahWebhookEvent.create({ data });
  }

  async flagReconciliation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
    reason: string,
  ) {
    return tx.payment.update({
      where: { id: paymentId, order: { tenantId } },
      data: { reconciliationRequired: true, reconciliationReason: reason },
    });
  }

  async create(
    tenantId: string,
    input: CreatePaymentInput,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Payment> {
    const order = await client.order.findFirst({
      where: { id: input.orderId, tenantId },
      select: { id: true },
    });
    if (!order) throw new Error('Order does not belong to this tenant');
    return client.payment.create({
      data: {
        orderId: input.orderId,

        amount: input.amount,

        currency: input.currency,

        method: input.method,

        provider: input.provider,

        status: 'PENDING',
        initiationState: 'NOT_STARTED',

        ...(input.metadata == null
          ? {}
          : {
              metadata: input.metadata as Prisma.InputJsonObject,
            }),
      },
    });
  }

  async findForUser(
    tenantId: string,
    userId: string,
    id: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return client.payment.findFirst({
      where: { id, order: { tenantId, userId } },
      include: { order: true },
    });
  }

  async lockOrderForUser(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    paymentId: string,
  ) {
    // Match the lifecycle's order-first locking. Only hold locks for local DB work.
    await tx.$queryRaw`
      SELECT o."id" FROM "Order" o JOIN "Payment" p ON p."orderId" = o."id"
      WHERE p."id" = ${paymentId} AND o."tenantId" = ${tenantId} AND o."userId" = ${userId}
      FOR UPDATE OF o
    `;
  }

  async recordInitiationFailure(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    category: string,
  ) {
    return tx.recoveryJob.upsert({
      where: { orderId },
      create: { tenantId, orderId, lastErrorCode: category },
      update: { lastErrorCode: category },
    });
  }

  async setInitiationState(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    id: string,
    state: 'IN_PROGRESS' | 'INITIATED' | 'UNKNOWN',
  ) {
    const [clock] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error('Database time is unavailable');
    return tx.payment.update({
      where: { id, order: { tenantId, userId } },
      data: { initiationState: state, updatedAt: clock.now },
    });
  }

  async findById(tenantId: string, id: string): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: { id, order: { tenantId } },
    });
  }

  async findByIdForOrder(
    tenantId: string,
    id: string,
    orderId: string,
  ): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        id,
        orderId,
        order: { tenantId },
      },
    });
  }

  async findByProviderPaymentId(
    tenantId: string,
    providerPaymentId: string,
  ): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        providerPaymentId,
        order: { tenantId },
      },
    });
  }

  async findByProviderTransactionId(
    tenantId: string,
    providerTransactionId: string,
  ): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        providerTransactionId,
        order: { tenantId },
      },
    });
  }

  async findMany(
    tenantId: string,
    filters: PaymentFilterInput = {},
  ): Promise<Payment[]> {
    const where: Prisma.PaymentWhereInput = { order: { tenantId } };

    if (filters.orderId !== undefined) {
      where.orderId = filters.orderId;
    }

    if (filters.status !== undefined) {
      where.status = filters.status;
    }

    if (filters.provider !== undefined) {
      where.provider = filters.provider;
    }

    if (filters.method !== undefined) {
      where.method = filters.method;
    }

    return prisma.payment.findMany({
      where,

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateStatus(
    tenantId: string,
    id: string,
    input: UpdatePaymentStatusInput,
  ): Promise<Payment> {
    const { paymentService } = await import('./payment.service.instance.js');
    return paymentService.updatePaymentStatus(tenantId, id, input);
  }

  async updateStatusWithClient(
    tenantId: string,
    id: string,
    input: UpdatePaymentStatusInput,
    client: Prisma.TransactionClient,
  ): Promise<Payment> {
    const { paymentService } = await import('./payment.service.instance.js');
    return paymentService.applyPaymentStatusWithClient(
      tenantId,
      id,
      input,
      client,
    );
  }

  async findOrderPayment(
    tenantId: string,
    orderId: string,
    paymentId: string,
  ): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        id: paymentId,
        orderId,
        order: { tenantId },
      },
    });
  }
}
