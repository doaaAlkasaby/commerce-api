import { Prisma } from '../../generated/prisma/client.js';
import type {
  PrismaClient,
} from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';
import { COMPLEMENTARY_MAX_TARGET_CATEGORIES } from './category.schemas.js';

import type {
  ComplementaryCategoryItemResponse,
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

    findComplementaryCategories: async (
      tenantId: string,
      sourceCategoryId: string,
    ): Promise<ComplementaryCategoryItemResponse[]> => {
      const rows = await db.categoryComplementaryRelation.findMany({
        where: {
          tenantId,
          sourceCategoryId,
        },
        orderBy: [{ sortOrder: 'asc' }, { targetCategoryId: 'asc' }],
        select: {
          sortOrder: true,
          targetCategory: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
            },
          },
        },
      });

      return rows.map((row) => ({
        id: row.targetCategory.id,
        name: row.targetCategory.name,
        slug: row.targetCategory.slug,
        isActive: row.targetCategory.isActive,
        sortOrder: row.sortOrder,
      }));
    },

    replaceComplementaryCategories: async (
      tenantId: string,
      sourceCategoryId: string,
      targetCategoryIds: string[],
    ): Promise<ComplementaryCategoryItemResponse[]> => {
      if (targetCategoryIds.length > COMPLEMENTARY_MAX_TARGET_CATEGORIES) {
        throw new AppError(
          `At most ${COMPLEMENTARY_MAX_TARGET_CATEGORIES} complementary categories may be configured`,
          400,
          'MAX_COMPLEMENTARY_CATEGORIES_EXCEEDED',
        );
      }

      if (new Set(targetCategoryIds).size !== targetCategoryIds.length) {
        throw new AppError(
          'Duplicate target category IDs are not allowed',
          400,
          'DUPLICATE_TARGET_CATEGORY',
        );
      }

      if (targetCategoryIds.includes(sourceCategoryId)) {
        throw new AppError(
          'A category cannot be complementary to itself',
          400,
          'CATEGORY_SELF_RELATIONSHIP_NOT_ALLOWED',
        );
      }

      return db.$transaction(async (tx) => {
        // Serialize concurrent replacements per source category within the tenant.
        const lockedSource = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "Category"
            WHERE "id" = ${sourceCategoryId}
              AND "tenantId" = ${tenantId}
            FOR UPDATE
          `,
        );

        if (lockedSource.length === 0) {
          throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
        }

        const existingRelations =
          await tx.categoryComplementaryRelation.findMany({
            where: {
              tenantId,
              sourceCategoryId,
            },
            select: {
              targetCategoryId: true,
            },
          });
        const existingTargetIds = new Set(
          existingRelations.map((relation) => relation.targetCategoryId),
        );

        if (targetCategoryIds.length > 0) {
          const targetCategories = await tx.category.findMany({
            where: {
              tenantId,
              id: { in: targetCategoryIds },
            },
            select: {
              id: true,
              isActive: true,
            },
          });

          if (targetCategories.length !== targetCategoryIds.length) {
            throw new AppError(
              'One or more target categories were not found',
              404,
              'TARGET_CATEGORY_NOT_FOUND',
            );
          }

          const targetById = new Map(
            targetCategories.map((category) => [category.id, category]),
          );

          for (const targetId of targetCategoryIds) {
            const target = targetById.get(targetId);
            if (!target) {
              throw new AppError(
                'One or more target categories were not found',
                404,
                'TARGET_CATEGORY_NOT_FOUND',
              );
            }

            if (!target.isActive && !existingTargetIds.has(targetId)) {
              throw new AppError(
                'Cannot add an inactive category as a complementary target',
                400,
                'TARGET_CATEGORY_INACTIVE',
              );
            }
          }
        }

        await tx.categoryComplementaryRelation.deleteMany({
          where: {
            tenantId,
            sourceCategoryId,
          },
        });

        if (targetCategoryIds.length > 0) {
          await tx.categoryComplementaryRelation.createMany({
            data: targetCategoryIds.map((targetCategoryId, index) => ({
              tenantId,
              sourceCategoryId,
              targetCategoryId,
              sortOrder: index,
            })),
          });
        }

        const updatedRows = await tx.categoryComplementaryRelation.findMany({
          where: {
            tenantId,
            sourceCategoryId,
          },
          orderBy: [{ sortOrder: 'asc' }, { targetCategoryId: 'asc' }],
          select: {
            sortOrder: true,
            targetCategory: {
              select: {
                id: true,
                name: true,
                slug: true,
                isActive: true,
              },
            },
          },
        });

        return updatedRows.map((row) => ({
          id: row.targetCategory.id,
          name: row.targetCategory.name,
          slug: row.targetCategory.slug,
          isActive: row.targetCategory.isActive,
          sortOrder: row.sortOrder,
        }));
      });
    },
  };
};
