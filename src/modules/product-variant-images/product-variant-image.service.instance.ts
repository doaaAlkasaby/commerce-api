import { storageService } from '../../common/storage/storage.service.js';

import { productVariantRepository } from '../product-variants/product-variant.repository.instance.js';

import { productVariantImageRepository } from './product-variant-image.repository.instance.js';

import { ProductVariantImageService } from './product-variant-image.service.js';

export const productVariantImageService = new ProductVariantImageService(
  productVariantImageRepository,
  storageService,
  productVariantRepository,
);
