import { wishlistRepository } from '../wishlist/wishlist.repository.instance.js';

import {
  productReviewRepository,
} from '../product-reviews/product-review.repository.instance.js';

export interface ProductRating {
  average: number;
  count: number;
}

export interface ProductEnrichment {
  rating: ProductRating;
  isInWishlist: boolean;
}

export interface ProductEnrichmentMap {
  [productId: string]: ProductEnrichment;
}

export class ProductEnrichmentService {
  async enrichProducts<T extends { id: string }>(
    products: T[],
    tenantId: string,
    userId?: string,
  ): Promise<
    Array<
      T & {
        rating: ProductRating;
        isInWishlist: boolean;
      }
    >
  > {
    if (products.length === 0) {
      return [];
    }

    const productIds = products.map(
      (product) => product.id,
    );

    const [ratingRows, wishlistProductIds] =
      await Promise.all([
        productReviewRepository.getRatingSummaries(
          tenantId,
          productIds,
        ),

        userId
          ? wishlistRepository.findProductIdsByUser(
              tenantId,
              userId,
              productIds,
            )
          : Promise.resolve([]),
      ]);

    const ratingMap = new Map<
      string,
      ProductRating
    >();

    for (const row of ratingRows) {
      ratingMap.set(row.productId, {
        average: Number(
          row.average.toFixed(2),
        ),
        count: row.count,
      });
    }

    const wishlistSet = new Set(
      wishlistProductIds,
    );

    return products.map((product) => ({
      ...product,

      rating:
        ratingMap.get(product.id) ?? {
          average: 0,
          count: 0,
        },

      isInWishlist:
        userId !== undefined
          ? wishlistSet.has(product.id)
          : false,
    }));
  }
}

export const productEnrichmentService =
  new ProductEnrichmentService();
