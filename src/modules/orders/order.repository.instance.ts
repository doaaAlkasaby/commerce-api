import {
  prisma,
} from '../../config/database.js';

import {
  OrderRepository,
} from './order.repository.js';

export const orderRepository =
  new OrderRepository(prisma);