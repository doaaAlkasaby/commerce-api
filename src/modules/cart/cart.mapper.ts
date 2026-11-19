import type {
  Cart,
  CartItem,
  ProductVariant,
} from '../../generated/prisma/client.js';

import {
  calculateEffectivePrice,
  toCents,
  centsToString,
} from '../../common/pricing/pricing.service.js';

import type { DiscountInput } from '../../common/pricing/pricing.types.js';

import type {
  CartItemAttributeResponse,
  CartItemImageResponse,
  CartItemProductResponse,
  CartItemResponse,
  CartItemVariantResponse,
  CartResponse,
} from './cart.types.js';

type CartItemWithRelations = CartItem & {
  variant: ProductVariant & {
    product: {
      id: string;
      name: string;
      slug: string;
      basePrice: {
        toString(): string;
      };
      status: string;

      discountType: DiscountInput['type'];
      discountValue: {
        toString(): string;
      } | null;
      discountStartsAt: Date | null;
      discountEndsAt: Date | null;
    };

    values: Array<{
      attributeValue: {
        id: string;
        value: string;
        imageUrl: string | null;
        attribute: {
          id: string;
          name: string;
        };
      };
    }>;

    images: Array<{
      id: string;
      url: string;
      altText: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }>;
  };
};

type CartWithItems = Cart & {
  items: CartItemWithRelations[];
};

const mapAttributes = (
  variant: CartItemWithRelations['variant'],
): CartItemAttributeResponse[] => {
  return variant.values.map((variantValue) => ({
    attributeId: variantValue.attributeValue.attribute.id,

    attributeName: variantValue.attributeValue.attribute.name,

    attributeValueId: variantValue.attributeValue.id,

    attributeValue: variantValue.attributeValue.value,

    imageUrl: variantValue.attributeValue.imageUrl,
  }));
};

const mapImages = (
  variant: CartItemWithRelations['variant'],
): CartItemImageResponse[] => {
  return variant.images.map((image) => ({
    id: image.id,
    url: image.url,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
  }));
};

const mapProduct = (
  variant: CartItemWithRelations['variant'],
): CartItemProductResponse => {
  const primaryImg = (variant.product as any).images?.find((img: any) => img.isPrimary) ?? (variant.product as any).images?.[0];

  return {
    id: variant.product.id,
    name: variant.product.name,
    slug: variant.product.slug,
    basePrice: variant.product.basePrice.toString(),
    status: variant.product.status,
    imageUrl: primaryImg ? primaryImg.url : null,
  };
};

const calculateItemPricing = (
  variant: CartItemWithRelations['variant'],
  currency: string,
) => {
  /**
   * Variant price overrides Product.basePrice.
   */
  const basePrice =
    variant.price?.toString() ?? variant.product.basePrice.toString();

  const productDiscount: DiscountInput = {
    type: variant.product.discountType,

    value: variant.product.discountValue?.toString() ?? null,

    startsAt: variant.product.discountStartsAt,

    endsAt: variant.product.discountEndsAt,
  };

  const variantDiscount: DiscountInput = {
    type: variant.discountType,

    value: variant.discountValue?.toString() ?? null,

    startsAt: variant.discountStartsAt,

    endsAt: variant.discountEndsAt,
  };

  return calculateEffectivePrice(
    basePrice,
    productDiscount,
    variantDiscount,
    new Date(),
    currency,
  );
};

export const mapCartItem = (
  item: CartItemWithRelations,
  currency = 'USD',
): CartItemResponse => {
  const effectivePrice = calculateItemPricing(item.variant, currency);

  const quantity = BigInt(item.quantity);

  /**
   * Pricing service returns discountAmount
   * per unit.
   */
  const discountPerUnitCents = toCents(effectivePrice.discountAmount, currency);

  const finalUnitPriceCents = toCents(effectivePrice.finalPrice, currency);

  const totalDiscountCents = discountPerUnitCents * quantity;

  const totalPriceCents = finalUnitPriceCents * quantity;

  const variantResponse: CartItemVariantResponse = {
    id: item.variant.id,

    sku: item.variant.sku,

    price: effectivePrice.basePrice,

    isActive: item.variant.isActive,

    discountType: effectivePrice.discountType,

    discountValue: effectivePrice.discountType
      ? effectivePrice.discountValue
      : null,

    attributes: mapAttributes(item.variant),

    images: mapImages(item.variant),

    product: mapProduct(item.variant),
  };

  return {
    id: item.id,

    variantId: item.variantId,

    quantity: item.quantity,

    unitPrice: effectivePrice.basePrice,

    discountAmount: centsToString(totalDiscountCents, currency),

    finalUnitPrice: effectivePrice.finalPrice,

    totalPrice: centsToString(totalPriceCents, currency),

    variant: variantResponse,

    createdAt: item.createdAt.toISOString(),

    updatedAt: item.updatedAt.toISOString(),
  };
};

export const mapCart = (
  cart: CartWithItems,
  currency = 'USD',
): CartResponse => {
  const items = cart.items.map((item) => mapCartItem(item, currency));

  let subtotalCents = 0n;

  for (const item of items) {
    subtotalCents += toCents(item.totalPrice, currency);
  }

  return {
    id: cart.id,

    userId: cart.userId,

    items,

    itemCount: cart.items.reduce((total, item) => total + item.quantity, 0),

    subtotal: centsToString(subtotalCents, currency),

    createdAt: cart.createdAt.toISOString(),

    updatedAt: cart.updatedAt.toISOString(),
  };
};
