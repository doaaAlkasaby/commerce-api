import { productRepository } from './product.repository.instance.js';
import { ProductService } from './product.service.js';

export const productService = new ProductService(productRepository);
