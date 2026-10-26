import { ShippingRepository } from './shipping.repository.js';
import { ShippingService } from './shipping.service.js';

const repository =
  new ShippingRepository();

export const shippingService =
  new ShippingService(repository);