import type {
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';

import type {
  CreateAddressInput,
  UpdateAddressInput,
} from './address.types.js';

type PrismaTransaction = Prisma.TransactionClient;

export class AddressRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async create(
    userId: string,
    data: CreateAddressInput,
  ) {
    return this.prisma.address.create({
      data: {
        userId,

        label: data.label ?? null,

        firstName: data.firstName,
        lastName: data.lastName,

        company: data.company ?? null,

        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 ?? null,

        city: data.city,
        state: data.state ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country,

        phone: data.phone ?? null,

        isDefaultShipping:
          data.isDefaultShipping ?? false,

        isDefaultBilling:
          data.isDefaultBilling ?? false,
      },
    });
  }

  async createWithTransaction(
    tx: PrismaTransaction,
    userId: string,
    data: CreateAddressInput,
  ) {
    return tx.address.create({
      data: {
        userId,

        label: data.label ?? null,

        firstName: data.firstName,
        lastName: data.lastName,

        company: data.company ?? null,

        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 ?? null,

        city: data.city,
        state: data.state ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country,

        phone: data.phone ?? null,

        isDefaultShipping:
          data.isDefaultShipping ?? false,

        isDefaultBilling:
          data.isDefaultBilling ?? false,
      },
    });
  }

  async findByIdForUser(
    id: string,
    userId: string,
  ) {
    return this.prisma.address.findFirst({
      where: {
        id,
        userId,
      },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.address.findMany({
      where: {
        userId,
      },
      orderBy: [
        {
          isDefaultShipping: 'desc',
        },
        {
          isDefaultBilling: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });
  }

  async update(
    id: string,
    data: UpdateAddressInput,
  ) {
    return this.prisma.address.update({
      where: {
        id,
      },
      data,
    });
  }

  async updateWithTransaction(
    tx: PrismaTransaction,
    id: string,
    data: UpdateAddressInput,
  ) {
    return tx.address.update({
      where: {
        id,
      },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.address.delete({
      where: {
        id,
      },
    });
  }

  async clearDefaultShipping(
    userId: string,
  ) {
    await this.prisma.address.updateMany({
      where: {
        userId,
        isDefaultShipping: true,
      },
      data: {
        isDefaultShipping: false,
      },
    });
  }

  async clearDefaultShippingWithTransaction(
    tx: PrismaTransaction,
    userId: string,
  ) {
    await tx.address.updateMany({
      where: {
        userId,
        isDefaultShipping: true,
      },
      data: {
        isDefaultShipping: false,
      },
    });
  }

  async clearDefaultBilling(
    userId: string,
  ) {
    await this.prisma.address.updateMany({
      where: {
        userId,
        isDefaultBilling: true,
      },
      data: {
        isDefaultBilling: false,
      },
    });
  }

  async clearDefaultBillingWithTransaction(
    tx: PrismaTransaction,
    userId: string,
  ) {
    await tx.address.updateMany({
      where: {
        userId,
        isDefaultBilling: true,
      },
      data: {
        isDefaultBilling: false,
      },
    });
  }

  async transaction<T>(
  callback: (
    tx: PrismaTransaction,
  ) => Promise<T>,
): Promise<T> {
  return this.prisma.$transaction(
    async (tx) => callback(tx),
  );
}
}

