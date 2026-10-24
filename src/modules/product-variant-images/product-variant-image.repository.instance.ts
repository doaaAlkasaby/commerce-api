import { prisma } from '../../config/database.js';

import {
  ProductVariantImageRepository,
} from './product-variant-image.repository.js';

export const productVariantImageRepository =
  new ProductVariantImageRepository(
    prisma,
  );