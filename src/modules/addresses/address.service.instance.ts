import { addressRepository } from './address.repository.instance.js';
import { AddressService } from './address.service.js';

export const addressService =
  new AddressService(addressRepository);