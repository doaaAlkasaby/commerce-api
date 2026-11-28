import {
  calculateEffectivePrice,
  toCents,
} from '../../common/pricing/pricing.service.js';
import type { ProductRepository } from './product.repository.js';
import type { ProductCardResponse } from './product.types.js';

type ProductDetails = NonNullable<
  Awaited<ReturnType<ProductRepository['findPublicById']>>
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

/**
 * Variant Selection Policy for Product Listing Display Pricing:
 * 1. If an active default variant (isDefault=true, isActive=true) exists, use its price & discount.
 * 2. If no active default variant exists, select the active variant with the lowest effective final price.
 *    (Ties broken deterministically by variant ID).
 * 3. If no active variants exist, fall back to product-level base price and discount.
 */
export const mapProductListItem = (product: ProductListItem) => {
  const currency = product.tenant.defaultCurrency ?? '';
  const productDiscount = mapDiscount(product);
  const activeVariants = (product.variants ?? []).filter((v) => v.isActive);

  let targetVariant = activeVariants.find((v) => v.isDefault) ?? null;

  if (!targetVariant && activeVariants.length > 0) {
    const calculatedVariants = activeVariants
      .map((variant) => ({
        variant,
        pricing: calculateEffectivePrice(
          variant.price?.toString() ?? product.basePrice.toString(),
          productDiscount,
          mapDiscount(variant),
          new Date(),
          currency,
        ),
      }))
      .sort((a, b) => {
        const aCents = toCents(a.pricing.finalPrice, currency);
        const bCents = toCents(b.pricing.finalPrice, currency);
        return aCents < bCents ? -1 : aCents > bCents ? 1 : a.variant.id.localeCompare(b.variant.id);
      });
    targetVariant = calculatedVariants[0]?.variant ?? null;
  }

  const effectivePricing = calculateEffectivePrice(
    targetVariant?.price?.toString() ?? product.basePrice.toString(),
    productDiscount,
    targetVariant ? mapDiscount(targetVariant) : { type: null, value: null, startsAt: null, endsAt: null },
    new Date(),
    currency,
  );

  const baseCents = toCents(effectivePricing.basePrice, currency);
  const discountCents = toCents(effectivePricing.discountAmount, currency);
  const discountPercentage =
    effectivePricing.discountType === null || baseCents === 0n
      ? null
      : Number((discountCents * 10_000n + baseCents / 2n) / baseCents) / 100;

  const variantInfo = getProductVariantInfo(product);

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

    displayPricing: {
      originalPrice: effectivePricing.basePrice,
      finalPrice: effectivePricing.finalPrice,
      discountType: effectivePricing.discountType,
      discountValue: effectivePricing.discountValue,
      discountAmount: effectivePricing.discountAmount,
      discountPercentage,
    },

    primaryImage: product.images[0]
      ? {
          id: product.images[0].id,
          url: product.images[0].url,
          altText: product.images[0].altText,
        }
      : null,

    category: product.category,
    brand: product.brand,

    hasVariants: variantInfo.hasVariants,
    defaultVariantId: variantInfo.defaultVariantId,
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
  const stock = variant.inventory
    .slice()
    .sort(
      (a, b) =>
        b.quantity - b.reservedQuantity - (a.quantity - a.reservedQuantity) ||
        a.id.localeCompare(b.id),
    )[0];
  const effectivePrice = calculateEffectivePrice(
    variant.price?.toString() ?? product.basePrice.toString(),
    mapDiscount(product),
    mapDiscount(variant),
    new Date(),
    product.tenant.defaultCurrency ?? '',
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

    inventory: stock
      ? {
          id: stock.id,

          quantity: stock.quantity,

          reservedQuantity: stock.reservedQuantity,

          availableQuantity: stock.quantity - stock.reservedQuantity,
        }
      : null,
  };
};

export const mapProductDetails = (product: ProductDetails) => {
  const activeVariants = product.variants.filter((variant) => variant.isActive);
  const activeAttributeValueIds = new Set<string>();
  for (const variant of activeVariants) {
    for (const item of variant.values) {
      activeAttributeValueIds.add(item.attributeValue.id);
    }
  }

  const productPricing = calculateEffectivePrice(
    product.basePrice.toString(),
    mapDiscount(product),
    {
      type: null,
      value: null,
      startsAt: null,
      endsAt: null,
    },
    new Date(),
    product.tenant.defaultCurrency ?? '',
  );

  const publicAttributes = product.attributes
    .map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      sortOrder: attribute.sortOrder,

      values: attribute.values
        .filter((value) => activeAttributeValueIds.has(value.id))
        .map((value) => ({
          id: value.id,
          value: value.value,
          sortOrder: value.sortOrder,
          imageUrl: value.imageUrl,
        })),
    }))
    .filter((attribute) => attribute.values.length > 0);

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

    attributes: publicAttributes,

    variants: activeVariants.map((variant) => mapVariant(variant, product)),

    createdAt: product.createdAt,

    updatedAt: product.updatedAt,
  };
};

export interface ProductCardPricingInput {
  tenant: {
    defaultCurrency: string | null;
  };
  basePrice: { toString(): string } | string;
  discountType: ProductCardRecord['discountType'];
  discountValue: ProductCardRecord['discountValue'];
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;
  variants: Array<{
    price: { toString(): string } | string | null;
    isActive: boolean;
    discountType: ProductCardRecord['discountType'];
    discountValue: ProductCardRecord['discountValue'];
    discountStartsAt: Date | null;
    discountEndsAt: Date | null;
  }>;
}

export interface ProductCardMapperInput extends ProductCardPricingInput {
  id: string;
  name: string;
  slug: string;
  images: Array<{ url: string }>;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  variants: Array<{
    id: string;
    price: { toString(): string } | string | null;
    isActive: boolean;
    isDefault: boolean;
    discountType: ProductCardRecord['discountType'];
    discountValue: ProductCardRecord['discountValue'];
    discountStartsAt: Date | null;
    discountEndsAt: Date | null;
  }>;
}

export function calculateProductCardEffectivePrice(
  product: ProductCardPricingInput,
  now: Date = new Date(),
) {
  const productDiscount = {
    type: product.discountType,
    value: product.discountValue?.toString() ?? null,
    startsAt: product.discountStartsAt,
    endsAt: product.discountEndsAt,
  };
  const activeVariants = product.variants.filter((variant) => variant.isActive);
  const variants = activeVariants.length > 0 ? activeVariants : [null];
  const currency = product.tenant.defaultCurrency ?? '';
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
        now,
        currency,
      ),
    )
    .sort((left, right) => {
      const leftPrice = toCents(left.finalPrice, currency);
      const rightPrice = toCents(right.finalPrice, currency);
      return leftPrice < rightPrice ? -1 : leftPrice > rightPrice ? 1 : 0;
    })[0];

  if (!pricing) {
    throw new Error('Unable to calculate product card pricing');
  }

  return pricing;
}

export function mapProductCard(
  product: ProductCardMapperInput & ProductEnrichedFields,
): ProductCardResponse {
  return mapProductCardAt(product, new Date());
}

export function mapProductCardAt(
  product: ProductCardMapperInput & ProductEnrichedFields,
  now: Date,
): ProductCardResponse {
  const pricing = calculateProductCardEffectivePrice(product, now);

  const baseCents = toCents(
    pricing.basePrice,
    product.tenant.defaultCurrency ?? '',
  );
  const discountCents = toCents(
    pricing.discountAmount,
    product.tenant.defaultCurrency ?? '',
  );
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

function getProductVariantInfo(product: {
  variants: Array<{
    id: string;
    isDefault: boolean;
    isActive: boolean;
  }>;
}) {
  const activeVariants = product.variants.filter((variant) => variant.isActive);

  const defaultVariant =
    activeVariants.find((variant) => variant.isDefault) ?? null;

  const selectableVariants = activeVariants.filter(
    (variant) => !variant.isDefault,
  );

  return {
    hasVariants: selectableVariants.length > 0,
    defaultVariantId:
      selectableVariants.length === 0 ? (defaultVariant?.id ?? null) : null,
  };
}
