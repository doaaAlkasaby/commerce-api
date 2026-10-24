import { prisma } from '../../config/database.js';
import { CheckoutRepository } from './checkout.repository.js';

export const checkoutRepository =
  new CheckoutRepository(prisma);