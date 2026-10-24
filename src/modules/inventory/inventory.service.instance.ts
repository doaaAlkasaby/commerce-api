import {
  inventoryRepository,
} from './inventory.repository.instance.js';

import {
  InventoryService,
} from './inventory.service.js';

export const inventoryService =
  new InventoryService(
    inventoryRepository,
  );