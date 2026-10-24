import type {
  ProductAttributeResponse,
  ProductAttributeValueResponse,
} from './product-attribute.types.js';

export const toProductAttributeValueResponse = (value: {
  id: string;
  attributeId: string;
  value: string;
  sortOrder: number;
  imageStorageKey: string | null;
  imageUrl: string | null;
}): ProductAttributeValueResponse => {
  return {
    id: value.id,
    attributeId: value.attributeId,
    value: value.value,
    sortOrder: value.sortOrder,

    image:
      value.imageStorageKey !== null && value.imageUrl !== null
        ? {
            storageKey: value.imageStorageKey,
            url: value.imageUrl,
          }
        : null,
  };
};

export const toProductAttributeResponse = (attribute: {
  id: string;
  productId: string;
  name: string;
  sortOrder: number;

  values: Array<{
    id: string;
    attributeId: string;
    value: string;
    sortOrder: number;
    imageStorageKey: string | null;
    imageUrl: string | null;
  }>;
}): ProductAttributeResponse => {
  return {
    id: attribute.id,
    productId: attribute.productId,
    name: attribute.name,
    sortOrder: attribute.sortOrder,

    values: attribute.values.map(toProductAttributeValueResponse),
  };
};
