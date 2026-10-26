import type {
  PrismaClient,
} from '../../generated/prisma/client.js';

import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from './category.types.js';

const categoryCountSelection = {
  _count: {
    select: {
      children: {
        where: {
          isActive: true,
        },
      },
    },
  },
} as const;

export const createCategoryRepository = (
  db: PrismaClient,
) => {
  return {
    findById: async (
      id: string,
    ) => {
      return db.category.findUnique({
        where: {
          id,
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
          ...categoryCountSelection,
        },
      });
    },

    findBySlug: async (
      slug: string,
    ) => {
      return db.category.findUnique({
        where: {
          slug,
        },
      });
    },

    findAll: async () => {
      return db.category.findMany({
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
          ...categoryCountSelection,
        },
      });
    },

    findActive: async () => {
      return db.category.findMany({
        where: {
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
          ...categoryCountSelection,
        },
      });
    },

    findChildren: async (
      parentId: string,
    ) => {
      return db.category.findMany({
        where: {
          parentId,
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
          ...categoryCountSelection,
        },
      });
    },

    create: async (
      data: CreateCategoryInput,
    ) => {
      return db.category.create({
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
          ...categoryCountSelection,
        },
      });
    },

    update: async (
      id: string,
      data: UpdateCategoryInput,
    ) => {
      return db.category.update({
        where: {
          id,
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
          ...categoryCountSelection,
        },
      });
    },

    updateStatus: async (
      id: string,
      isActive: boolean,
    ) => {
      return db.category.update({
        where: {
          id,
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
          ...categoryCountSelection,
        },
      });
    },

    updateImage: async (
      id: string,
      imageStorageKey: string | null,
      imageUrl: string | null,
    ) => {
      return db.category.update({
        where: {
          id,
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
          ...categoryCountSelection,
        },
      });
    },

    delete: async (
      id: string,
    ) => {
      return db.category.delete({
        where: {
          id,
        },
      });
    },
  };
};