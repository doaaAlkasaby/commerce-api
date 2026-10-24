import {
  prisma,
} from '../../config/database.js';

import {
  InventoryRepository,
} from './inventory.repository.js';

export const inventoryRepository =
  new InventoryRepository(prisma);