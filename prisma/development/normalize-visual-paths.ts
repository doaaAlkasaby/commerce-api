import type { Prisma } from '../../src/generated/prisma/client.js';
import { developmentId } from './seed.js';

/** Convert only known fixture URLs that still name their exact bundled object.
 * Custom domains/paths pointing to different objects, text, flags and ordering stay intact.
 */
export async function normalizeVisualPaths(
  tx: Prisma.TransactionClient,
  store: string,
) {
  const tenantId = developmentId(`tenant:${store}`);
  async function normalize(
    key: string | null,
    url: string | null,
    write: (url: string) => Promise<unknown>,
  ) {
    if (
      !key ||
      !url ||
      !key.startsWith(`development-v82/${store}/`) ||
      !/^https?:\/\//.test(url)
    )
      return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (
      parsed.pathname !== `/uploads/${key}` ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      return;
    await write(`/uploads/${key}`);
  }
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  await normalize(tenant.logoStorageKey, tenant.logoUrl, (url) =>
    tx.tenant.updateMany({
      where: {
        id: tenantId,
        logoUrl: tenant.logoUrl,
        logoStorageKey: tenant.logoStorageKey,
      },
      data: { logoUrl: url },
    }),
  );
  const categoryIds = [
    developmentId(`category:${store}`),
    ...['clothing', 'tee', 'denim', 'shoes'].map((key) =>
      developmentId(`visual-category:${store}:${key}`),
    ),
  ];
  for (const row of await tx.category.findMany({
    where: { tenantId, id: { in: categoryIds } },
  }))
    await normalize(row.imageStorageKey, row.imageUrl, (url) =>
      tx.category.updateMany({
        where: {
          id: row.id,
          imageUrl: row.imageUrl,
          imageStorageKey: row.imageStorageKey,
        },
        data: { imageUrl: url },
      }),
    );
  for (const row of await tx.brand.findMany({
    where: { tenantId, id: developmentId(`visual-brand:${store}`) },
  }))
    await normalize(row.imageStorageKey, row.imageUrl, (url) =>
      tx.brand.updateMany({
        where: {
          id: row.id,
          imageUrl: row.imageUrl,
          imageStorageKey: row.imageStorageKey,
        },
        data: { imageUrl: url },
      }),
    );
  const productIds = ['tee', 'denim', 'shoes'].map((key) =>
    developmentId(`product:${store}:${key}`),
  );
  const imageIds = ['tee', 'denim', 'shoes'].flatMap((key) =>
    ['front', 'detail'].map((view) =>
      developmentId(`visual-product:${store}:${key}:${view}`),
    ),
  );
  for (const row of await tx.productImage.findMany({
    where: {
      product: { tenantId },
      productId: { in: productIds },
      id: { in: imageIds },
    },
  }))
    await normalize(row.storageKey, row.url, (url) =>
      tx.productImage.updateMany({
        where: { id: row.id, url: row.url, storageKey: row.storageKey },
        data: { url },
      }),
    );
  for (const row of await tx.productVariantImage.findMany({
    where: {
      variant: { product: { tenantId }, productId: { in: productIds } },
    },
  })) {
    if (row.id !== developmentId(`visual-variant:${row.variantId}`)) continue;
    await normalize(row.storageKey, row.url, (url) =>
      tx.productVariantImage.updateMany({
        where: { id: row.id, url: row.url, storageKey: row.storageKey },
        data: { url },
      }),
    );
  }
  for (const row of await tx.productCollection.findMany({
    where: { tenantId, id: developmentId(`visual-featured:${store}`) },
  }))
    await normalize(row.imageStorageKey, row.imageUrl, (url) =>
      tx.productCollection.updateMany({
        where: {
          id: row.id,
          imageUrl: row.imageUrl,
          imageStorageKey: row.imageStorageKey,
        },
        data: { imageUrl: url },
      }),
    );
  for (const row of await tx.banner.findMany({
    where: { tenantId, id: developmentId(`visual-banner:${store}`) },
  })) {
    await normalize(row.imageStorageKey, row.imageUrl, (url) =>
      tx.banner.updateMany({
        where: {
          id: row.id,
          imageUrl: row.imageUrl,
          imageStorageKey: row.imageStorageKey,
        },
        data: { imageUrl: url },
      }),
    );
    await normalize(row.mobileImageStorageKey, row.mobileImageUrl, (url) =>
      tx.banner.updateMany({
        where: {
          id: row.id,
          mobileImageUrl: row.mobileImageUrl,
          mobileImageStorageKey: row.mobileImageStorageKey,
        },
        data: { mobileImageUrl: url },
      }),
    );
  }
}
