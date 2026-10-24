import { prisma } from '../../config/database.js';
import { ProductCollectionRepository } from './product-collection.repository.js';

export const productCollectionRepository = new ProductCollectionRepository(
  prisma,
);
