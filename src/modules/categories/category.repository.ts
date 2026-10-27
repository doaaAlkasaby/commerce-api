import type {
  PrismaClient,
} from '../../generated/prisma/client.js';

import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from './category.types.js';

const categoryCountSelection = (tenantId: string) => ({
  _count: {
    select: {
      children: {
        where: {
          isActive: true,
          tenantId,
        },
      },
    },
  },
} as const);

export const createCategoryRepository = (
  db: PrismaClient,
) => {
  return {
    findById: async (
      tenantId: string,
      id: string,
    ) => {
      return db.category.findUnique({
        where: {
          id,
          tenantId,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageStorageKey: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    findBySlug: async (
      tenantId: string,
      slug: string,
    ) => {
      return db.category.findUnique({
        where: {
          tenantId_slug: { tenantId, slug },
        },
      });
    },

    findAll: async (tenantId: string) => {
      return db.category.findMany({
        where: { tenantId },
        orderBy: {
          name: 'asc',
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    findActive: async (tenantId: string) => {
      return db.category.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: {
          name: 'asc',
        },

        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    findChildren: async (
      tenantId: string,
      parentId: string,
    ) => {
      return db.category.findMany({
        where: {
          parentId,
          tenantId,
        },
        orderBy: {
          name: 'asc',
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    create: async (
      tenantId: string,
      data: CreateCategoryInput,
    ) => {
      if (data.parentId) {
        const parent = await db.category.findFirst({
          where: { id: data.parentId, tenantId },
          select: { id: true },
        });
        if (!parent) throw new Error('Parent category does not belong to this tenant');
      }
      return db.category.create({
        data: { ...data, tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    update: async (
      tenantId: string,
      id: string,
      data: UpdateCategoryInput,
    ) => {
      if (data.parentId) {
        const parent = await db.category.findFirst({
          where: { id: data.parentId, tenantId },
          select: { id: true },
        });
        if (!parent) throw new Error('Parent category does not belong to this tenant');
      }
      return db.category.update({
        where: {
          id,
          tenantId,
        },
        data,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    updateStatus: async (
      tenantId: string,
      id: string,
      isActive: boolean,
    ) => {
      return db.category.update({
        where: {
          id,
          tenantId,
        },
        data: {
          isActive,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    updateImage: async (
      tenantId: string,
      id: string,
      imageStorageKey: string | null,
      imageUrl: string | null,
    ) => {
      return db.category.update({
        where: {
          id,
          tenantId,
        },
        data: {
          imageStorageKey,
          imageUrl,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          isActive: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          ...categoryCountSelection(tenantId),
        },
      });
    },

    delete: async (
      tenantId: string,
      id: string,
    ) => {
      return db.category.delete({
        where: {
          id,
          tenantId,
        },
      });
    },
  };
};
