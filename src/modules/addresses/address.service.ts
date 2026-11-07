import { AppError } from '../../common/errors/app-error.js';
import type { Address, Prisma } from '../../generated/prisma/client.js';

import type { AddressRepository } from './address.repository.js';

import type {
  CreateAddressInput,
  UpdateAddressInput,
} from './address.types.js';

export class AddressService {
  private async validateDestination(
    tx: Prisma.TransactionClient,
    input: CreateAddressInput | UpdateAddressInput,
    current?: Address,
  ) {
    if (
      input.country !== undefined &&
      !(await this.repository.activeCountry(tx, input.country))
    )
      throw new AppError(
        'Country is not supported',
        400,
        'COUNTRY_NOT_SUPPORTED',
      );
    const latitude =
      input.latitude !== undefined ? input.latitude : current?.latitude;
    const longitude =
      input.longitude !== undefined ? input.longitude : current?.longitude;
    if ((latitude != null) !== (longitude != null))
      throw new AppError(
        'Both coordinates are required together',
        400,
        'DELIVERY_COORDINATES_INCOMPLETE',
      );
  }
  constructor(private readonly repository: AddressRepository) {}

  async create(userId: string, input: CreateAddressInput) {
    return this.repository.transaction(async (tx) => {
      await this.validateDestination(tx, input);
      if (input.isDefaultShipping === true) {
        await this.repository.clearDefaultShippingWithTransaction(tx, userId);
      }

      if (input.isDefaultBilling === true) {
        await this.repository.clearDefaultBillingWithTransaction(tx, userId);
      }

      return this.repository.createWithTransaction(tx, userId, input);
    });
  }

  async getAll(userId: string) {
    return this.repository.findAllByUser(userId);
  }

  async getById(userId: string, addressId: string) {
    const address = await this.repository.findByIdForUser(addressId, userId);

    if (!address) {
      throw new AppError('Address not found', 404, 'ADDRESS_NOT_FOUND');
    }

    return address;
  }

  async update(userId: string, addressId: string, input: UpdateAddressInput) {
    const current = await this.getById(userId, addressId);

    return this.repository.transaction(async (tx) => {
      await this.validateDestination(tx, input, current);
      if (input.isDefaultShipping === true) {
        await this.repository.clearDefaultShippingWithTransaction(tx, userId);
      }

      if (input.isDefaultBilling === true) {
        await this.repository.clearDefaultBillingWithTransaction(tx, userId);
      }

      return this.repository.updateWithTransaction(tx, addressId, input);
    });
  }

  async delete(userId: string, addressId: string) {
    await this.getById(userId, addressId);

    await this.repository.delete(addressId);
  }

  async setDefaultShipping(userId: string, addressId: string) {
    await this.getById(userId, addressId);

    return this.repository.transaction(async (tx) => {
      await this.repository.clearDefaultShippingWithTransaction(tx, userId);

      return this.repository.updateWithTransaction(tx, addressId, {
        isDefaultShipping: true,
      });
    });
  }

  async setDefaultBilling(userId: string, addressId: string) {
    await this.getById(userId, addressId);

    return this.repository.transaction(async (tx) => {
      await this.repository.clearDefaultBillingWithTransaction(tx, userId);

      return this.repository.updateWithTransaction(tx, addressId, {
        isDefaultBilling: true,
      });
    });
  }
}
