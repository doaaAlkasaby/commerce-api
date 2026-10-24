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
      data: CreateCategoryInput,
    ) => {
      const existingSlug =
        await categoryRepository.findBySlug(
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
          data,
        );

      return toCategoryResponse(
        category,
      );
    },

    getById: async (
      id: string,
    ) => {
      const category =
        await categoryRepository.findById(
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

    getAll: async () => {
      const categories =
        await categoryRepository.findAll();

      return categories.map(
        toCategoryResponse,
      );
    },

    getActive: async () => {
      const categories =
        await categoryRepository.findActive();

      return categories.map(
        toCategoryResponse,
      );
    },

    getChildren: async (
      parentId: string,
    ) => {
      const parent =
        await categoryRepository.findById(
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
          parentId,
        );

      return children.map(
        toCategoryResponse,
      );
    },

    update: async (
      id: string,
      data: UpdateCategoryInput,
    ) => {
      const category =
        await categoryRepository.findById(
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
          id,
          data,
        );

      return toCategoryResponse(
        updatedCategory,
      );
    },

    updateStatus: async (
      id: string,
      isActive: boolean,
    ) => {
      const category =
        await categoryRepository.findById(
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
          id,
          isActive,
        );

      return toCategoryResponse(
        updatedCategory,
      );
    },

    uploadImage: async (
      id: string,
      data: UploadCategoryImageInput,
    ) => {
      const category =
        await categoryRepository.findById(id);

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
      id: string,
    ) => {
      const category =
        await categoryRepository.findById(id);

      if (!category) {
        throw new AppError(
          'Category not found',
          404,
          'CATEGORY_NOT_FOUND',
        );
      }

      await categoryRepository.updateImage(
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
      id: string,
    ) => {
      const category =
        await categoryRepository.findById(
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
        id,
      );
    },
  };
};