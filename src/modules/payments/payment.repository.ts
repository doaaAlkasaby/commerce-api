import { Prisma } from '../../generated/prisma/client.js';

import type {
  Payment,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../generated/prisma/client.js';

import { prisma } from '../../config/database.js';

import type {
  CreatePaymentInput,
  PaymentFilterInput,
  UpdatePaymentStatusInput,
} from './payment.types.js';

export class PaymentRepository {
  async create(
    input: CreatePaymentInput,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Payment> {
    return client.payment.create({
      data: {
        orderId: input.orderId,

        amount: input.amount,

        currency: input.currency,

        method: input.method,

        provider: input.provider,

        status: 'PENDING',

        ...(input.metadata == null
          ? {}
          : {
              metadata: input.metadata as Prisma.InputJsonObject,
            }),
      },
    });
  }

  async findById(id: string): Promise<Payment | null> {
    return prisma.payment.findUnique({
      where: {
        id,
      },
    });
  }

  async findByIdForOrder(id: string, orderId: string): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        id,
        orderId,
      },
    });
  }

  async findByProviderPaymentId(
    providerPaymentId: string,
  ): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        providerPaymentId,
      },
    });
  }

  async findByProviderTransactionId(
    providerTransactionId: string,
  ): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        providerTransactionId,
      },
    });
  }

  async findMany(filters: PaymentFilterInput = {}): Promise<Payment[]> {
    const where: Prisma.PaymentWhereInput = {};

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
    id: string,
    input: UpdatePaymentStatusInput,
  ): Promise<Payment> {
    return prisma.payment.update({
      where: {
        id,
      },

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
  }

  async updateStatusWithClient(
    id: string,
    input: UpdatePaymentStatusInput,
    client: Prisma.TransactionClient,
  ): Promise<Payment> {
    return client.payment.update({
      where: {
        id,
      },

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
  }

  async findOrderPayment(
    orderId: string,
    paymentId: string,
  ): Promise<Payment | null> {
    return prisma.payment.findFirst({
      where: {
        id: paymentId,
        orderId,
      },
    });
  }
}
