import { prisma } from '../../config/database.js';

import { ProductReviewRepository } from './product-review.repository.js';

export const productReviewRepository = new ProductReviewRepository(prisma);
