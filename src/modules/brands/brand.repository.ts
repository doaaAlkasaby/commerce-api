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
      tenantId: string,
      id: string,
    ) => {
      return db.brand.findUnique({
        where: {
          id,
          tenantId,
        },
      });
    },

    findBySlug: async (
      tenantId: string,
      slug: string,
    ) => {
      return db.brand.findUnique({
        where: {
          tenantId_slug: { tenantId, slug },
        },
      });
    },

    findAll: async (tenantId: string) => {
      return db.brand.findMany({
        where: { tenantId },
        orderBy: {
          name: 'asc',
        },
      });
    },

    findActive: async (tenantId: string) => {
      return db.brand.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: {
          name: 'asc',
        },
      });
    },

    create: async (
      tenantId: string,
      data: CreateBrandInput,
    ) => {
      return db.brand.create({
        data: { ...data, tenantId },
      });
    },

    update: async (
      tenantId: string,
      id: string,
      data: UpdateBrandInput,
    ) => {
      return db.brand.update({
        where: {
          id,
          tenantId,
        },
        data,
      });
    },

    updateStatus: async (
      tenantId: string,
      id: string,
      isActive: boolean,
    ) => {
      return db.brand.update({
        where: {
          id,
          tenantId,
        },
        data: {
          isActive,
        },
      });
    },

    updateImage: async (
      tenantId: string,
      id: string,
      imageStorageKey: string | null,
      imageUrl: string | null,
    ) => {
      return db.brand.update({
        where: {
          id,
          tenantId,
        },
        data: {
          imageStorageKey,
          imageUrl,
        },
      });
    },

    delete: async (
      tenantId: string,
      id: string,
    ) => {
      return db.brand.delete({
        where: {
          id,
          tenantId,
        },
      });
    },
  };
};
