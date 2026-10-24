import type { ProductCollectionRepository } from './product-collection.repository.js';

type ProductCollectionRecord = Awaited<
  ReturnType<ProductCollectionRepository['findMany']>
>[number];

type CollectionProductRecord = Awaited<
  ReturnType<ProductCollectionRepository['addProduct']>
>;

export const mapProductCollection = (collection: ProductCollectionRecord) => ({
  id: collection.id,
  name: collection.name,
  slug: collection.slug,
  description: collection.description,
  imageUrl: collection.imageUrl,
  isActive: collection.isActive,
  sortOrder: collection.sortOrder,
  startsAt: collection.startsAt,
  endsAt: collection.endsAt,
  createdAt: collection.createdAt,
  updatedAt: collection.updatedAt,
});

export const mapCollectionProductItem = (item: CollectionProductRecord) => ({
  collectionId: item.collectionId,
  productId: item.productId,
  sortOrder: item.sortOrder,
});
