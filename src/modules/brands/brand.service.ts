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
  createBrandRepository,
} from './brand.repository.js';

import {
  toBrandResponse,
} from './brand.mapper.js';

import type {
  CreateBrandInput,
  UpdateBrandInput,
  UploadBrandImageInput,
} from './brand.types.js';

type BrandRepository =
  ReturnType<
    typeof createBrandRepository
  >;

export const createBrandService = (
  brandRepository: BrandRepository,
) => {
  return {
    create: async (
      data: CreateBrandInput,
    ) => {
      const existingBrand =
        await brandRepository.findBySlug(
          data.slug,
        );

      if (existingBrand) {
        throw new AppError(
          'Brand slug already exists',
          409,
          'BRAND_SLUG_ALREADY_EXISTS',
        );
      }

      const brand =
        await brandRepository.create(
          data,
        );

      return toBrandResponse(brand);
    },

    getById: async (
      id: string,
    ) => {
      const brand =
        await brandRepository.findById(
          id,
        );

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
        );
      }

      return toBrandResponse(brand);
    },

    getAll: async () => {
      const brands =
        await brandRepository.findAll();

      return brands.map(
        toBrandResponse,
      );
    },

    getActive: async () => {
      const brands =
        await brandRepository.findActive();

      return brands.map(
        toBrandResponse,
      );
    },

    update: async (
      id: string,
      data: UpdateBrandInput,
    ) => {
      const brand =
        await brandRepository.findById(
          id,
        );

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
        );
      }

      if (
        data.slug &&
        data.slug !== brand.slug
      ) {
        const existingBrand =
          await brandRepository.findBySlug(
            data.slug,
          );

        if (
          existingBrand &&
          existingBrand.id !== id
        ) {
          throw new AppError(
            'Brand slug already exists',
            409,
            'BRAND_SLUG_ALREADY_EXISTS',
          );
        }
      }

      const updatedBrand =
        await brandRepository.update(
          id,
          data,
        );

      return toBrandResponse(
        updatedBrand,
      );
    },

    updateStatus: async (
      id: string,
      isActive: boolean,
    ) => {
      const brand =
        await brandRepository.findById(
          id,
        );

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
        );
      }

      const updatedBrand =
        await brandRepository.updateStatus(
          id,
          isActive,
        );

      return toBrandResponse(
        updatedBrand,
      );
    },

    uploadImage: async (
      id: string,
      data: UploadBrandImageInput,
    ) => {
      const brand =
        await brandRepository.findById(id);

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
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
          'brands',
        );

      let updatedBrand:
        Awaited<
          ReturnType<
            BrandRepository['updateImage']
          >
        >;
      try {
        updatedBrand =
          await brandRepository.updateImage(
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

      if (brand.imageStorageKey) {
        await storageService.delete(
          brand.imageStorageKey,
        );
      }

      return toBrandResponse(updatedBrand);
    },

    deleteImage: async (
      id: string,
    ) => {
      const brand =
        await brandRepository.findById(id);

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
        );
      }

      await brandRepository.updateImage(
        id,
        null,
        null,
      );

      if (brand.imageStorageKey) {
        await storageService.delete(
          brand.imageStorageKey,
        );
      }
    },

    delete: async (
      id: string,
    ) => {
      const brand =
        await brandRepository.findById(
          id,
        );

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
        );
      }

      await brandRepository.delete(id);
    },
  };
};