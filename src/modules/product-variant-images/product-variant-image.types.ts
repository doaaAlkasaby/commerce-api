export interface CreateProductVariantImageInput {
  variantId: string;
  storageKey: string;
  url: string;
  altText?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
}

export interface UpdateProductVariantImageInput {
  altText?: string | null;
  sortOrder?: number;
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