import { Prisma, ProductStatus } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

import type {
  CreateProductInput,
  ProductListQuery,
  UpdateProductInput,
} from './product.types.js';

import type { ProductRepository } from './product.repository.js';

import {
  mapProductCard,
  mapProductDetails,
  mapProductListItem,
} from './product.mapper.js';

import {
  calculateSkip,
  createPagination,
} from '../../common/pagination/pagination.js';
import { productEnrichmentService } from './product-enrichment.service.js';

export class ProductService {
  constructor(private readonly productRepository: ProductRepository) {}

  async create(tenantId: string, input: CreateProductInput) {
    const categoryExists = await this.productRepository.categoryExists(
      tenantId, input.categoryId,
    );

    if (!categoryExists) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    if (input.brandId) {
      const brandExists = await this.productRepository.brandExists(
        tenantId, input.brandId,
      );

      if (!brandExists) {
        throw new AppError('Brand not found', 404, 'BRAND_NOT_FOUND');
      }
    }

    const existing = await this.productRepository.findBySlug(input.slug, tenantId);

    if (existing) {
      throw new AppError(
        'Product slug already exists',
        409,
        'PRODUCT_SLUG_ALREADY_EXISTS',
      );
    }

    try {
      return await this.productRepository.create(tenantId, input);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'Product already exists',
          409,
          'PRODUCT_ALREADY_EXISTS',
        );
      }

      throw error;
    }
  }

  async update(tenantId: string, id: string, input: UpdateProductInput) {
    const product = await this.productRepository.findById(id, tenantId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    if (input.categoryId) {
      const categoryExists = await this.productRepository.categoryExists(
        tenantId, input.categoryId,
      );

      if (!categoryExists) {
        throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
      }
    }

    if (input.brandId) {
      const brandExists = await this.productRepository.brandExists(
        tenantId, input.brandId,
      );

      if (!brandExists) {
        throw new AppError('Brand not found', 404, 'BRAND_NOT_FOUND');
      }
    }

    if (input.slug && input.slug !== product.slug) {
      const existing = await this.productRepository.findBySlug(input.slug, tenantId);

      if (existing && existing.id !== id) {
        throw new AppError(
          'Product slug already exists',
          409,
          'PRODUCT_SLUG_ALREADY_EXISTS',
        );
      }
    }

    try {
      return await this.productRepository.update(tenantId, id, input);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'Product already exists',
          409,
          'PRODUCT_ALREADY_EXISTS',
        );
      }

      throw error;
    }
  }

  async changeStatus(tenantId: string, id: string, newStatus: ProductStatus) {
    const product = await this.productRepository.findById(id, tenantId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const allowedTransitions: Record<ProductStatus, ProductStatus[]> = {
      [ProductStatus.DRAFT]: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],

      [ProductStatus.ACTIVE]: [ProductStatus.INACTIVE, ProductStatus.ARCHIVED],

      [ProductStatus.INACTIVE]: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],

      [ProductStatus.ARCHIVED]: [],
    };

    if (!allowedTransitions[product.status].includes(newStatus)) {
      throw new AppError(
        `Cannot change product status from ${product.status} to ${newStatus}`,
        409,
        'INVALID_PRODUCT_STATUS_TRANSITION',
      );
    }

    if (newStatus === ProductStatus.ACTIVE) {
      const activeVariants =
        await this.productRepository.countActiveVariants(tenantId, id);

      if (activeVariants === 0) {
        throw new AppError(
          'Product must have at least one active variant before activation',
          409,
          'PRODUCT_REQUIRES_ACTIVE_VARIANT',
        );
      }
    }

    return this.productRepository.updateStatus(tenantId, id, newStatus);
  }

  async getById(tenantId: string, id: string, userId?: string) {
    const product = await this.productRepository.findById(id, tenantId);

    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const [enrichedProduct] = await productEnrichmentService.enrichProducts(
      [product],
      tenantId,
      userId,
    );

    if (!enrichedProduct) {
      throw new Error('Product enrichment returned no product');
    }

    return {
      ...mapProductDetails(enrichedProduct),
      rating: enrichedProduct.rating,
      isInWishlist: enrichedProduct.isInWishlist,
    };
  }

  async list(tenantId: string, query: ProductListQuery, userId?: string) {
    const skip = calculateSkip(query.page, query.limit);

    const { items, total } = await this.productRepository.findList(
      tenantId, query,
      skip,
      query.limit,
    );

    const enrichedItems = await productEnrichmentService.enrichProducts(
      items,
      tenantId,
      userId,
    );

    return {
      items: enrichedItems.map((product) => ({
        ...mapProductListItem(product),
        rating: product.rating,
        isInWishlist: product.isInWishlist,
      })),

      pagination: createPagination(query.page, query.limit, total),
    };
  }

  async delete(tenantId: string, id: string) {
    const product = await this.productRepository.findById(id, tenantId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    if (product.status === ProductStatus.ACTIVE) {
      throw new AppError(
        'Active products cannot be deleted',
        409,
        'ACTIVE_PRODUCT_CANNOT_BE_DELETED',
      );
    }

    try {
      return await this.productRepository.delete(tenantId, id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new AppError(
          'Product cannot be deleted because it is referenced by other records',
          409,
          'PRODUCT_HAS_DEPENDENCIES',
        );
      }

      throw error;
    }
  }

  async getOffers(tenantId: string, page: number, limit: number, userId?: string) {
    const skip = calculateSkip(page, limit);

    const { items, total } = await this.productRepository.findOffers(
      tenantId, skip,
      limit,
    );

    const enrichedItems = await productEnrichmentService.enrichProducts(
      items,
      tenantId,
      userId,
    );

    return {
      items: enrichedItems.map(mapProductCard),

      pagination: createPagination(page, limit, total),
    };
  }

  async getBestSellers(tenantId: string, page: number, limit: number, userId?: string) {
    const skip = calculateSkip(page, limit);

    const { items, total } = await this.productRepository.findBestSellers(
      tenantId, skip,
      limit,
    );

    const enrichedItems = await productEnrichmentService.enrichProducts(
      items,
      tenantId,
      userId,
    );

    return {
      items: enrichedItems.map(mapProductCard),

      pagination: createPagination(page, limit, total),
    };
  }

  async getNewArrivals(tenantId: string, page: number, limit: number, userId?: string) {
    const skip = calculateSkip(page, limit);

    const { items, total } = await this.productRepository.findNewArrivals(
      tenantId, skip,
      limit,
    );

    const enrichedItems = await productEnrichmentService.enrichProducts(
      items,
      tenantId,
      userId,
    );

    return {
      items: enrichedItems.map(mapProductCard),

      pagination: createPagination(page, limit, total),
    };
  }
}

export const createProductService = (productRepository: ProductRepository) =>
  new ProductService(productRepository);
