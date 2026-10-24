import {
  brandRepository,
} from './brand.repository.instance.js';

import {
  createBrandService,
} from './brand.service.js';

export const brandService =
  createBrandService(
    brandRepository,
  );