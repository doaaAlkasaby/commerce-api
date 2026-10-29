import { AppError } from '../../common/errors/app-error.js';

import type { StorageService } from '../../common/storage/storage.types.js';

import type { ProductVariantImageRepository } from './product-variant-image.repository.js';

import { validateImageBuffer } from '../../common/storage/image-validation.js';

const isPrismaUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

export class ProductVariantImageService {
  constructor(
    private readonly repository: ProductVariantImageRepository,

    private readonly storage: StorageService,

    private readonly productVariantRepository: {
      findById(tenantId: string, id: string): Promise<unknown>;
    },
  ) {}

  async getById(tenantId: string, id: string) {
    const image = await this.repository.findById(tenantId, id);

    if (!image) {
      throw new AppError(
        'Product variant image not found',
        404,
        'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
      );
    }

    return image;
  }

  async getByVariantId(tenantId: string, variantId: string) {
    const variant = await this.productVariantRepository.findById(tenantId, variantId);

    if (!variant) {
      throw new AppError(
        'Product variant not found',
        404,
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    }

    return this.repository.findByVariantId(tenantId, variantId);
  }

  async create(tenantId: string, data: {
    variantId: string;
    storageKey: string;
    url: string;
    altText?: string | null;
    sortOrder?: number;
    isPrimary?: boolean;
  }) {
    const variant = await this.productVariantRepository.findById(
      tenantId,
      data.variantId,
    );

    if (!variant) {
      throw new AppError(
        'Product variant not found',
        404,
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    }

    const existingImages = await this.repository.findByVariantId(
      tenantId,
      data.variantId,
    );

    /*
     * First image automatically becomes
     * primary if the client didn't explicitly
     * choose otherwise.
     */
    const isPrimary = data.isPrimary ?? existingImages.length === 0;

    try {
      const image = await this.repository.create(tenantId, {
        variantId: data.variantId,

        storageKey: data.storageKey,

        url: data.url,

        altText: data.altText ?? null,

        sortOrder: data.sortOrder ?? 0,

        isPrimary: false,
      });
      if (!image) throw new AppError('Product variant not found', 404, 'PRODUCT_VARIANT_NOT_FOUND');

      if (isPrimary) {
        const primaryImage = await this.repository.setPrimary(tenantId, image.id);

        if (!primaryImage) {
          throw new AppError(
            'Product variant image not found',
            404,
            'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
          );
        }

        return primaryImage;
      }

      return image;
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'Unable to set this image as primary',
          409,
          'PRIMARY_IMAGE_CONFLICT',
        );
      }

      throw error;
    }
  }

  async upload(tenantId: string, data: {
    variantId: string;
    file: Buffer;
    originalName: string;
    contentType: string;
    altText?: string | null;
    sortOrder?: number;
    isPrimary?: boolean;
  }) {
    const variant = await this.productVariantRepository.findById(
      tenantId,
      data.variantId,
    );

    if (!variant) {
      throw new AppError(
        'Product variant not found',
        404,
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    }

    validateImageBuffer(data.file, data.contentType);

    const storedFile = await this.storage.upload(
      data.file,
      data.originalName,
      data.contentType,
    );

    try {
      return await this.create(tenantId, {
        variantId: data.variantId,
        storageKey: storedFile.storageKey,
        url: storedFile.url,
        ...(data.altText !== undefined ? { altText: data.altText } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
      });
    } catch (error) {
      await this.storage.delete(storedFile.storageKey);
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    data: {
      altText?: string | null;
      sortOrder?: number;
    },
  ) {
    const image = await this.repository.findById(tenantId, id);

    if (!image) {
      throw new AppError(
        'Product variant image not found',
        404,
        'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
      );
    }

    const updated = await this.repository.update(tenantId, id, data);
    if (!updated) throw new AppError('Product variant image not found', 404, 'PRODUCT_VARIANT_IMAGE_NOT_FOUND');
    return updated;
  }

  async setPrimary(tenantId: string, id: string) {
    const image = await this.repository.findById(tenantId, id);

    if (!image) {
      throw new AppError(
        'Product variant image not found',
        404,
        'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
      );
    }

    try {
      const primaryImage = await this.repository.setPrimary(tenantId, id);

      if (!primaryImage) {
        throw new AppError(
          'Product variant image not found',
          404,
          'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
        );
      }

      return primaryImage;
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'Unable to set this image as primary',
          409,
          'PRIMARY_IMAGE_CONFLICT',
        );
      }

      throw error;
    }
  }

  async delete(tenantId: string, id: string) {
    const image = await this.repository.findById(tenantId, id);

    if (!image) {
      throw new AppError(
        'Product variant image not found',
        404,
        'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
      );
    }

    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) throw new AppError('Product variant image not found', 404, 'PRODUCT_VARIANT_IMAGE_NOT_FOUND');

    await this.storage.delete(image.storageKey);
  }
}
