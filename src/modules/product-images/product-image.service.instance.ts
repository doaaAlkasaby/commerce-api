import {
  productRepository,
} from '../products/product.repository.instance.js';

import {
  productImageRepository,
} from './product-image.repository.instance.js';

import {
  createProductImageService,
} from './product-image.service.js';

export const productImageService =
  createProductImageService(
    productImageRepository,
    productRepository,
  );