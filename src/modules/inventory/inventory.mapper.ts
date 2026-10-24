import type { InventoryWithVariant } from './inventory.repository.js';

import type { InventoryTransaction } from '../../generated/prisma/client.js';

import type {
  InventoryResponse,
  InventoryTransactionResponse,
} from './inventory.types.js';

export const mapInventory = (
  inventory: InventoryWithVariant,
): InventoryResponse => {
  return {
    id: inventory.id,

    variantId: inventory.variantId,

    quantity: inventory.quantity,

    reservedQuantity: inventory.reservedQuantity,

    availableQuantity: inventory.quantity - inventory.reservedQuantity,

    createdAt: inventory.createdAt.toISOString(),

    updatedAt: inventory.updatedAt.toISOString(),

    variant: {
      id: inventory.variant.id,

      sku: inventory.variant.sku,

      isActive: inventory.variant.isActive,

      price:
        inventory.variant.price === null
          ? null
          : String(inventory.variant.price),

      productBasePrice: String(inventory.variant.product.basePrice),

      product: {
        id: inventory.variant.product.id,

        name: inventory.variant.product.name,

        slug: inventory.variant.product.slug,

        status: inventory.variant.product.status,
      },

      attributes: inventory.variant.values.map((item) => ({
        attributeId: item.attributeValue.attribute.id,

        attributeName: item.attributeValue.attribute.name,

        valueId: item.attributeValue.id,

        value: item.attributeValue.value,
      })),

      images: inventory.variant.images.map((image) => ({
        id: image.id,

        url: image.url,

        storageKey: image.storageKey,

        altText: image.altText,

        sortOrder: image.sortOrder,

        isPrimary: image.isPrimary,
      })),
    },
  };
};

export const mapInventoryTransaction = (
  transaction: InventoryTransaction,
): InventoryTransactionResponse => {
  return {
    id: transaction.id,

    inventoryId: transaction.inventoryId,

    type: transaction.type,

    quantity: transaction.quantity,

    referenceId: transaction.referenceId,

    reason: transaction.reason,

    createdAt: transaction.createdAt.toISOString(),
  };
};
