import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  storageService,
} from '../../common/storage/storage.service.js';

import {
  validateImageBuffer,
} from '../../common/storage/image-validation.js';

import type {
  createCategoryRepository,
} from './category.repository.js';

import {
  toCategoryResponse,
} from './category.mapper.js';

import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  UploadCategoryImageInput,
} from './category.types.js';

type CategoryRepository =
  ReturnType<
    typeof createCategoryRepository
  >;

export const createCategoryService = (
  categoryRepository: CategoryRepository,
) => {
  return {
    create: async (
      tenantId: string,
      data: CreateCategoryInput,
    ) => {
      const existingSlug =
        await categoryRepository.findBySlug(
          tenantId,
          data.slug,
        );

      if (existingSlug) {
        throw new AppError(
          'Category slug already exists',
          409,
          'CATEGORY_SLUG_ALREADY_EXISTS',
        );
      }

      if (data.parentId) {
        const parent =
          await categoryRepository.findById(
            tenantId,
            data.parentId,
          );

        if (!parent) {
          throw new AppError(
            'Parent category not found',
            404,
            'PARENT_CATEGORY_NOT_FOUND',
          );
        }

        if (!parent.isActive) {
          throw new AppError(
            'Parent category is inactive',
            400,
            'PARENT_CATEGORY_INACTIVE',
          );
        }
      }

      const category =
        await categoryRepository.create(
          tenantId,
          data,
        );

      return toCategoryResponse(
        category,
      );
    },

    getById: async (
      tenantId: string,
      id: string,
    ) => {
      const category =
        await categoryRepository.findById(
          tenantId,
          id,
        );

      if (!category) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      return toCategoryResponse(
        category,
      );
    },

    getAll: async (tenantId: string) => {
      const categories =
        await categoryRepository.findAll(tenantId);

      return categories.map(
        toCategoryResponse,
      );
    },

    getActive: async (tenantId: string) => {
      const categories =
        await categoryRepository.findActive(tenantId);

      return categories.map(
        toCategoryResponse,
      );
    },

    getChildren: async (
      tenantId: string,
      parentId: string,
    ) => {
      const parent =
        await categoryRepository.findById(
          tenantId,
          parentId,
        );

      if (!parent) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      const children =
        await categoryRepository.findChildren(
          tenantId,
          parentId,
        );

      return children.map(
        toCategoryResponse,
      );
    },

    update: async (
      tenantId: string,
      id: string,
      data: UpdateCategoryInput,
    ) => {
      const category =
        await categoryRepository.findById(
          tenantId,
          id,
        );

      if (!category) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      if (
        data.slug &&
        data.slug !== category.slug
      ) {
        const existingSlug =
          await categoryRepository.findBySlug(
            tenantId,
            data.slug,
          );

        if (
          existingSlug &&
          existingSlug.id !== id
        ) {
          throw new AppError(
            'Category slug already exists',
            409,
            'CATEGORY_SLUG_ALREADY_EXISTS',
          );
        }
      }

      if (
        data.parentId !== undefined
      ) {
        if (
          data.parentId === id
        ) {
          throw new AppError(
            'Category cannot be its own parent',
            400,
            'CATEGORY_CANNOT_BE_OWN_PARENT',
          );
        }

        if (data.parentId) {
          const parent =
            await categoryRepository.findById(
              tenantId,
              data.parentId,
            );

          if (!parent) {
            throw new AppError(
              'Parent category not found',
              404,
              'PARENT_CATEGORY_NOT_FOUND',
            );
          }

          if (!parent.isActive) {
            throw new AppError(
              'Parent category is inactive',
              400,
              'PARENT_CATEGORY_INACTIVE',
            );
          }
        }
      }

      const updatedCategory =
        await categoryRepository.update(
          tenantId,
          id,
          data,
        );

      return toCategoryResponse(
        updatedCategory,
      );
    },

    updateStatus: async (
      tenantId: string,
      id: string,
      isActive: boolean,
    ) => {
      const category =
        await categoryRepository.findById(
          tenantId,
          id,
        );

      if (!category) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      const updatedCategory =
        await categoryRepository.updateStatus(
          tenantId,
          id,
          isActive,
        );

      return toCategoryResponse(
        updatedCategory,
      );
    },

    uploadImage: async (
      tenantId: string,
      id: string,
      data: UploadCategoryImageInput,
    ) => {
      const category =
        await categoryRepository.findById(tenantId, id);

      if (!category) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      validateImageBuffer(
        data.file,
        data.contentType,
      );

      const storedFile =
        await storageService.upload(
          data.file,
          data.originalName,
          data.contentType,
          'categories',
        );

      let updatedCategory:
        Awaited<
          ReturnType<
            CategoryRepository['updateImage']
          >
        >;
      try {
        updatedCategory =
          await categoryRepository.updateImage(
            tenantId,
            id,
            storedFile.storageKey,
            storedFile.url,
          );
      } catch (error) {
        await storageService.delete(
          storedFile.storageKey,
        );

        throw error;
      }

      if (category.imageStorageKey) {
        await storageService.delete(
          category.imageStorageKey,
        );
      }

      return toCategoryResponse(
        updatedCategory,
      );
    },

    deleteImage: async (
      tenantId: string,
      id: string,
    ) => {
      const category =
        await categoryRepository.findById(tenantId, id);

      if (!category) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      await categoryRepository.updateImage(
        tenantId,
        id,
        null,
        null,
      );

      if (category.imageStorageKey) {
        await storageService.delete(
          category.imageStorageKey,
        );
      }
    },

    delete: async (
      tenantId: string,
      id: string,
    ) => {
      const category =
        await categoryRepository.findById(
          tenantId,
          id,
        );

      if (!category) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      await categoryRepository.delete(
        tenantId,
        id,
      );
    },
  };
};
