import {
  categoryRepository,
} from './category.repository.instance.js';

import {
  createCategoryService,
} from './category.service.js';

export const categoryService =
  createCategoryService(
    categoryRepository,
  );