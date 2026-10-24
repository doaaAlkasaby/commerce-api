export interface CreateProductImageInput {
  productId: string;
  storageKey: string;
  url: string;
  altText?: string | null | undefined;
  sortOrder?: number | undefined;
  isPrimary?: boolean | undefined;
}

export interface UpdateProductImageInput {
  altText?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface ProductImageResponse {
  id: string;
  productId: string;
  storageKey: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadProductImageInput {
  productId: string;
  file: Buffer;
  originalName: string;
  contentType: string;
  altText?: string | null | undefined;
  sortOrder?: number | undefined;
  isPrimary?: boolean | undefined;
}