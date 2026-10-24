import type { Prisma } from '../../generated/prisma/client.js';

import {
  calculateEffectivePrice,
} from '../../common/pricing/pricing.service.js';

export const productVariantDetailsSelect = {
  id: true,
  productId: true,
  sku: true,
  price: true,
  isActive: true,

  discountType: true,
  discountValue: true,
  discountStartsAt: true,
  discountEndsAt: true,

  combinationKey: true,

  createdAt: true,
  updatedAt: true,

  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,

      basePrice: true,

      discountType: true,
      discountValue: true,
      discountStartsAt: true,
      discountEndsAt: true,
    },
  },

  values: {
    select: {
      attributeValue: {
        select: {
          id: true,
          value: true,

          imageStorageKey: true,
          imageUrl: true,

          attribute: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },

  images: {
    orderBy: [
      {
        isPrimary: 'desc' as const,
      },
      {
        sortOrder: 'asc' as const,
      },
      {
        createdAt: 'asc' as const,
      },
    ],

    select: {
      id: true,
      variantId: true,
      storageKey: true,
      url: true,
      altText: true,
      sortOrder: true,
      isPrimary: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProductVariantSelect;

export type ProductVariantDetails =
  Prisma.ProductVariantGetPayload<{
    select:
      typeof productVariantDetailsSelect;
  }>;

export const toProductVariantResponse = (
  variant: ProductVariantDetails,
) => {
  const effectiveBasePrice =
    variant.price ??
    variant.product.basePrice;

  const effectivePrice =
    calculateEffectivePrice(
      effectiveBasePrice.toString(),

      {
        type:
          variant.product
            .discountType,

        value:
          variant.product
            .discountValue
            ?.toString() ?? null,

        startsAt:
          variant.product
            .discountStartsAt,

        endsAt:
          variant.product
            .discountEndsAt,
      },

      {
        type:
          variant.discountType,

        value:
          variant.discountValue
            ?.toString() ?? null,

        startsAt:
          variant.discountStartsAt,

        endsAt:
          variant.discountEndsAt,
      },
    );

  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,

    price:
      variant.price?.toString() ??
      null,

    effectivePrice,

    isActive:
      variant.isActive,

    attributes:
      variant.values.map(
        ({ attributeValue }) => ({
          id:
            attributeValue
              .attribute.id,

          name:
            attributeValue
              .attribute.name,

          valueId:
            attributeValue.id,

          value:
            attributeValue.value,

          image:
            attributeValue.imageUrl
              ? {
                  storageKey:
                    attributeValue
                      .imageStorageKey!,
                  url:
                    attributeValue
                      .imageUrl,
                }
              : null,
        }),
      ),

    images:
      variant.images.map(
        (image) => ({
          id: image.id,
          variantId:
            image.variantId,

          storageKey:
            image.storageKey,

          url: image.url,

          altText:
            image.altText,

          sortOrder:
            image.sortOrder,

          isPrimary:
            image.isPrimary,

          createdAt:
            image.createdAt,

          updatedAt:
            image.updatedAt,
        }),
      ),

    product: {
      id: variant.product.id,
      name: variant.product.name,
      slug: variant.product.slug,
      status: variant.product.status,
    },

    createdAt:
      variant.createdAt,

    updatedAt:
      variant.updatedAt,
  };
};