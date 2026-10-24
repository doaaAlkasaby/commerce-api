import { AppError } from '../../common/errors/app-error.js';

import type { WishlistRepository } from './wishlist.repository.js';
import { mapWishlistItem } from './wishlist.mapper.js';

export class WishlistService {
  constructor(
    private readonly repository: WishlistRepository,
  ) {}

  async getWishlist(userId: string) {
    const wishlist =
      await this.repository.findOrCreateForUser(
        userId,
      );

    const items =
      await this.repository.findItems(
        wishlist.id,
      );

    return {
      id: wishlist.id,
      items: items.map(mapWishlistItem),
      count: items.length,
    };
  }

  async addProduct(
    userId: string,
    productId: string,
  ) {
    const product =
      await this.repository.findProduct(
        productId,
      );

    if (!product) {
      throw new AppError(
        'Product not found',
        404,
        'PRODUCT_NOT_FOUND',
      );
    }

    const wishlist =
      await this.repository.findOrCreateForUser(
        userId,
      );

    const existing =
      await this.repository.findItem(
        wishlist.id,
        productId,
      );

    if (existing) {
      throw new AppError(
        'Product is already in your wishlist',
        409,
        'PRODUCT_ALREADY_IN_WISHLIST',
      );
    }

    const item =
      await this.repository.addItem(
        wishlist.id,
        productId,
      );

    return {
      id: item.id,
      productId: item.productId,
      addedAt: item.createdAt,
    };
  }

  async removeProduct(
    userId: string,
    productId: string,
  ) {
    const wishlist =
      await this.repository.findByUserId(
        userId,
      );

    if (!wishlist) {
      throw new AppError(
        'Wishlist not found',
        404,
        'WISHLIST_NOT_FOUND',
      );
    }

    const existing =
      await this.repository.findItem(
        wishlist.id,
        productId,
      );

    if (!existing) {
      throw new AppError(
        'Product is not in your wishlist',
        404,
        'PRODUCT_NOT_IN_WISHLIST',
      );
    }

    await this.repository.removeItem(
      wishlist.id,
      productId,
    );

    return null;
  }

  async isProductInWishlist(
    userId: string,
    productId: string,
  ) {
    const wishlist =
      await this.repository.findByUserId(
        userId,
      );

    if (!wishlist) {
      return {
        productId,
        isInWishlist: false,
      };
    }

    const item =
      await this.repository.findItem(
        wishlist.id,
        productId,
      );

    return {
      productId,
      isInWishlist: Boolean(item),
    };
  }
}