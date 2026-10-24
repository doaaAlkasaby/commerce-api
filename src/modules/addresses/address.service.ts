import { AppError } from '../../common/errors/app-error.js';

import type { AddressRepository } from './address.repository.js';

import type {
  CreateAddressInput,
  UpdateAddressInput,
} from './address.types.js';

export class AddressService {
  constructor(
    private readonly repository: AddressRepository,
  ) {}

  async create(
    userId: string,
    input: CreateAddressInput,
  ) {
    return this.repository.transaction(
      async (tx) => {
        if (input.isDefaultShipping === true) {
          await this.repository
            .clearDefaultShippingWithTransaction(
              tx,
              userId,
            );
        }

        if (input.isDefaultBilling === true) {
          await this.repository
            .clearDefaultBillingWithTransaction(
              tx,
              userId,
            );
        }

        return this.repository.createWithTransaction(
          tx,
          userId,
          input,
        );
      },
    );
  }

  async getAll(userId: string) {
    return this.repository.findAllByUser(userId);
  }

  async getById(
    userId: string,
    addressId: string,
  ) {
    const address =
      await this.repository.findByIdForUser(
        addressId,
        userId,
      );

    if (!address) {
      throw new AppError(
        'Address not found',
        404,
        'ADDRESS_NOT_FOUND',
      );
    }

    return address;
  }

  async update(
    userId: string,
    addressId: string,
    input: UpdateAddressInput,
  ) {
    await this.getById(
      userId,
      addressId,
    );

    return this.repository.transaction(
      async (tx) => {
        if (input.isDefaultShipping === true) {
          await this.repository
            .clearDefaultShippingWithTransaction(
              tx,
              userId,
            );
        }

        if (input.isDefaultBilling === true) {
          await this.repository
            .clearDefaultBillingWithTransaction(
              tx,
              userId,
            );
        }

        return this.repository.updateWithTransaction(
          tx,
          addressId,
          input,
        );
      },
    );
  }

  async delete(
    userId: string,
    addressId: string,
  ) {
    await this.getById(
      userId,
      addressId,
    );

    await this.repository.delete(
      addressId,
    );
  }

  async setDefaultShipping(
    userId: string,
    addressId: string,
  ) {
    await this.getById(
      userId,
      addressId,
    );

    return this.repository.transaction(
      async (tx) => {
        await this.repository
          .clearDefaultShippingWithTransaction(
            tx,
            userId,
          );

        return this.repository.updateWithTransaction(
          tx,
          addressId,
          {
            isDefaultShipping: true,
          },
        );
      },
    );
  }

  async setDefaultBilling(
    userId: string,
    addressId: string,
  ) {
    await this.getById(
      userId,
      addressId,
    );

    return this.repository.transaction(
      async (tx) => {
        await this.repository
          .clearDefaultBillingWithTransaction(
            tx,
            userId,
          );

        return this.repository.updateWithTransaction(
          tx,
          addressId,
          {
            isDefaultBilling: true,
          },
        );
      },
    );
  }
}