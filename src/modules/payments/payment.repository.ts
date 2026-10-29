import { Prisma } from '../../generated/prisma/client.js';

import type { Payment } from '../../generated/prisma/client.js';

import { prisma } from '../../config/database.js';

import type {
  CreatePaymentInput,
  PaymentFilterInput,
  UpdatePaymentStatusInput,
} from './payment.types.js';

export class PaymentRepository {
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

  async setInitiationState(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    id: string,
    state: 'IN_PROGRESS' | 'INITIATED' | 'UNKNOWN',
  ) {
    return tx.payment.update({
      where: { id, order: { tenantId, userId } },
      data: { initiationState: state },
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
