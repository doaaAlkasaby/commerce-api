import {
  calculateEffectivePrice,
  toCents,
} from '../../common/pricing/pricing.service.js';
import type { ProductRepository } from './product.repository.js';
import type { ProductCardResponse } from './product.types.js';

type ProductDetails = NonNullable<
  Awaited<ReturnType<ProductRepository['findById']>>
>;
type ProductListItem = Awaited<
  ReturnType<ProductRepository['findList']>
>['items'][number];
type ProductVariant = ProductDetails['variants'][number];
type ProductCardRecord = Awaited<
  ReturnType<ProductRepository['findOffers']>
>['items'][number];
type DiscountEntity = Pick<
  ProductDetails,
  'discountType' | 'discountValue' | 'discountStartsAt' | 'discountEndsAt'
>;

type ProductEnrichedFields = {
  rating: {
    average: number;
    count: number;
  };
  isInWishlist: boolean;
};

export const mapProductListItem = (product: ProductListItem) => {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    status: product.status,

    basePrice: product.basePrice.toString(),

    discountType: product.discountType,

    discountValue: product.discountValue?.toString() ?? null,

    discountStartsAt: product.discountStartsAt,

    discountEndsAt: product.discountEndsAt,

    primaryImage: product.images[0]
      ? {
          id: product.images[0].id,
          url: product.images[0].url,
          altText: product.images[0].altText,
        }
      : null,

    category: product.category,
    brand: product.brand,
  };
};

const mapDiscount = (entity: DiscountEntity) => {
  return {
    type: entity.discountType ?? null,

    value: entity.discountValue?.toString() ?? null,

    startsAt: entity.discountStartsAt ?? null,

    endsAt: entity.discountEndsAt ?? null,
  };
};

const mapVariant = (variant: ProductVariant, product: ProductDetails) => {
  const effectivePrice = calculateEffectivePrice(
    variant.price?.toString() ?? product.basePrice.toString(),
    mapDiscount(product),
    mapDiscount(variant),
  );

  return {
    id: variant.id,
    sku: variant.sku,

    price: variant.price?.toString() ?? null,

    isActive: variant.isActive,

    discount: mapDiscount(variant),

    pricing: effectivePrice,

    combinationKey: variant.combinationKey,

    attributes: variant.values.map((item) => ({
      attributeId: item.attributeValue.attribute.id,

      attributeName: item.attributeValue.attribute.name,

      attributeValueId: item.attributeValue.id,

      value: item.attributeValue.value,
    })),

    images: variant.images.map((image) => ({
      id: image.id,
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),

    inventory: variant.inventory
      ? {
          id: variant.inventory.id,

          quantity: variant.inventory.quantity,

          reservedQuantity: variant.inventory.reservedQuantity,

          availableQuantity:
            variant.inventory.quantity - variant.inventory.reservedQuantity,
        }
      : null,
  };
};

export const mapProductDetails = (product: ProductDetails) => {
  const productPricing = calculateEffectivePrice(
    product.basePrice.toString(),
    mapDiscount(product),
    {
      type: null,
      value: null,
      startsAt: null,
      endsAt: null,
    },
  );

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    status: product.status,

    basePrice: product.basePrice.toString(),

    discount: mapDiscount(product),

    pricing: productPricing,

    category: product.category,
    brand: product.brand,

    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),

    attributes: product.attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      sortOrder: attribute.sortOrder,

      values: attribute.values.map((value) => ({
        id: value.id,
        value: value.value,
        sortOrder: value.sortOrder,
        imageStorageKey: value.imageStorageKey,
        imageUrl: value.imageUrl,
      })),
    })),

    variants: product.variants.map((variant) => mapVariant(variant, product)),

    createdAt: product.createdAt,

    updatedAt: product.updatedAt,
  };
};

export function mapProductCard(
    product: ProductCardRecord & ProductEnrichedFields,

): ProductCardResponse {
  const productDiscount = {
    type: product.discountType,
    value: product.discountValue?.toString() ?? null,
    startsAt: product.discountStartsAt,
    endsAt: product.discountEndsAt,
  };
  const variants = product.variants.length > 0 ? product.variants : [null];
  const pricing = variants
    .map((variant) =>
      calculateEffectivePrice(
        variant?.price?.toString() ?? product.basePrice.toString(),
        productDiscount,
        variant
          ? {
              type: variant.discountType,
              value: variant.discountValue?.toString() ?? null,
              startsAt: variant.discountStartsAt,
              endsAt: variant.discountEndsAt,
            }
          : {
              type: null,
              value: null,
              startsAt: null,
              endsAt: null,
            },
      ),
    )
    .sort((left, right) => {
      const leftPrice = toCents(left.finalPrice);
      const rightPrice = toCents(right.finalPrice);
      return leftPrice < rightPrice ? -1 : leftPrice > rightPrice ? 1 : 0;
    })[0];

  if (!pricing) {
    throw new Error('Unable to calculate product card pricing');
  }

  const baseCents = toCents(pricing.basePrice);
  const discountCents = toCents(pricing.discountAmount);
  const discountPercentage =
    pricing.discountType === null || baseCents === 0n
      ? null
      : Number((discountCents * 10_000n + baseCents / 2n) / baseCents) / 100;

      const variantInfo = getProductVariantInfo(product);

  return {
    id: product.id,

    name: product.name,

    slug: product.slug,
    rating: product.rating,

  isInWishlist: product.isInWishlist,

    price: {
      original: pricing.basePrice,
      final: pricing.finalPrice,
      discountPercentage,
    },

    image: product.images[0]?.url ?? null,

    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          slug: product.category.slug,
        }
      : null,

    brand: product.brand
      ? {
          id: product.brand.id,
          name: product.brand.name,
          slug: product.brand.slug,
        }
      : null,

      hasVariants: variantInfo.hasVariants,

  defaultVariantId: variantInfo.defaultVariantId,
  };
}

function getProductVariantInfo(
  product: {
    variants: Array<{
      id: string;
      isDefault: boolean;
      isActive: boolean;
    }>;
  },
) {
  const activeVariants = product.variants.filter(
    (variant) => variant.isActive,
  );

  const defaultVariant =
    activeVariants.find(
      (variant) => variant.isDefault,
    ) ?? null;

  const selectableVariants =
    activeVariants.filter(
      (variant) => !variant.isDefault,
    );

  return {
    hasVariants: selectableVariants.length > 0,
    defaultVariantId:
      selectableVariants.length === 0
        ? defaultVariant?.id ?? null
        : null,
  };
}