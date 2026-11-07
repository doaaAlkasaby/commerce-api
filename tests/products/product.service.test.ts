import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, ProductStatus } from '../../src/generated/prisma/client.js';
import { testPrisma } from '../../src/config/test-database.js';
import { ProductRepository } from '../../src/modules/products/product.repository.js';
import { createProductService } from '../../src/modules/products/product.service.js';
import type { ProductListQuery } from '../../src/modules/products/product.types.js';

vi.mock(
  '../../src/modules/product-reviews/product-review.repository.instance.js',
  () => ({
    productReviewRepository: {
      getRatingSummaries: vi.fn().mockResolvedValue([]),
    },
  }),
);

type ProductDetails = NonNullable<
  Awaited<ReturnType<ProductRepository['findById']>>
>;
const tenantId = '00000000-0000-4000-8000-000000000010';
const productId = '00000000-0000-4000-8000-000000000001';
const otherProductId = '00000000-0000-4000-8000-000000000002';
const categoryId = '00000000-0000-4000-8000-000000000003';
const brandId = '00000000-0000-4000-8000-000000000005';
const makeProduct = (
  overrides: Partial<ProductDetails> = {},
): ProductDetails => ({
  id: productId,
  tenantId,
  name: 'Product',
  slug: 'product',
  description: 'Product description',
  basePrice: new Prisma.Decimal('10.00'),
  tenant: { defaultCurrency: 'USD' },
  status: ProductStatus.DRAFT,
  categoryId,
  brandId: null,
  taxCategoryId: null,
  discountType: null,
  discountValue: null,
  discountStartsAt: null,
  discountEndsAt: null,
  category: { id: categoryId, name: 'Category', slug: 'category' },
  brand: null,
  images: [],
  attributes: [],
  variants: [],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});
const makeQuery = (
  overrides: Partial<ProductListQuery> = {},
): ProductListQuery => ({
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  ...overrides,
});
const uniqueConflict = () =>
  new Prisma.PrismaClientKnownRequestError('Unique conflict', {
    code: 'P2002',
    clientVersion: '7.10.1',
  });

describe('Product service', () => {
  // Spy on a real repository instance so signatures remain checked without casts.
  const repository = new ProductRepository(testPrisma);
  const service = createProductService(repository);
  const input = {
    name: 'Product',
    slug: 'product',
    basePrice: '10.00',
    categoryId,
  };

  beforeEach(() => {
    vi.spyOn(repository, 'categoryExists').mockResolvedValue(true);
    vi.spyOn(repository, 'brandExists').mockResolvedValue(true);
    vi.spyOn(repository, 'findBySlug').mockResolvedValue(null);
    vi.spyOn(repository, 'findById').mockResolvedValue(makeProduct());
    vi.spyOn(repository, 'create').mockResolvedValue(makeProduct());
    vi.spyOn(repository, 'update').mockResolvedValue(
      makeProduct({ name: 'Updated Product' }),
    );
    vi.spyOn(repository, 'countActiveVariants').mockResolvedValue(1);
    vi.spyOn(repository, 'updateStatus').mockResolvedValue(
      makeProduct({ status: ProductStatus.ACTIVE }),
    );
    vi.spyOn(repository, 'findList').mockResolvedValue({
      items: [makeProduct({ status: ProductStatus.ACTIVE })],
      total: 1,
    });
  });

  describe('create', () => {
    it('creates a product with the current base-price contract', async () => {
      await expect(service.create(tenantId, input)).resolves.toMatchObject({
        name: 'Product',
        slug: 'product',
        status: ProductStatus.DRAFT,
      });
      expect(repository.create).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        input,
      );
    });
    it('rejects a duplicate slug', async () => {
      vi.mocked(repository.findBySlug).mockResolvedValue(makeProduct());
      await expect(service.create(tenantId, input)).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_SLUG_ALREADY_EXISTS',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });
    it('translates a concurrent unique-key conflict', async () => {
      vi.mocked(repository.create).mockRejectedValue(uniqueConflict());
      await expect(service.create(tenantId, input)).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_ALREADY_EXISTS',
      });
    });
    it('rejects a missing category', async () => {
      vi.mocked(repository.categoryExists).mockResolvedValue(false);
      await expect(service.create(tenantId, input)).rejects.toMatchObject({
        statusCode: 404,
        code: 'CATEGORY_NOT_FOUND',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });
    it('checks category ownership in the current tenant', async () => {
      vi.mocked(repository.categoryExists).mockResolvedValue(false);
      await expect(service.create(tenantId, input)).rejects.toMatchObject({
        code: 'CATEGORY_NOT_FOUND',
      });
      expect(repository.categoryExists).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        categoryId,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
    it('rejects a missing brand', async () => {
      vi.mocked(repository.brandExists).mockResolvedValue(false);
      await expect(
        service.create(tenantId, { ...input, brandId }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'BRAND_NOT_FOUND' });
      expect(repository.create).not.toHaveBeenCalled();
    });
    it('checks brand ownership in the current tenant', async () => {
      vi.mocked(repository.brandExists).mockResolvedValue(false);
      await expect(
        service.create(tenantId, { ...input, brandId }),
      ).rejects.toMatchObject({ code: 'BRAND_NOT_FOUND' });
      expect(repository.brandExists).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        brandId,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates a product', async () => {
      await expect(
        service.update(tenantId, productId, { name: 'Updated Product' }),
      ).resolves.toMatchObject({ id: productId, name: 'Updated Product' });
      expect(repository.update).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        productId,
        { name: 'Updated Product' },
      );
    });
    it('rejects a duplicate slug', async () => {
      vi.mocked(repository.findBySlug).mockResolvedValue(
        makeProduct({ id: otherProductId, slug: 'taken' }),
      );
      await expect(
        service.update(tenantId, productId, { slug: 'taken' }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_SLUG_ALREADY_EXISTS',
      });
      expect(repository.update).not.toHaveBeenCalled();
    });
    it('translates a concurrent unique-key conflict', async () => {
      vi.mocked(repository.update).mockRejectedValue(uniqueConflict());
      await expect(
        service.update(tenantId, productId, { slug: 'taken' }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_ALREADY_EXISTS',
      });
    });
    it('rejects a category outside the tenant', async () => {
      vi.mocked(repository.categoryExists).mockResolvedValue(false);
      await expect(
        service.update(tenantId, productId, { categoryId }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'CATEGORY_NOT_FOUND' });
      expect(repository.categoryExists).toHaveBeenCalledWith(
        tenantId,
        categoryId,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
    it('rejects a brand outside the tenant', async () => {
      vi.mocked(repository.brandExists).mockResolvedValue(false);
      await expect(
        service.update(tenantId, productId, { brandId }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'BRAND_NOT_FOUND' });
      expect(repository.brandExists).toHaveBeenCalledWith(tenantId, brandId);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('status transitions', () => {
    it.each<[ProductStatus, ProductStatus]>([
      ['DRAFT', 'ACTIVE'],
      ['DRAFT', 'ARCHIVED'],
      ['ACTIVE', 'INACTIVE'],
      ['ACTIVE', 'ARCHIVED'],
      ['INACTIVE', 'ACTIVE'],
      ['INACTIVE', 'ARCHIVED'],
    ])('allows %s → %s', async (current, next) => {
      vi.mocked(repository.findById).mockResolvedValue(
        makeProduct({ status: current }),
      );
      vi.mocked(repository.updateStatus).mockResolvedValue(
        makeProduct({ status: next }),
      );
      await expect(
        service.changeStatus(tenantId, productId, next),
      ).resolves.toMatchObject({ status: next });
      expect(repository.updateStatus).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        productId,
        next,
      );
    });
    it('rejects ARCHIVED → ACTIVE', async () => {
      vi.mocked(repository.findById).mockResolvedValue(
        makeProduct({ status: 'ARCHIVED' }),
      );
      await expect(
        service.changeStatus(tenantId, productId, 'ACTIVE'),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'INVALID_PRODUCT_STATUS_TRANSITION',
      });
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
    it('rejects an invalid transition', async () => {
      vi.mocked(repository.findById).mockResolvedValue(
        makeProduct({ status: 'ACTIVE' }),
      );
      await expect(
        service.changeStatus(tenantId, productId, 'DRAFT'),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'INVALID_PRODUCT_STATUS_TRANSITION',
      });
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
    it('requires an active variant before activation', async () => {
      vi.mocked(repository.countActiveVariants).mockResolvedValue(0);
      await expect(
        service.changeStatus(tenantId, productId, 'ACTIVE'),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_REQUIRES_ACTIVE_VARIANT',
      });
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('public visibility', () => {
    it.each<ProductStatus>(['DRAFT', 'INACTIVE', 'ARCHIVED'])(
      'hides %s products by ID',
      async (status) => {
        vi.mocked(repository.findById).mockResolvedValue(
          makeProduct({ status }),
        );
        await expect(
          service.getById(tenantId, productId),
        ).rejects.toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
      },
    );
    it('returns an active product by ID', async () => {
      vi.mocked(repository.findById).mockResolvedValue(
        makeProduct({ status: 'ACTIVE' }),
      );
      await expect(service.getById(tenantId, productId)).resolves.toMatchObject(
        {
          id: productId,
          status: 'ACTIVE',
          basePrice: '10',
          rating: { average: 0, count: 0 },
          isInWishlist: false,
        },
      );
      expect(repository.findById).toHaveBeenCalledWith(productId, tenantId);
    });
    it('uses the tenant-scoped public listing repository', async () => {
      const query = makeQuery();
      const result = await service.list(tenantId, query);
      expect(repository.findList).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        query,
        0,
        20,
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.status).toBe('ACTIVE');
    });
  });

  describe('pagination', () => {
    beforeEach(() => {
      vi.mocked(repository.findList).mockResolvedValue({
        items: [makeProduct(), makeProduct({ id: otherProductId })],
        total: 5,
      });
    });
    it('returns the first page with the complete pagination contract', async () => {
      const result = await service.list(
        tenantId,
        makeQuery({ page: 1, limit: 2 }),
      );
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
    });
    it('returns the second page with the correct offset', async () => {
      const result = await service.list(
        tenantId,
        makeQuery({ page: 2, limit: 2 }),
      );
      expect(result.pagination).toMatchObject({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
      expect(repository.findList).toHaveBeenCalledWith(
        tenantId,
        expect.anything(),
        2,
        2,
      );
    });
    it('returns the requested limit', async () => {
      const result = await service.list(tenantId, makeQuery({ limit: 2 }));
      expect(result.pagination.limit).toBe(2);
      expect(result.items).toHaveLength(2);
    });
    it('returns the total count', async () => {
      expect((await service.list(tenantId, makeQuery())).pagination.total).toBe(
        5,
      );
    });
    it('calculates total pages', async () => {
      expect(
        (await service.list(tenantId, makeQuery({ limit: 2 }))).pagination
          .totalPages,
      ).toBe(3);
    });
  });

  describe('filtering and search', () => {
    it.each<Partial<ProductListQuery>>([
      { categoryId },
      { brandId },
      { minPrice: '10.00', maxPrice: '20.00' },
      { sortBy: 'basePrice', sortOrder: 'asc' },
      { search: 'product name' },
      { search: 'description text' },
      { search: 'SKU-1' },
    ])('forwards the current query and tenant: %j', async (filter) => {
      const query = makeQuery(filter);
      await service.list(tenantId, query);
      expect(repository.findList).toHaveBeenCalledExactlyOnceWith(
        tenantId,
        query,
        0,
        20,
      );
    });
  });
});
