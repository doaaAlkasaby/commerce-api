import type {
  Brand,
} from '../../generated/prisma/client.js';

import type {
  BrandResponse,
} from './brand.types.js';

export const toBrandResponse = (
  brand: Brand,
): BrandResponse => {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    description: brand.description,
    imageUrl: brand.imageUrl,
    isActive: brand.isActive,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
  };
};