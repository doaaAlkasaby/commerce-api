import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  Prisma,
  PrismaClient,
} from '../../src/generated/prisma/client.js';
import { DevelopmentSeedError } from '../../src/config/development-seed-options.js';
import { developmentId } from './seed.js';
import { normalizeVisualPaths } from './normalize-visual-paths.js';
import { developmentMediaRoot } from '../../src/common/storage/development-media.js';

export async function verifyDevelopmentAssets() {
  for (const store of ['fashion', 'independent']) {
    for (const file of [
      'tee-front',
      'tee-detail',
      'denim-front',
      'denim-detail',
      'shoes-front',
      'shoes-detail',
      'identity',
      'everyday-edit',
      'everyday-edit-mobile',
    ]) {
      const bytes = await readFile(
        resolve(developmentMediaRoot, `${store}/${file}.webp`),
      ).catch(() => {
        throw new DevelopmentSeedError(
          'The bundled public/seed-media assets must be packaged before seeding; see docs/phase8.2-visual-seed-data.md',
        );
      });
      if (
        bytes.subarray(0, 4).toString() !== 'RIFF' ||
        bytes.subarray(8, 12).toString() !== 'WEBP'
      )
        throw new DevelopmentSeedError(
          'Development visual asset is not a WebP file',
        );
    }
  }
}

export async function verifyDevelopmentVisuals(db: PrismaClient) {
  const stores = [];
  for (const store of ['fashion', 'independent']) {
    const tenantId = developmentId(`tenant:${store}`);
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });
    const products = await db.product.findMany({
      where: {
        tenantId,
        id: {
          in: ['tee', 'denim', 'shoes'].map((key) =>
            developmentId(`product:${store}:${key}`),
          ),
        },
      },
      include: { images: true },
    });
    if (
      !tenant.logoUrl ||
      products.length !== 3 ||
      products.some(
        (product) => !product.images.some((image) => image.isPrimary),
      )
    )
      throw new DevelopmentSeedError(
        'Development visual coverage needs review; customized records were not overwritten',
      );
    stores.push({
      store,
      products: products.length,
      productImages: products.reduce(
        (sum, product) => sum + product.images.length,
        0,
      ),
      brands: await db.brand.count({ where: { tenantId } }),
      categories: await db.category.count({ where: { tenantId } }),
      banners: await db.banner.count({ where: { tenantId } }),
    });
  }
  return stores;
}

export function developmentMedia(store: string, file: string) {
  if (!['fashion', 'independent'].includes(store) || !/^[a-z0-9-]+$/.test(file))
    throw new DevelopmentSeedError('Invalid bundled development media path');
  const storageKey = `development-v82/${store}/${file}.webp`;
  return { storageKey, url: `/uploads/${storageKey}` };
}

/** Add fixture media only. Never update an existing image or merchant configuration. */
export async function seedVisuals(
  tx: Prisma.TransactionClient,
  store: 'fashion' | 'independent',
) {
  const tenantId = developmentId(`tenant:${store}`);
  // Serialize repeat seed invocations; merchant writes are never replaced by upsert updates.
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
  await normalizeVisualPaths(tx, store);
  const identity = developmentMedia(store, 'identity');
  await tx.tenant.updateMany({
    where: {
      id: tenantId,
      logoUrl: null,
      logoStorageKey: null,
      updatedAt: {
        equals: (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }))
          .createdAt,
      },
    },
    data: { logoUrl: identity.url, logoStorageKey: identity.storageKey },
  });
  const brandId = developmentId(`visual-brand:${store}`);
  const brand = await tx.brand.upsert({
    where: { id: brandId },
    update: {},
    create: {
      id: brandId,
      tenantId,
      name: store === 'fashion' ? 'Dune 81 Studio' : 'Form 81 Studio',
      slug: 'development-studio',
      description:
        'Fictional development label; original illustrative imagery.',
      imageUrl: identity.url,
      imageStorageKey: identity.storageKey,
    },
  });
  if (brand.tenantId !== tenantId)
    throw new DevelopmentSeedError('Visual brand ownership conflict');
  const rootId = developmentId(`category:${store}`);
  for (const [key, name, parentId, file] of [
    ['clothing', 'Clothing', rootId, 'tee-front'],
    [
      'tee',
      'T-shirts',
      developmentId(`visual-category:${store}:clothing`),
      'tee-front',
    ],
    [
      'denim',
      'Jeans',
      developmentId(`visual-category:${store}:clothing`),
      'denim-front',
    ],
    ['shoes', 'Footwear', rootId, 'shoes-front'],
  ]) {
    if (!key || !name || !parentId || !file)
      throw new DevelopmentSeedError('Invalid visual category fixture');
    const image = developmentMedia(store, file);
    const id = developmentId(`visual-category:${store}:${key}`);
    const category = await tx.category.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId,
        name,
        slug: `development-${key}`,
        parentId,
        imageUrl: image.url,
        imageStorageKey: image.storageKey,
      },
    });
    if (category.tenantId !== tenantId)
      throw new DevelopmentSeedError('Visual category ownership conflict');
  }
  const root = await tx.category.findUniqueOrThrow({ where: { id: rootId } });
  if (root.tenantId !== tenantId)
    throw new DevelopmentSeedError('Visual category ownership conflict');
  await tx.category.updateMany({
    where: {
      id: rootId,
      imageUrl: null,
      imageStorageKey: null,
      updatedAt: root.createdAt,
    },
    data: { imageUrl: identity.url, imageStorageKey: identity.storageKey },
  });
  const collectionId = developmentId(`visual-featured:${store}`);
  // A merchant's existing featured collection takes precedence over fixture content.
  const existingFeatured = await tx.productCollection.findUnique({
    where: { tenantId_slug: { tenantId, slug: 'featured' } },
  });
  if (!existingFeatured || existingFeatured.id === collectionId) {
    const collection = await tx.productCollection.upsert({
      where: { id: collectionId },
      update: {},
      create: {
        id: collectionId,
        tenantId,
        name: 'Everyday essentials',
        slug: 'featured',
        sortOrder: 0,
        imageUrl: developmentMedia(store, 'everyday-edit').url,
        imageStorageKey: developmentMedia(store, 'everyday-edit').storageKey,
      },
    });
    if (collection.tenantId !== tenantId)
      throw new DevelopmentSeedError('Visual collection ownership conflict');
  }
  for (const [index, key] of ['tee', 'denim', 'shoes'].entries()) {
    const productId = developmentId(`product:${store}:${key}`);
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      include: { images: true, variants: { include: { images: true } } },
    });
    if (product.tenantId !== tenantId)
      throw new DevelopmentSeedError('Visual product ownership conflict');
    // Upgrade an untouched Phase 8.1 category/brand only; customized products retain both.
    await tx.product.updateMany({
      where: {
        id: productId,
        categoryId: rootId,
        brandId: null,
        updatedAt: product.createdAt,
      },
      data: {
        categoryId: developmentId(`visual-category:${store}:${key}`),
        brandId,
      },
    });
    const ids = ['front', 'detail'].map((view) =>
      developmentId(`visual-product:${store}:${key}:${view}`),
    );
    if (product.images.every((image) => ids.includes(image.id))) {
      for (const [order, view] of ['front', 'detail'].entries()) {
        const image = developmentMedia(store, `${key}-${view}`);
        const id = developmentId(`visual-product:${store}:${key}:${view}`);
        const saved = await tx.productImage.upsert({
          where: { id },
          update: {},
          create: {
            id,
            productId,
            ...image,
            altText: `${product.name}, ${view === 'front' ? 'full view' : 'detail crop'} (development illustration)`,
            sortOrder: order,
            isPrimary:
              order === 0 && !product.images.some((row) => row.isPrimary),
          },
        });
        if (saved.productId !== productId)
          throw new DevelopmentSeedError('Visual image ownership conflict');
      }
    }
    // Sizes depict the same garment, not fictional color variations.
    const sizes =
      key === 'tee'
        ? ['small', 'medium']
        : key === 'denim'
          ? ['30', '32']
          : ['40', '41'];
    for (const variant of product.variants) {
      if (
        !sizes.some(
          (size) =>
            variant.id === developmentId(`variant:${store}:${key}:${size}`),
        )
      )
        continue;
      const id = developmentId(`visual-variant:${variant.id}`);
      if (variant.images.some((image) => image.id !== id)) continue;
      const saved = await tx.productVariantImage.upsert({
        where: { id },
        update: {},
        create: {
          id,
          variantId: variant.id,
          ...developmentMedia(store, `${key}-front`),
          altText: `${product.name}, same design in this size (development illustration)`,
          isPrimary: true,
        },
      });
      if (saved.variantId !== variant.id)
        throw new DevelopmentSeedError(
          'Visual variant image ownership conflict',
        );
    }
    if (!existingFeatured || existingFeatured.id === collectionId)
      await tx.productCollectionItem.upsert({
        where: { collectionId_productId: { collectionId, productId } },
        update: {},
        create: { collectionId, productId, sortOrder: index },
      });
  }
  if (!existingFeatured || existingFeatured.id === collectionId) {
    const id = developmentId(`visual-banner:${store}`);
    const image = developmentMedia(store, 'everyday-edit');
    const banner = await tx.banner.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId,
        title: 'Everyday essentials',
        subtitle: 'Explore your development collection',
        imageUrl: image.url,
        imageStorageKey: image.storageKey,
        mobileImageUrl: developmentMedia(store, 'everyday-edit-mobile').url,
        mobileImageStorageKey: developmentMedia(store, 'everyday-edit-mobile')
          .storageKey,
        targetType: 'COLLECTION',
        targetId: collectionId,
        sortOrder: 0,
      },
    });
    if (banner.tenantId !== tenantId)
      throw new DevelopmentSeedError('Visual banner ownership conflict');
  }
}
