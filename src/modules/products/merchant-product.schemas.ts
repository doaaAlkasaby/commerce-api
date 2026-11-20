import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination/pagination.js';
import { ProductStatus } from '../../generated/prisma/client.js';

export const merchantProductQuery = paginationQuerySchema
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    status: z.enum(ProductStatus).optional(),
    categoryId: z.uuid().optional(),
    brandId: z.uuid().optional(),
    sortBy: z
      .enum(['createdAt', 'updatedAt', 'name', 'basePrice'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type MerchantProductQuery = z.infer<typeof merchantProductQuery>;
