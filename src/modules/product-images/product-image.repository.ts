import type { PrismaClient } from '../../generated/prisma/client.js';

import type {
  CreateProductImageInput,
  UpdateProductImageInput,
} from './product-image.types.js';

export const createProductImageRepository = (
  db: PrismaClient,
) => {
  return {
    findById: async (id: string) => {
      return db.productImage.findUnique({
        where: { id },
      });
    },

    findByProductId: async (
      productId: string,
    ) => {
      return db.productImage.findMany({
        where: { productId },
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      });
    },

    create: async (
      data: CreateProductImageInput,
    ) => {
      return db.$transaction(
        async (tx) => {
          if (data.isPrimary) {
            await tx.productImage.updateMany({
              where: {
                productId: data.productId,
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
      id: string,
      data: UpdateProductImageInput,
    ) => {
      return db.productImage.update({
        where: { id },
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
      id: string,
      productId: string,
    ) => {
      return db.$transaction(
        async (tx) => {
          await tx.productImage.updateMany({
            where: {
              productId,
              isPrimary: true,
            },
            data: {
              isPrimary: false,
            },
          });

          return tx.productImage.update({
            where: { id },
            data: {
              isPrimary: true,
            },
          });
        },
      );
    },

    delete: async (id: string) => {
      return db.productImage.delete({
        where: { id },
      });
    },
  };
};

export type ProductImageRepository =
  ReturnType<
    typeof createProductImageRepository
  >;