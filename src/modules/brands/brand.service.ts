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
      tenantId: string,
      data: CreateBrandInput,
    ) => {
      const existingBrand =
        await brandRepository.findBySlug(
          tenantId,
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
          tenantId,
          data,
        );

      return toBrandResponse(brand);
    },

    getById: async (
      tenantId: string,
      id: string,
    ) => {
      const brand =
        await brandRepository.findById(
          tenantId,
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

    getAll: async (tenantId: string) => {
      const brands =
        await brandRepository.findAll(tenantId);

      return brands.map(
        toBrandResponse,
      );
    },

    getActive: async (tenantId: string) => {
      const brands =
        await brandRepository.findActive(tenantId);

      return brands.map(
        toBrandResponse,
      );
    },

    update: async (
      tenantId: string,
      id: string,
      data: UpdateBrandInput,
    ) => {
      const brand =
        await brandRepository.findById(
          tenantId,
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
            tenantId,
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
          tenantId,
          id,
          data,
        );

      return toBrandResponse(
        updatedBrand,
      );
    },

    updateStatus: async (
      tenantId: string,
      id: string,
      isActive: boolean,
    ) => {
      const brand =
        await brandRepository.findById(
          tenantId,
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
          tenantId,
          id,
          isActive,
        );

      return toBrandResponse(
        updatedBrand,
      );
    },

    uploadImage: async (
      tenantId: string,
      id: string,
      data: UploadBrandImageInput,
    ) => {
      const brand =
        await brandRepository.findById(tenantId, id);

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

      if (brand.imageStorageKey) {
        await storageService.delete(
          brand.imageStorageKey,
        );
      }

      return toBrandResponse(updatedBrand);
    },

    deleteImage: async (
      tenantId: string,
      id: string,
    ) => {
      const brand =
        await brandRepository.findById(tenantId, id);

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
        );
      }

      await brandRepository.updateImage(
        tenantId,
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
      tenantId: string,
      id: string,
    ) => {
      const brand =
        await brandRepository.findById(
          tenantId,
          id,
        );

      if (!brand) {
        throw new AppError(
          'Brand not found',
          404,
          'BRAND_NOT_FOUND',
        );
      }

      await brandRepository.delete(tenantId, id);
    },
  };
};
