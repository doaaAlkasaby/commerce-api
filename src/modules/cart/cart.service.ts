import {
  ProductStatus,
} from '../../generated/prisma/client.js';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  prisma,
} from '../../config/database.js';

import {
  cartRepository,
} from './cart.repository.instance.js';

import {
  mapCart,
} from './cart.mapper.js';

import type {
  AddCartItemInput,
  UpdateCartItemInput,
} from './cart.types.js';

export class CartService {
  /**
   * Get the current user's cart.
   *
   * If the user does not have a cart yet,
   * an empty cart is created.
   */
  async getCart(
    tenantId: string,
    userId: string,
  ) {
    let cart =
      await cartRepository.findByUserId(
        tenantId,
        userId,
      );

    if (!cart) {
      await cartRepository.getOrCreateCart(
        tenantId,
        userId,
      );

      cart =
        await cartRepository.findByUserId(
          tenantId,
          userId,
        );
    }

    if (!cart) {
      throw new AppError(
        'Unable to load cart',
        500,
        'CART_LOAD_FAILED',
      );
    }

    return mapCart(cart);
  }

  /**
   * Add a product variant to cart.
   *
   * Important:
   *
   * Cart DOES NOT reserve inventory.
   *
   * Inventory is reserved during checkout.
   */
  async addItem(
    tenantId: string,
    userId: string,
    input: AddCartItemInput,
  ) {
    const variant =
      await prisma.productVariant.findFirst(
        {
          where: {
            id: input.variantId,
            product: { tenantId },
          },

          include: {
            product: true,
            inventory: true,
          },
        },
      );

    if (!variant) {
      throw new AppError(
        'Product variant not found',
        404,
        'VARIANT_NOT_FOUND',
      );
    }

    /**
     * Product must be active.
     */
    if (
      variant.product.status !==
      ProductStatus.ACTIVE
    ) {
      throw new AppError(
        'Product is not available',
        409,
        'PRODUCT_NOT_AVAILABLE',
      );
    }

    /**
     * Variant must be active.
     */
    if (!variant.isActive) {
      throw new AppError(
        'Product variant is not available',
        409,
        'VARIANT_NOT_AVAILABLE',
      );
    }

    /**
     * Inventory record is required.
     */
    if (!variant.inventory) {
      throw new AppError(
        'Inventory is not configured for this variant',
        409,
        'INVENTORY_NOT_FOUND',
      );
    }

    /**
     * Check how many units are already
     * in the cart.
     */
    const existingItem =
      await cartRepository.findCartItem(
        tenantId,
        userId,
        input.variantId,
      );

    const existingQuantity =
      existingItem?.quantity ?? 0;

    const requestedQuantity =
      existingQuantity +
      input.quantity;

    /**
     * Available stock:
     *
     * physical quantity
     * -
     * already reserved quantity
     *
     * Cart itself does not reserve anything.
     */
    const availableQuantity =
      variant.inventory.quantity -
      variant.inventory.reservedQuantity;

    if (
      requestedQuantity >
      availableQuantity
    ) {
      throw new AppError(
        `Only ${availableQuantity} item(s) are available`,
        409,
        'INSUFFICIENT_INVENTORY',
      );
    }

    await cartRepository.addItem(
      tenantId,
      userId,
      input.variantId,
      input.quantity,
    );

    return this.getCart(tenantId, userId);
  }

  /**
   * Set cart item quantity.
   */
  async updateItem(
    tenantId: string,
    userId: string,
    variantId: string,
    input: UpdateCartItemInput,
  ) {
    const variant =
      await prisma.productVariant.findFirst(
        {
          where: {
            id: variantId,
            product: { tenantId },
          },

          include: {
            product: true,
            inventory: true,
          },
        },
      );

    if (!variant) {
      throw new AppError(
        'Product variant not found',
        404,
        'VARIANT_NOT_FOUND',
      );
    }

    if (
      variant.product.status !==
      ProductStatus.ACTIVE
    ) {
      throw new AppError(
        'Product is not available',
        409,
        'PRODUCT_NOT_AVAILABLE',
      );
    }

    if (!variant.isActive) {
      throw new AppError(
        'Product variant is not available',
        409,
        'VARIANT_NOT_AVAILABLE',
      );
    }

    if (!variant.inventory) {
      throw new AppError(
        'Inventory is not configured for this variant',
        409,
        'INVENTORY_NOT_FOUND',
      );
    }

    const existingItem =
      await cartRepository.findCartItem(
        tenantId,
        userId,
        variantId,
      );

    if (!existingItem) {
      throw new AppError(
        'Cart item not found',
        404,
        'CART_ITEM_NOT_FOUND',
      );
    }

    const availableQuantity =
      variant.inventory.quantity -
      variant.inventory.reservedQuantity;

    if (
      input.quantity >
      availableQuantity
    ) {
      throw new AppError(
        `Only ${availableQuantity} item(s) are available`,
        409,
        'INSUFFICIENT_INVENTORY',
      );
    }

    const result =
      await cartRepository.updateItem(
        tenantId,
        userId,
        variantId,
        input.quantity,
      );

    if (result.count === 0) {
      throw new AppError(
        'Cart item not found',
        404,
        'CART_ITEM_NOT_FOUND',
      );
    }

    return this.getCart(tenantId, userId);
  }

  /**
   * Remove one variant from cart.
   */
  async removeItem(
    tenantId: string,
    userId: string,
    variantId: string,
  ) {
    const result =
      await cartRepository.removeItem(
        tenantId,
        userId,
        variantId,
      );

    if (result.count === 0) {
      throw new AppError(
        'Cart item not found',
        404,
        'CART_ITEM_NOT_FOUND',
      );
    }

    return this.getCart(tenantId, userId);
  }

  /**
   * Clear the complete cart.
   */
  async clearCart(
    tenantId: string,
    userId: string,
  ) {
    await cartRepository.clearCart(
      tenantId,
      userId,
    );

    return this.getCart(tenantId, userId);
  }
}
