import { prisma } from '../../config/database.js';
import { AppError } from '../errors/app-error.js';
import { isSafeStorageKey } from './storage-validation.js';
import { storageService } from './storage.service.js';
import type { StorageService } from './storage.types.js';

type StorageRefReader = Pick<
  typeof prisma,
  | 'productImage'
  | 'productVariantImage'
  | 'productAttributeValue'
  | 'category'
  | 'brand'
  | 'productCollection'
  | 'banner'
  | 'tenant'
>;

export async function isStorageKeyReferenced(
  storageKey: string,
  db: StorageRefReader = prisma,
): Promise<boolean> {
  if (!isSafeStorageKey(storageKey)) {
    throw new AppError('Invalid storage path', 400, 'INVALID_STORAGE_KEY');
  }

  const [
    productImages,
    variantImages,
    attributeValues,
    categories,
    brands,
    collections,
    banners,
    tenants,
  ] = await Promise.all([
    db.productImage.count({ where: { storageKey } }),
    db.productVariantImage.count({ where: { storageKey } }),
    db.productAttributeValue.count({ where: { imageStorageKey: storageKey } }),
    db.category.count({ where: { imageStorageKey: storageKey } }),
    db.brand.count({ where: { imageStorageKey: storageKey } }),
    db.productCollection.count({ where: { imageStorageKey: storageKey } }),
    db.banner.count({
      where: {
        OR: [
          { imageStorageKey: storageKey },
          { mobileImageStorageKey: storageKey },
        ],
      },
    }),
    db.tenant.count({ where: { logoStorageKey: storageKey } }),
  ]);

  return (
    productImages +
      variantImages +
      attributeValues +
      categories +
      brands +
      collections +
      banners +
      tenants >
    0
  );
}

export async function deleteUnreferencedStorageKey(
  storageKey: string,
  storage: StorageService = storageService,
): Promise<boolean> {
  if (!isSafeStorageKey(storageKey)) {
    throw new AppError('Invalid storage path', 400, 'INVALID_STORAGE_KEY');
  }
  if (storageKey.startsWith('development-v82/')) {
    return false;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'storage-ref:' + storageKey}))`;
    if (await isStorageKeyReferenced(storageKey, tx)) {
      return false;
    }
    await storage.delete(storageKey);
    return true;
  });
}
