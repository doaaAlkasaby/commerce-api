export interface CreateProductCollectionInput {
  name: string;
  slug: string;
  description?: string | null | undefined;
  imageStorageKey?: string | null | undefined;
  imageUrl?: string | null | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
}

export interface UpdateProductCollectionInput {
  name?: string | undefined;
  slug?: string | undefined;
  description?: string | null | undefined;
  imageStorageKey?: string | null | undefined;
  imageUrl?: string | null | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
}

export interface AddProductToCollectionInput {
  productId: string;
  sortOrder?: number | undefined;
}

export interface UpdateCollectionProductOrderInput {
  sortOrder: number;
}
