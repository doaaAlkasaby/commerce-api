import type {
  Category,
} from '../../generated/prisma/client.js';

import type {
  CategoryResponse,
} from './category.types.js';

export const toCategoryResponse = (
  category: Pick<
    Category,
    | 'id'
    | 'name'
    | 'slug'
    | 'description'
    | 'isActive'
    | 'parentId'
    | 'imageUrl'
    | 'createdAt'
    | 'updatedAt'
  >,
): CategoryResponse => {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    isActive: category.isActive,
    parentId: category.parentId,
    imageUrl: category.imageUrl,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
};


export const mapCategory = (
  category: Category,
) => {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    parentId: category.parentId,
    isActive: category.isActive,

    image:
      category.imageStorageKey ||
      category.imageUrl
        ? {
            storageKey:
              category.imageStorageKey,
            url:
              category.imageUrl,
          }
        : null,

    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
};


export const mapCategoryListItem = (
  category: Pick<
    Category,
    | 'id'
    | 'name'
    | 'slug'
    | 'imageUrl'
    | 'parentId'
    | 'isActive'
  >,
) => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  imageUrl: category.imageUrl,
  parentId: category.parentId,
  isActive: category.isActive,

});