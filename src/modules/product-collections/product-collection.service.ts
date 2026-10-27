import { AppError } from '../../common/errors/app-error.js';

import {
  mapCollectionProductItem,
  mapProductCollection,
} from './product-collection.mapper.js';

import type {
  CreateProductCollectionInput,
  UpdateProductCollectionInput,
  AddProductToCollectionInput,
  UpdateCollectionProductOrderInput,
} from './product-collection.types.js';

import type { ProductCollectionRepository } from './product-collection.repository.js';
import type { ProductRepository } from '../products/product.repository.js';

import { mapProductCard } from '../products/product.mapper.js';
import { productEnrichmentService } from '../products/product-enrichment.service.js';

import {
  calculateSkip,
  createPagination,
} from '../../common/pagination/pagination.js';

export class ProductCollectionService {
  constructor(
    private readonly repository: ProductCollectionRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  async listCollections(tenantId: string) {
    const collections = await this.repository.findMany(tenantId);

    return collections.map(mapProductCollection);
  }

  async getCollection(tenantId: string, id: string) {
    const collection = await this.repository.findPublicById(tenantId, id);

    if (!collection) {
      throw new AppError(
        'Collection not found',
        404,
        'COLLECTION_NOT_FOUND',
      );
    }

    return mapProductCollection(collection);
  }

  async createCollection(
    tenantId: string,
    input: CreateProductCollectionInput,
  ) {
    if (
      input.startsAt &&
      input.endsAt &&
      input.endsAt <= input.startsAt
    ) {
      throw new AppError(
        'endsAt must be after startsAt',
        400,
        'INVALID_COLLECTION_DATE_RANGE',
      );
    }

    const existing = await this.repository.findBySlug(tenantId, input.slug);

    if (existing) {
      throw new AppError(
        'Collection slug already exists',
        409,
        'COLLECTION_SLUG_ALREADY_EXISTS',
      );
    }

    const collection = await this.repository.create(tenantId, input);

    return mapProductCollection(collection);
  }

  async updateCollection(
    tenantId: string,
    id: string,
    input: UpdateProductCollectionInput,
  ) {
    const existing = await this.repository.findById(tenantId, id);

    if (!existing) {
      throw new AppError(
        'Collection not found',
        404,
        'COLLECTION_NOT_FOUND',
      );
    }

    const startsAt =
      input.startsAt !== undefined
        ? input.startsAt
        : existing.startsAt;

    const endsAt =
      input.endsAt !== undefined
        ? input.endsAt
        : existing.endsAt;

    if (
      startsAt &&
      endsAt &&
      endsAt <= startsAt
    ) {
      throw new AppError(
        'endsAt must be after startsAt',
        400,
        'INVALID_COLLECTION_DATE_RANGE',
      );
    }

    if (
      input.slug !== undefined &&
      input.slug !== existing.slug
    ) {
      const slugExists =
        await this.repository.findBySlug(tenantId, input.slug);

      if (slugExists) {
        throw new AppError(
          'Collection slug already exists',
          409,
          'COLLECTION_SLUG_ALREADY_EXISTS',
        );
      }
    }

    const collection =
      await this.repository.update(tenantId, id, input);

    return mapProductCollection(collection);
  }

  async deleteCollection(tenantId: string, id: string) {
    const existing = await this.repository.findById(tenantId, id);

    if (!existing) {
      throw new AppError(
        'Collection not found',
        404,
        'COLLECTION_NOT_FOUND',
      );
    }

    await this.repository.delete(tenantId, id);

    return null;
  }

  async addProduct(
    tenantId: string,
    collectionId: string,
    input: AddProductToCollectionInput,
  ) {
    const collection =
      await this.repository.findById(tenantId, collectionId);

    if (!collection) {
      throw new AppError(
        'Collection not found',
        404,
        'COLLECTION_NOT_FOUND',
      );
    }

    const product =
      await this.repository.findProduct(tenantId, input.productId);

    if (!product) {
      throw new AppError(
        'Product not found',
        404,
        'PRODUCT_NOT_FOUND',
      );
    }

    const existing =
      await this.repository.findCollectionProduct(
        tenantId,
        collectionId,
        input.productId,
      );

    if (existing) {
      throw new AppError(
        'Product is already in this collection',
        409,
        'PRODUCT_ALREADY_IN_COLLECTION',
      );
    }

    const item =
      await this.repository.addProduct(
        tenantId,
        collectionId,
        input,
      );

    return mapCollectionProductItem(item);
  }

  async removeProduct(
    tenantId: string,
    collectionId: string,
    productId: string,
  ) {
    const collection =
      await this.repository.findById(tenantId, collectionId);

    if (!collection) {
      throw new AppError(
        'Collection not found',
        404,
        'COLLECTION_NOT_FOUND',
      );
    }

    const existing =
      await this.repository.findCollectionProduct(
        tenantId,
        collectionId,
        productId,
      );

    if (!existing) {
      throw new AppError(
        'Product is not in this collection',
        404,
        'PRODUCT_NOT_IN_COLLECTION',
      );
    }

    await this.repository.removeProduct(
      tenantId,
      collectionId,
      productId,
    );

    return null;
  }

  async updateProductOrder(
    tenantId: string,
    collectionId: string,
    productId: string,
    input: UpdateCollectionProductOrderInput,
  ) {
    const collection =
      await this.repository.findById(tenantId, collectionId);

    if (!collection) {
      throw new AppError(
        'Collection not found',
        404,
        'COLLECTION_NOT_FOUND',
      );
    }

    const existing =
      await this.repository.findCollectionProduct(
        tenantId,
        collectionId,
        productId,
      );

    if (!existing) {
      throw new AppError(
        'Product is not in this collection',
        404,
        'PRODUCT_NOT_IN_COLLECTION',
      );
    }

    const item =
      await this.repository.updateProductOrder(
        tenantId,
        collectionId,
        productId,
        input,
      );

    if (!item) {
      throw new AppError('Product is not in this collection', 404, 'PRODUCT_NOT_IN_COLLECTION');
    }

    return mapCollectionProductItem(item);
  }

  async getProducts(
    tenantId: string,
    collectionId: string,
    page: number,
    limit: number,
    userId?: string
  ) {
    const collection =
      await this.repository.findPublicById(tenantId, collectionId);

    if (!collection) {
      throw new AppError(
        'Collection not found',
        404,
        'COLLECTION_NOT_FOUND',
      );
    }

    const skip = calculateSkip(page, limit);

    const { items, total } =
      await this.productRepository.findCollectionProducts(
        tenantId,
        collectionId,
        skip,
        limit,
      );
    const enrichedItems =
      await productEnrichmentService.enrichProducts(items, tenantId, userId);

    return {
      collection: {
        id: collection.id,
        name: collection.name,
        slug: collection.slug,
        description: collection.description,
        imageUrl: collection.imageUrl,
      },

      items: enrichedItems.map(mapProductCard),

      pagination: createPagination(
        page,
        limit,
        total,
      ),
    };
  }
}
