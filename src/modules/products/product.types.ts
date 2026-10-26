import type {
  DiscountType,
  ProductStatus,
} from '../../generated/prisma/client.js';
import type { ProductImageResponse } from '../product-images/product-image.types.js';

export interface ProductDiscountInput {
  type: DiscountType;
  value: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface CreateProductInput {
  name: string;
  slug: string;
  description?: string | null;
  basePrice: string;
  categoryId: string;
  brandId?: string | null;
  discount?: ProductDiscountInput | null;
}

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  description?: string | null;
  basePrice?: string;
  categoryId?: string;
  brandId?: string | null;
  discount?: ProductDiscountInput | null;
}

export interface ProductListQuery {
  page: number;
  limit: number;
  search?: string | undefined;
  categoryId?: string | undefined;
  brandId?: string | undefined;
  minPrice?: string | undefined;
  maxPrice?: string | undefined;
  sortBy: 'createdAt' | 'name' | 'basePrice';
  sortOrder: 'asc' | 'desc';
}

export interface UpdateProductStatusInput {
  status: ProductStatus;
}

export interface ProductDiscountResponse {
  type: DiscountType | null;
  value: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface ProductImageSummary {
  id: string;
  url: string;
  altText: string | null;
}

export interface ProductCategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface ProductBrandSummary {
  id: string;
  name: string;
  slug: string;
}

export interface ProductListItemResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  discount: ProductDiscountResponse;
  status: ProductStatus;
  primaryImage: ProductImageSummary | null;
  category: ProductCategorySummary | null;
  brand: ProductBrandSummary | null;
  rating: ProductRating;
  isInWishlist: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductDetailsResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  discount: ProductDiscountResponse;
  status: ProductStatus;
  category: ProductCategorySummary | null;
  brand: ProductBrandSummary | null;
  images: ProductImageResponse[];
  rating: ProductRating;
  isInWishlist: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProductStatus;

  basePrice: string;

  discountType: DiscountType | null;
  discountValue: string | null;
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;

  rating: ProductRating;
  isInWishlist: boolean;

  primaryImage: {
    id: string;
    url: string;
    altText: string | null;
  } | null;

  category: {
    id: string;
    name: string;
    slug: string;
  };

  brand: {
    id: string;
    name: string;
    slug: string;
  } | null;

  hasVariants: boolean;
defaultVariantId: string | null;
}

export interface ProductPriceResponse {
  original: string;
  final: string;
  discountPercentage: number | null;
}

export interface ProductCardResponse {
  id: string;
  name: string;
  slug: string;

  price: ProductPriceResponse;

  image: string | null;

  rating: ProductRating;
  isInWishlist: boolean;
  
  category: {
    id: string;
    name: string;
    slug: string;
  } | null;

  brand: {
    id: string;
    name: string;
    slug: string;
  } | null;

  hasVariants: boolean;
defaultVariantId: string | null;
}

export interface PaginatedProductsResponse {
  items: ProductCardResponse[];

  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ProductRating {
  average: number;
  count: number;
}

export interface ProductVariantSelectionInfo {
  hasVariants: boolean;
  defaultVariantId: string | null;
}