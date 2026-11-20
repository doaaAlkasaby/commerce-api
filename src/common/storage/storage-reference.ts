import { prisma } from '../../config/database.js';
import { storageService } from './storage.service.js';
import type { StorageService } from './storage.types.js';

export async function isStorageKeyReferenced(
  storageKey: string,
): Promise<boolean> {
  const [
    productImages,
    variantImages,
    attributeValues,
    categories,
    brands,
    collections,
    banners,
  ] = await Promise.all([
    prisma.productImage.count({ where: { storageKey } }),
    prisma.productVariantImage.count({ where: { storageKey } }),
    prisma.productAttributeValue.count({ where: { imageStorageKey: storageKey } }),
    prisma.category.count({ where: { imageStorageKey: storageKey } }),
    prisma.brand.count({ where: { imageStorageKey: storageKey } }),
    prisma.productCollection.count({ where: { imageStorageKey: storageKey } }),
    prisma.banner.count({ where: { imageStorageKey: storageKey } }),
  ]);

  return (
    productImages +
      variantImages +
      attributeValues +
      categories +
      brands +
      collections +
      banners >
    0
  );
}

export async function deleteUnreferencedStorageKey(
  storageKey: string,
  storage: StorageService = storageService,
): Promise<void> {
  if (await isStorageKeyReferenced(storageKey)) return;
  await storage.delete(storageKey);
}
