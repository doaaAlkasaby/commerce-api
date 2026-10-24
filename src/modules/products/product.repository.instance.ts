import { prisma } from '../../config/database.js';
import { ProductRepository } from './product.repository.js';

export const productRepository = new ProductRepository(prisma);
