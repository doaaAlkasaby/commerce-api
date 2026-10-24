import type { ProductImage } from '../../generated/prisma/client.js';

import type {
  ProductImageResponse,
} from './product-image.types.js';

export const toProductImageResponse = (
  image: ProductImage,
): ProductImageResponse => {
  return {
    id: image.id,
    productId: image.productId,
    storageKey: image.storageKey,
    url: image.url,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
};