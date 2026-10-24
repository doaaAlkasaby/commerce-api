export interface CreateProductAttributeInput {
  productId: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateProductAttributeInput {
  name?: string;
  sortOrder?: number;
}

export interface CreateProductAttributeValueInput {
  attributeId: string;
  value: string;
  sortOrder?: number;
}

export interface UpdateProductAttributeValueInput {
  value?: string;
  sortOrder?: number;
}

export interface ProductAttributeValueResponse {
  id: string;
  attributeId: string;
  value: string;
  sortOrder: number;
  image: {
    storageKey: string;
    url: string;
  } | null;
}

export interface ProductAttributeResponse {
  id: string;
  productId: string;
  name: string;
  sortOrder: number;
  values: ProductAttributeValueResponse[];
}
