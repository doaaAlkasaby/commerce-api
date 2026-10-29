import type { PrismaClient } from '../../generated/prisma/client.js';

import type {
  CreateProductImageInput,
  UpdateProductImageInput,
} from './product-image.types.js';

export const createProductImageRepository = (
  db: PrismaClient,
) => {
  return {
    findById: async (tenantId: string, id: string) => {
      return db.productImage.findFirst({
        where: { id, product: { tenantId } },
      });
    },

    findByProductId: async (
      tenantId: string,
      productId: string,
    ) => {
      return db.productImage.findMany({
        where: { productId, product: { tenantId } },
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      });
    },

    create: async (
      tenantId: string,
      data: CreateProductImageInput,
    ) => {
      return db.$transaction(
        async (tx) => {
          const product = await tx.product.findFirst({
            where: { id: data.productId, tenantId }, select: { id: true },
          });
          if (!product) throw new Error('Product does not belong to this tenant');
          if (data.isPrimary) {
            await tx.productImage.updateMany({
              where: {
                productId: data.productId,
                product: { tenantId },
                isPrimary: true,
              },
              data: {
                isPrimary: false,
              },
            });
          }

          return tx.productImage.create({
            data: {
              productId: data.productId,
              storageKey: data.storageKey,
              url: data.url,
              altText: data.altText ?? null,
              sortOrder: data.sortOrder ?? 0,
              isPrimary: data.isPrimary ?? false,
            },
          });
        },
      );
    },

    update: async (
      tenantId: string,
      id: string,
      data: UpdateProductImageInput,
    ) => {
      const owned = await db.productImage.findFirst({ where: { id, product: { tenantId } }, select: { id: true } });
      if (!owned) return null;
      return db.productImage.update({
        where: { id: owned.id },
        data: {
          ...(data.altText !== undefined
            ? { altText: data.altText }
            : {}),
          ...(data.sortOrder !== undefined
            ? { sortOrder: data.sortOrder }
            : {}),
        },
      });
    },

    setPrimary: async (
      tenantId: string,
      id: string,
      productId: string,
    ) => {
      return db.$transaction(
        async (tx) => {
          const owned = await tx.productImage.findFirst({
            where: { id, productId, product: { tenantId } }, select: { id: true, productId: true },
          });
          if (!owned) return null;
          await tx.productImage.updateMany({
            where: {
              productId: owned.productId,
              product: { tenantId },
              isPrimary: true,
            },
            data: {
              isPrimary: false,
            },
          });

          return tx.productImage.update({
            where: { id: owned.id },
            data: {
              isPrimary: true,
            },
          });
        },
      );
    },

    delete: async (tenantId: string, id: string) => {
      return db.productImage.deleteMany({
        where: { id, product: { tenantId } },
      });
    },
  };
};

export type ProductImageRepository =
  ReturnType<
    typeof createProductImageRepository
  >;
