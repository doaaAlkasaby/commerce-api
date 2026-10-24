import type {
  DiscountType,
} from '../../generated/prisma/client.js';

export interface AddCartItemInput {
  variantId: string;
  quantity: number;
}

export interface UpdateCartItemInput {
  quantity: number;
}

export interface CartItemAttributeResponse {
  attributeId: string;
  attributeName: string;
  attributeValueId: string;
  attributeValue: string;
  imageUrl: string | null;
}

export interface CartItemImageResponse {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface CartItemProductResponse {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  status: string;
}

export interface CartItemVariantResponse {
  id: string;
  sku: string;
  price: string;
  isActive: boolean;
  discountType: DiscountType | null;
  discountValue: string | null;
  attributes: CartItemAttributeResponse[];
  images: CartItemImageResponse[];
  product: CartItemProductResponse;
}

export interface CartItemResponse {
  id: string;
  variantId: string;
  quantity: number;

  unitPrice: string;
  discountAmount: string;
  finalUnitPrice: string;
  totalPrice: string;

  variant: CartItemVariantResponse;

  createdAt: string;
  updatedAt: string;
}

export interface CartResponse {
  id: string;
  userId: string;

  items: CartItemResponse[];

  itemCount: number;
  subtotal: string;

  createdAt: string;
  updatedAt: string;
}