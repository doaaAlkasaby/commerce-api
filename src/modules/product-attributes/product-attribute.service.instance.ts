import { productRepository } from '../products/product.repository.instance.js';

import {
  productAttributeRepository,
} from './product-attribute.repository.instance.js';

import {
  ProductAttributeService,
} from './product-attribute.service.js';

export const productAttributeService =
  new ProductAttributeService(
    productAttributeRepository,
    productRepository,
  );