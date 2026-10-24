import { productCollectionRepository } from './product-collection.repository.instance.js';
import { ProductCollectionService } from './product-collection.service.js';
import { productRepository } from '../products/product.repository.instance.js';

export const productCollectionService = new ProductCollectionService(
  productCollectionRepository,
  productRepository,
);
