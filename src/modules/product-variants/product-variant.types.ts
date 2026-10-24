import type {
  DiscountType,
  ProductStatus,
} from '../../generated/prisma/client.js';

export interface VariantDiscountInput {
  type: DiscountType;
  value: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface CreateProductVariantInput {
  productId: string;
  sku: string;
  price?: string | null;
  isActive?: boolean;
  discount?: VariantDiscountInput | null;
  attributeValueIds: string[];
}

export interface UpdateProductVariantInput {
  sku?: string;
  price?: string | null;
  isActive?: boolean;
  discount?: VariantDiscountInput | null;
  attributeValueIds?: string[];
}

export interface ProductVariantAttributeResponse {
  id: string;
  name: string;
  valueId: string;
  value: string;

  image: {
    storageKey: string;
    url: string;
  } | null;
}

export interface ProductVariantImageResponse {
  id: string;
  variantId: string;
  storageKey: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVariantResponse {
  id: string;
  productId: string;
  sku: string;

  price: string | null;

  effectivePrice: {
    basePrice: string;
    discountType: DiscountType | null;
    discountValue: string;
    discountAmount: string;
    finalPrice: string;
  };

  isActive: boolean;

  attributes: ProductVariantAttributeResponse[];

  images: ProductVariantImageResponse[];

  product: {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
  };

  createdAt: Date;
  updatedAt: Date;
}