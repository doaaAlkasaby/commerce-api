import {
  prisma,
} from '../../config/database.js';

import {
  createBrandRepository,
} from './brand.repository.js';

export const brandRepository =
  createBrandRepository(prisma);