import { prisma } from '../../config/database.js';

import {
  createProductImageRepository,
} from './product-image.repository.js';

export const productImageRepository =
  createProductImageRepository(prisma);