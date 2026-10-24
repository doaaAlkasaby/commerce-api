import { prisma } from '../../config/database.js';

import {
  ProductVariantRepository,
} from './product-variant.repository.js';

export const productVariantRepository =
  new ProductVariantRepository(prisma);