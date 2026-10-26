import {
  calculateEffectivePrice,
  toCents,
} from '../../common/pricing/pricing.service.js';

import type { ProductRepository } from '../products/product.repository.js';

import type {
  HomeBanner,
  HomeBrand,
  HomeCategory,
  HomeCategoryRecord,
  HomeProduct,
} from './home.types.js';

type HomeProductRecord = Awaited<
  ReturnType<ProductRepository['findNewArrivals']>
>['items'][number];

export function mapHomeBanner(banner: HomeBanner): HomeBanner {
  return {
    id: banner.id,
    title: banner.title,
    subtitle: banner.subtitle,
    imageUrl: banner.imageUrl,
    mobileImageUrl: banner.mobileImageUrl,
    targetType: banner.targetType,
    targetId: banner.targetId,
    actionUrl: banner.actionUrl,
  };
}

export function mapHomeCategory(category: HomeCategoryRecord): HomeCategory {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    imageUrl: category.imageUrl,
hasChildren: category._count.children > 0,
  };
}

export function mapHomeBrand(brand: HomeBrand): HomeBrand {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    imageUrl: brand.imageUrl,
  };
}

/**
 * Determines whether the product requires the user to select
 * a variant before adding it to the cart.
 *
 * Product variants are handled in two ways:
 *
 * 1. Selectable variants:
 *    Example:
 *      Size S / Black
 *      Size M / Black
 *      Size L / Black
 *
 *    These variants have isDefault = false.
 *
 * 2. Default variant:
 *    Used for products without selectable options.
 *    Example:
 *      Wireless Headphones
 *
 *    This variant has isDefault = true.
 */
function getVariantSelectionInfo(product: HomeProductRecord) {
  const activeVariants = product.variants.filter(
    (variant) => variant.isActive,
  );

  const hasSelectableVariants = activeVariants.some(
    (variant) => variant.values.length > 0,
  );

  const defaultVariant =
    activeVariants.find(
      (variant) => variant.isDefault,
    ) ?? null;

  return {
    hasVariants: hasSelectableVariants,
    defaultVariantId: defaultVariant?.id ?? null,
  };
}

export function mapHomeProduct(
  product: HomeProductRecord & {
    rating: {
      average: number;
      count: number;
    };
    isInWishlist: boolean;
  },
): HomeProduct {
  const productDiscount = {
    type: product.discountType,
    value: product.discountValue?.toString() ?? null,
    startsAt: product.discountStartsAt,
    endsAt: product.discountEndsAt,
  };

  const candidates =
    product.variants.length > 0
      ? product.variants.map((variant) =>
          calculateEffectivePrice(
            variant.price?.toString() ?? product.basePrice.toString(),
            productDiscount,
            {
              type: variant.discountType,
              value: variant.discountValue?.toString() ?? null,
              startsAt: variant.discountStartsAt,
              endsAt: variant.discountEndsAt,
            },
          ),
        )
      : [
          calculateEffectivePrice(
            product.basePrice.toString(),
            productDiscount,
            {
              type: null,
              value: null,
              startsAt: null,
              endsAt: null,
            },
          ),
        ];

  const pricing = candidates.reduce((lowest, current) =>
    toCents(current.finalPrice) < toCents(lowest.finalPrice)
      ? current
      : lowest,
  );

  const baseCents = toCents(pricing.basePrice);
  const discountCents = toCents(pricing.discountAmount);

  const discountPercentage =
    pricing.discountType === null || baseCents === 0n
      ? null
      : Number(
          (discountCents * 10_000n + baseCents / 2n) / baseCents,
        ) / 100;

        const variantInfo =
    getVariantSelectionInfo(product);


  return {
    id: product.id,
    name: product.name,
    slug: product.slug,

    price: {
      original: pricing.basePrice.toString(),
      final: pricing.finalPrice,
      discountPercentage,
    },

    image:
      product.images.find((image) => image.isPrimary)?.url ??
      product.images[0]?.url ??
      null,

    rating: product.rating,

    isInWishlist: product.isInWishlist,

    /*
     * NEW
     */
    hasVariants:
      variantInfo.hasVariants,

    /*
     * NEW
     */
    defaultVariantId:
      variantInfo.defaultVariantId,

  };
}