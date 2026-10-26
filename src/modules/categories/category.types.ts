export interface CreateCategoryInput {
  name: string;
  slug: string;
  description?: string;
  parentId?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
}

export interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  hasChildren: boolean;
  parentId: string | null;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}


export interface CategoryImage {
  storageKey: string;
  url: string;
}

export interface UploadCategoryImageInput {
  file: Buffer;
  originalName: string;
  contentType: string;
}
