import {
  productRepository,
} from '../products/product.repository.instance.js';

import {
  productVariantRepository,
} from './product-variant.repository.instance.js';

import {
  ProductVariantService,
} from './product-variant.service.js';

export const productVariantService =
  new ProductVariantService(
    productVariantRepository,
    productRepository,
  );