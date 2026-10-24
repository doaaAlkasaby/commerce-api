import type {
  PrismaClient,
} from '../../generated/prisma/client.js';

import type {
  CreateBrandInput,
  UpdateBrandInput,
} from './brand.types.js';

export const createBrandRepository = (
  db: PrismaClient,
) => {
  return {
    findById: async (
      id: string,
    ) => {
      return db.brand.findUnique({
        where: {
          id,
        },
      });
    },

    findBySlug: async (
      slug: string,
    ) => {
      return db.brand.findUnique({
        where: {
          slug,
        },
      });
    },

    findAll: async () => {
      return db.brand.findMany({
        orderBy: {
          name: 'asc',
        },
      });
    },

    findActive: async () => {
      return db.brand.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          name: 'asc',
        },
      });
    },

    create: async (
      data: CreateBrandInput,
    ) => {
      return db.brand.create({
        data,
      });
    },

    update: async (
      id: string,
      data: UpdateBrandInput,
    ) => {
      return db.brand.update({
        where: {
          id,
        },
        data,
      });
    },

    updateStatus: async (
      id: string,
      isActive: boolean,
    ) => {
      return db.brand.update({
        where: {
          id,
        },
        data: {
          isActive,
        },
      });
    },

    updateImage: async (
      id: string,
      imageStorageKey: string | null,
      imageUrl: string | null,
    ) => {
      return db.brand.update({
        where: {
          id,
        },
        data: {
          imageStorageKey,
          imageUrl,
        },
      });
    },

    delete: async (
      id: string,
    ) => {
      return db.brand.delete({
        where: {
          id,
        },
      });
    },
  };
};