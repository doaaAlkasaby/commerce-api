import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  storageService,
} from '../../common/storage/storage.service.js';

import {
  toProductImageResponse,
} from './product-image.mapper.js';

import type {
  ProductImageRepository,
} from './product-image.repository.js';

import type {
  ProductRepository,
} from '../products/product.repository.js';

import type {
  CreateProductImageInput,
  UpdateProductImageInput,
  UploadProductImageInput,
} from './product-image.types.js';

import {
  validateImageBuffer,
} from '../../common/storage/image-validation.js';




export const createProductImageService = (
  productImageRepository:
    ProductImageRepository,
  productRepository:
    ProductRepository,
) => {
  return {
    getById: async (
      id: string,
    ) => {
      const image =
        await productImageRepository.findById(
          id,
        );

      if (!image) {
        throw new AppError(
          'Product image not found',
          404,
          'PRODUCT_IMAGE_NOT_FOUND',
        );
      }

      return toProductImageResponse(image);
    },

    listByProduct: async (
      productId: string,
    ) => {
      const product =
        await productRepository.findById(
          productId,
        );

      if (!product) {
        throw new AppError(
          'Product not found',
          404,
          'PRODUCT_NOT_FOUND',
        );
      }

      const images =
        await productImageRepository.findByProductId(
          productId,
        );

      return images.map(
        toProductImageResponse,
      );
    },

    create: async (
      data: CreateProductImageInput,
    ) => {
      const product =
        await productRepository.findById(
          data.productId,
        );

      if (!product) {
        throw new AppError(
          'Product not found',
          404,
          'PRODUCT_NOT_FOUND',
        );
      }

      const image =
        await productImageRepository.create(
          data,
        );

      return toProductImageResponse(image);
    },

    upload: async (
      data: UploadProductImageInput,
    ) => {
      const product =
        await productRepository.findById(
          data.productId,
        );

      if (!product) {
        throw new AppError(
          'Product not found',
          404,
          'PRODUCT_NOT_FOUND',
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
        );
      

      try {
        const image =
          await productImageRepository.create(
            {
              productId:
                data.productId,
              storageKey:
                storedFile.storageKey,
              url: storedFile.url,
              altText:
                data.altText ?? null,
              sortOrder:
                data.sortOrder ?? 0,
              isPrimary:
                data.isPrimary ?? false,
            },
          );

        return toProductImageResponse(
          image,
        );
      } catch (error) {
        await storageService.delete(
          storedFile.storageKey,
        );

        throw error;
      }
    },

    update: async (
      id: string,
      data: UpdateProductImageInput,
    ) => {
      const existing =
        await productImageRepository.findById(
          id,
        );

      if (!existing) {
        throw new AppError(
          'Product image not found',
          404,
          'PRODUCT_IMAGE_NOT_FOUND',
        );
      }

      const image =
        await productImageRepository.update(
          id,
          data,
        );

      return toProductImageResponse(image);
    },

    setPrimary: async (
      id: string,
    ) => {
      const existing =
        await productImageRepository.findById(
          id,
        );

      if (!existing) {
        throw new AppError(
          'Product image not found',
          404,
          'PRODUCT_IMAGE_NOT_FOUND',
        );
      }

      const image =
        await productImageRepository.setPrimary(
          id,
          existing.productId,
        );

      return toProductImageResponse(image);
    },

    delete: async (
      id: string,
    ) => {
      const existing =
        await productImageRepository.findById(
          id,
        );

      if (!existing) {
        throw new AppError(
          'Product image not found',
          404,
          'PRODUCT_IMAGE_NOT_FOUND',
        );
      }

      await productImageRepository.delete(
        id,
      );

      await storageService.delete(
        existing.storageKey,
      );
    },
  };
};