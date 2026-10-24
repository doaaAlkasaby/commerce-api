export interface CreateBrandInput {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdateBrandInput {
  name?: string;
  slug?: string;
  description?: string | null;
}

export interface BrandResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadBrandImageInput {
  file: Buffer;
  originalName: string;
  contentType: string;
}