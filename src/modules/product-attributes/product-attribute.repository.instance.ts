import { prisma } from '../../config/database.js';

import { ProductAttributeRepository } from './product-attribute.repository.js';

export const productAttributeRepository =
  new ProductAttributeRepository(prisma);