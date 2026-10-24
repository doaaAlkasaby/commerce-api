import {
  prisma,
} from '../../config/database.js';

import {
  createCategoryRepository,
} from './category.repository.js';

export const categoryRepository =
  createCategoryRepository(prisma);