import {
  prisma,
} from '../../config/database.js';

import {
  CartRepository,
} from './cart.repository.js';

export const cartRepository =
  new CartRepository(prisma);