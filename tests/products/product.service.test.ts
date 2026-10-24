import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  Prisma,
  ProductStatus,
} from '../../src/generated/prisma/client.js';

import type {
  Brand,
  Category,
} from '../../src/generated/prisma/client.js';

import type {
  ProductWithDetailsRelations,
} from '../../src/modules/products/product.mapper.js';

import {
  createBrandRepository,
} from '../../src/modules/brands/brand.repository.js';

import {
  createCategoryRepository,
} from '../../src/modules/categories/category.repository.js';

import {
  createProductRepository,
} from '../../src/modules/products/product.repository.js';

import {
  createProductService,
} from '../../src/modules/products/product.service.js';

import type {
  ProductListQuery,
} from '../../src/modules/products/product.types.js';

type ProductRepository =
  ReturnType<typeof createProductRepository>;
type CategoryRepository =
  ReturnType<typeof createCategoryRepository>;
type BrandRepository =
  ReturnType<typeof createBrandRepository>;

const productId = '00000000-0000-4000-8000-000000000001';
const otherProductId = '00000000-0000-4000-8000-000000000002';
const categoryId = '00000000-0000-4000-8000-000000000003';
const otherCategoryId = '00000000-0000-4000-8000-000000000004';
const brandId = '00000000-0000-4000-8000-000000000005';
const otherBrandId = '00000000-0000-4000-8000-000000000006';

const makeProduct = (
  overrides: Partial<ProductWithDetailsRelations> = {},
): ProductWithDetailsRelations => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  return {
    id: productId,
    name: 'Product',
    slug: 'product',
    sku: 'SKU-1',
    description: 'Product description',
    price: new Prisma.Decimal('10.00'),
    status: ProductStatus.DRAFT,
    categoryId,
    brandId: null,
    category: {
      id: categoryId,
      name: 'Category',
      slug: 'category',
    },
    brand: null,
    images: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

const makeCategory = (
  overrides: Partial<Category> = {},
): Category => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  return {
    id: categoryId,
    name: 'Category',
    slug: 'category',
    description: null,
    imageStorageKey: null,
    imageUrl: null,
    isActive: true,
    parentId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

const makeBrand = (
  overrides: Partial<Brand> = {},
): Brand => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  return {
    id: brandId,
    name: 'Brand',
    slug: 'brand',
    description: null,
    imageStorageKey: null,
    imageUrl: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

const makeProductRepository = (): ProductRepository => ({
  findById: vi.fn<ProductRepository['findById']>(),
  findBySlug: vi.fn<ProductRepository['findBySlug']>(),
  findBySku: vi.fn<ProductRepository['findBySku']>(),
  create: vi.fn<ProductRepository['create']>(),
  update: vi.fn<ProductRepository['update']>(),
  updateStatus: vi.fn<ProductRepository['updateStatus']>(),
  list: vi.fn<ProductRepository['list']>(),
  delete: vi.fn<ProductRepository['delete']>(),
});

const makeCategoryRepository = (): CategoryRepository => ({
  findById: vi.fn<CategoryRepository['findById']>(),
  findBySlug: vi.fn<CategoryRepository['findBySlug']>(),
  findAll: vi.fn<CategoryRepository['findAll']>(),
  findActive: vi.fn<CategoryRepository['findActive']>(),
  findChildren: vi.fn<CategoryRepository['findChildren']>(),
  create: vi.fn<CategoryRepository['create']>(),
  update: vi.fn<CategoryRepository['update']>(),
  updateStatus: vi.fn<CategoryRepository['updateStatus']>(),
  updateImage: vi.fn<CategoryRepository['updateImage']>(),
  delete: vi.fn<CategoryRepository['delete']>(),
});

const makeBrandRepository = (): BrandRepository => ({
  findById: vi.fn<BrandRepository['findById']>(),
  findBySlug: vi.fn<BrandRepository['findBySlug']>(),
  findAll: vi.fn<BrandRepository['findAll']>(),
  findActive: vi.fn<BrandRepository['findActive']>(),
  create: vi.fn<BrandRepository['create']>(),
  update: vi.fn<BrandRepository['update']>(),
  updateStatus: vi.fn<BrandRepository['updateStatus']>(),
  updateImage: vi.fn<BrandRepository['updateImage']>(),
  delete: vi.fn<BrandRepository['delete']>(),
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

describe('Product service', () => {
  let productRepository: ProductRepository;
  let categoryRepository: CategoryRepository;
  let brandRepository: BrandRepository;
  let service: ReturnType<typeof createProductService>;

  beforeEach(() => {
    vi.resetAllMocks();
    productRepository = makeProductRepository();
    categoryRepository = makeCategoryRepository();
    brandRepository = makeBrandRepository();
    service = createProductService(
      productRepository,
      categoryRepository,
      brandRepository,
    );
  });

  describe('create', () => {
    const input = {
      name: 'Product',
      slug: 'product',
      sku: 'SKU-1',
      price: '10.00',
      categoryId,
    };

    beforeEach(() => {
      vi.mocked(productRepository.findBySlug).mockResolvedValue(null);
      vi.mocked(productRepository.findBySku).mockResolvedValue(null);
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory(),
      );
      vi.mocked(brandRepository.findById).mockResolvedValue(
        makeBrand(),
      );
      vi.mocked(productRepository.create).mockResolvedValue(
        makeProduct(),
      );
    });

    it('creates a product', async () => {
      await expect(
        service.create(input),
      ).resolves.toMatchObject({
        name: 'Product',
        slug: 'product',
        sku: 'SKU-1',
        status: ProductStatus.DRAFT,
      });
    });

    it('rejects a duplicate slug', async () => {
      vi.mocked(productRepository.findBySlug).mockResolvedValue(
        makeProduct(),
      );

      await expect(
        service.create(input),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_SLUG_ALREADY_EXISTS',
      });
      expect(productRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate SKU', async () => {
      vi.mocked(productRepository.findBySku).mockResolvedValue(
        makeProduct(),
      );

      await expect(
        service.create(input),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_SKU_ALREADY_EXISTS',
      });
      expect(productRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a missing category', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(null);

      await expect(
        service.create(input),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'CATEGORY_NOT_FOUND',
      });
      expect(productRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive category', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory({
          isActive: false,
        }),
      );

      await expect(
        service.create(input),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'CATEGORY_INACTIVE',
      });
      expect(productRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a missing brand', async () => {
      vi.mocked(brandRepository.findById).mockResolvedValue(null);

      await expect(
        service.create({
          ...input,
          brandId,
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'BRAND_NOT_FOUND',
      });
      expect(productRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive brand', async () => {
      vi.mocked(brandRepository.findById).mockResolvedValue(
        makeBrand({
          isActive: false,
        }),
      );

      await expect(
        service.create({
          ...input,
          brandId,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'BRAND_INACTIVE',
      });
      expect(productRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      vi.mocked(productRepository.findById).mockResolvedValue(
        makeProduct(),
      );
      vi.mocked(productRepository.findBySlug).mockResolvedValue(null);
      vi.mocked(productRepository.findBySku).mockResolvedValue(null);
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory({
          id: otherCategoryId,
        }),
      );
      vi.mocked(brandRepository.findById).mockResolvedValue(
        makeBrand({
          id: otherBrandId,
        }),
      );
      vi.mocked(productRepository.update).mockResolvedValue(
        makeProduct({
          name: 'Updated Product',
        }),
      );
    });

    it('updates a product', async () => {
      await expect(
        service.update(productId, {
          name: 'Updated Product',
        }),
      ).resolves.toMatchObject({
        id: productId,
        name: 'Updated Product',
      });
    });

    it('rejects a duplicate slug', async () => {
      vi.mocked(productRepository.findBySlug).mockResolvedValue(
        makeProduct({
          id: otherProductId,
          slug: 'taken',
        }),
      );

      await expect(
        service.update(productId, {
          slug: 'taken',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_SLUG_ALREADY_EXISTS',
      });
      expect(productRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a duplicate SKU', async () => {
      vi.mocked(productRepository.findBySku).mockResolvedValue(
        makeProduct({
          id: otherProductId,
          sku: 'TAKEN-SKU',
        }),
      );

      await expect(
        service.update(productId, {
          sku: 'TAKEN-SKU',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_SKU_ALREADY_EXISTS',
      });
      expect(productRepository.update).not.toHaveBeenCalled();
    });

    it('rejects an inactive category', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory({
          id: otherCategoryId,
          isActive: false,
        }),
      );

      await expect(
        service.update(productId, {
          categoryId: otherCategoryId,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'CATEGORY_INACTIVE',
      });
      expect(productRepository.update).not.toHaveBeenCalled();
    });

    it('rejects an inactive brand', async () => {
      vi.mocked(brandRepository.findById).mockResolvedValue(
        makeBrand({
          id: otherBrandId,
          isActive: false,
        }),
      );

      await expect(
        service.update(productId, {
          brandId: otherBrandId,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'BRAND_INACTIVE',
      });
      expect(productRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('status transitions', () => {
    const allowedTransitions: Array<
      [ProductStatus, ProductStatus]
    > = [
      [ProductStatus.DRAFT, ProductStatus.ACTIVE],
      [ProductStatus.DRAFT, ProductStatus.ARCHIVED],
      [ProductStatus.ACTIVE, ProductStatus.INACTIVE],
      [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],
      [ProductStatus.INACTIVE, ProductStatus.ACTIVE],
      [ProductStatus.INACTIVE, ProductStatus.ARCHIVED],
    ];

    it.each(allowedTransitions)(
      'allows %s → %s',
      async (currentStatus, nextStatus) => {
        vi.mocked(productRepository.findById).mockResolvedValue(
          makeProduct({
            status: currentStatus,
          }),
        );
        vi.mocked(productRepository.updateStatus).mockResolvedValue(
          makeProduct({
            status: nextStatus,
          }),
        );

        await expect(
          service.updateStatus(productId, nextStatus),
        ).resolves.toMatchObject({
          status: nextStatus,
        });
        expect(productRepository.updateStatus).toHaveBeenCalledWith(
          productId,
          nextStatus,
        );
      },
    );

    it('rejects ARCHIVED → ACTIVE', async () => {
      vi.mocked(productRepository.findById).mockResolvedValue(
        makeProduct({
          status: ProductStatus.ARCHIVED,
        }),
      );

      await expect(
        service.updateStatus(productId, ProductStatus.ACTIVE),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PRODUCT_STATUS_TRANSITION',
      });
      expect(productRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects an invalid transition', async () => {
      vi.mocked(productRepository.findById).mockResolvedValue(
        makeProduct({
          status: ProductStatus.ACTIVE,
        }),
      );

      await expect(
        service.updateStatus(productId, ProductStatus.DRAFT),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PRODUCT_STATUS_TRANSITION',
      });
      expect(productRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('public visibility', () => {
    it.each([
      ProductStatus.DRAFT,
      ProductStatus.INACTIVE,
      ProductStatus.ARCHIVED,
    ])('hides %s products by ID', async (status) => {
      vi.mocked(productRepository.findById).mockResolvedValue(
        makeProduct({
          status,
        }),
      );

      await expect(
        service.getPublicById(productId),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
    });

    it('returns an active product by ID', async () => {
      vi.mocked(productRepository.findById).mockResolvedValue(
        makeProduct({
          status: ProductStatus.ACTIVE,
        }),
      );

      await expect(
        service.getPublicById(productId),
      ).resolves.toMatchObject({
        id: productId,
        status: ProductStatus.ACTIVE,
      });
    });

    it('returns only active products from public lists', async () => {
      const activeProduct = makeProduct({
        status: ProductStatus.ACTIVE,
      });
      vi.mocked(productRepository.list).mockResolvedValue({
        items: [activeProduct],
        total: 1,
      });

      await service.listPublic(makeQuery({
        status: ProductStatus.DRAFT,
      }));

      expect(productRepository.list).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ProductStatus.ACTIVE,
        }),
      );
    });
  });

  describe('pagination', () => {
    const products = [
      makeProduct({ id: productId }),
      makeProduct({ id: otherProductId }),
    ];

    beforeEach(() => {
      vi.mocked(productRepository.list).mockResolvedValue({
        items: products,
        total: 5,
      });
    });

    it('returns page 1 and hasNextPage', async () => {
      const result = await service.listAdmin(makeQuery({
        page: 1,
        limit: 2,
      }));

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPreviousPage).toBe(false);
    });

    it('returns page 2 and hasPreviousPage', async () => {
      const result = await service.listAdmin(makeQuery({
        page: 2,
        limit: 2,
      }));

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.hasPreviousPage).toBe(true);
    });

    it('returns the requested limit', async () => {
      const result = await service.listAdmin(makeQuery({
        limit: 2,
      }));

      expect(result.pagination.limit).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it('returns the total count', async () => {
      const result = await service.listAdmin(makeQuery());

      expect(result.pagination.total).toBe(5);
    });

    it('calculates total pages', async () => {
      const result = await service.listAdmin(makeQuery({
        limit: 2,
      }));

      expect(result.pagination.totalPages).toBe(3);
    });
  });

  describe('filtering and search', () => {
    beforeEach(() => {
      vi.mocked(productRepository.list).mockResolvedValue({
        items: [makeProduct()],
        total: 1,
      });
    });

    it('passes category filters to the repository', async () => {
      const query = makeQuery({
        categoryId,
      });
      await service.listAdmin(query);
      expect(productRepository.list).toHaveBeenCalledWith(query);
    });

    it('passes brand filters to the repository', async () => {
      const query = makeQuery({
        brandId,
      });
      await service.listAdmin(query);
      expect(productRepository.list).toHaveBeenCalledWith(query);
    });

    it('passes price range filters to the repository', async () => {
      const query = makeQuery({
        minPrice: '10.00',
        maxPrice: '20.00',
      });
      await service.listAdmin(query);
      expect(productRepository.list).toHaveBeenCalledWith(query);
    });

    it('passes status filters to the repository', async () => {
      const query = makeQuery({
        status: ProductStatus.ARCHIVED,
      });
      await service.listAdmin(query);
      expect(productRepository.list).toHaveBeenCalledWith(query);
    });

    it.each(['product name', 'description text', 'SKU-1'])(
      'passes search term "%s" to the repository',
      async (search) => {
        const query = makeQuery({
          search,
        });
        await service.listAdmin(query);
        expect(productRepository.list).toHaveBeenCalledWith(query);
      },
    );
  });
});
