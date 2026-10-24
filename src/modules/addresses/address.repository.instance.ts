import { prisma } from '../../config/database.js';
import { AddressRepository } from './address.repository.js';

export const addressRepository =
  new AddressRepository(prisma);