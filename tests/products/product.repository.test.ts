import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  ProductStatus,
} from '../../src/generated/prisma/client.js';

import {
  testPrisma,
} from '../../src/config/test-database.js';

import {
  createBrandRepository,
} from '../../src/modules/brands/brand.repository.js';

import {
  createCategoryRepository,
} from '../../src/modules/categories/category.repository.js';

import {
  createProductRepository,
} from '../../src/modules/products/product.repository.js';

describe('Product repository', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const categorySlug = `product-repo-category-${runId}`;
  const otherCategorySlug = `product-repo-other-category-${runId}`;
  const brandSlug = `product-repo-brand-${runId}`;
  const otherBrandSlug = `product-repo-other-brand-${runId}`;

  const categoryRepository = createCategoryRepository(testPrisma);
  const brandRepository = createBrandRepository(testPrisma);
  const repository = createProductRepository(testPrisma);

  let categoryId: string;
  let otherCategoryId: string;
  let brandId: string;
  let otherBrandId: string;
  const productIds: string[] = [];

  beforeAll(async () => {
    await testPrisma.$connect();

    const category = await categoryRepository.create({
      name: 'Product Test Category',
      slug: categorySlug,
    });
    categoryId = category.id;

    const otherCategory = await categoryRepository.create({
      name: 'Product Test Other Category',
      slug: otherCategorySlug,
    });
    otherCategoryId = otherCategory.id;

    const brand = await brandRepository.create({
      name: 'Product Test Brand',
      slug: brandSlug,
    });
    brandId = brand.id;

    const otherBrand = await brandRepository.create({
      name: 'Product Test Other Brand',
      slug: otherBrandSlug,
    });
    otherBrandId = otherBrand.id;

    const fixtures = [
      {
        name: 'Alpha Running Shoe',
        slug: `product-alpha-${runId}`,
        sku: `SKU-ALPHA-${runId}`,
        description: 'Lightweight running footwear',
        price: '10.00',
        categoryId,
        brandId,
        status: ProductStatus.ACTIVE,
      },
      {
        name: 'Beta Hiking Boot',
        slug: `product-beta-${runId}`,
        sku: `SKU-BETA-${runId}`,
        description: 'Durable trail boot',
        price: '25.00',
        categoryId: otherCategoryId,
        brandId: otherBrandId,
        status: ProductStatus.INACTIVE,
      },
      {
        name: 'Gamma Sneaker',
        slug: `product-gamma-${runId}`,
        sku: `SKU-GAMMA-${runId}`,
        description: 'Everyday casual shoe',
        price: '50.00',
        categoryId,
        brandId: otherBrandId,
        status: ProductStatus.ARCHIVED,
      },
    ];

    for (const fixture of fixtures) {
      const { status, ...input } = fixture;
      const product = await repository.create(input);
      productIds.push(product.id);
      await repository.updateStatus(product.id, status);
    }
  });

  afterAll(async () => {
    if (productIds.length > 0) {
      await testPrisma.product.deleteMany({
        where: {
          id: {
            in: productIds,
          },
        },
      });
    }
    await testPrisma.brand.deleteMany({
      where: {
        id: {
          in: [brandId, otherBrandId],
        },
      },
    });
    await testPrisma.category.deleteMany({
      where: {
        id: {
          in: [categoryId, otherCategoryId],
        },
      },
    });
    await testPrisma.$disconnect();
  });

  it('creates a product and looks it up by ID, slug, and SKU', async () => {
    const product = await repository.findById(productIds[0]!);
    const bySlug = await repository.findBySlug(`product-alpha-${runId}`);
    const bySku = await repository.findBySku(`SKU-ALPHA-${runId}`);

    expect(product?.id).toBe(productIds[0]);
    expect(bySlug?.id).toBe(productIds[0]);
    expect(bySku?.id).toBe(productIds[0]);
  });

  it('updates product fields and relations', async () => {
    const updated = await repository.update(productIds[0]!, {
      name: 'Alpha Updated',
      categoryId: otherCategoryId,
      brandId: null,
    });

    expect(updated.name).toBe('Alpha Updated');
    expect(updated.categoryId).toBe(otherCategoryId);
    expect(updated.brandId).toBeNull();

    await repository.update(productIds[0]!, {
      name: 'Alpha Running Shoe',
      categoryId,
      brandId,
    });
  });

  it('disconnects and reconnects an optional brand', async () => {
    const disconnected = await repository.update(productIds[0]!, {
      brandId: null,
    });
    const connected = await repository.update(productIds[0]!, {
      brandId,
    });

    expect(disconnected.brandId).toBeNull();
    expect(connected.brandId).toBe(brandId);
  });

  it('filters by category, brand, status, and price range', async () => {
    const { items } = await repository.list({
      page: 1,
      limit: 20,
      categoryId,
      brandId,
      status: ProductStatus.ACTIVE,
      minPrice: '9.00',
      maxPrice: '11.00',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(items.map(({ id }) => id)).toContain(productIds[0]);
    expect(items.map(({ id }) => id)).not.toContain(productIds[1]);
    expect(items.map(({ id }) => id)).not.toContain(productIds[2]);
  });

  it('paginates and returns a total count', async () => {
    const firstPage = await repository.list({
      page: 1,
      limit: 2,
      categoryId,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    const secondPage = await repository.list({
      page: 2,
      limit: 2,
      categoryId,
      sortBy: 'name',
      sortOrder: 'asc',
    });

    expect(firstPage.total).toBe(2);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(0);
    expect(
      firstPage.items.map(({ id }) => id),
    ).not.toEqual(
      secondPage.items.map(({ id }) => id),
    );
  });

  it.each([
    ['Alpha', 0],
    ['Lightweight running', 0],
    ['SKU-BETA', 1],
  ])('searches product name, description, or SKU for "%s"', async (
    search,
    expectedIndex,
  ) => {
    const { items } = await repository.list({
      page: 1,
      limit: 20,
      search,
      sortBy: 'name',
      sortOrder: 'asc',
    });

    expect(items.map(({ id }) => id)).toContain(
      productIds[expectedIndex],
    );
  });

  it('deletes a product', async () => {
    const created = await repository.create({
      name: 'Product To Delete',
      slug: `product-delete-${runId}`,
      sku: `SKU-DELETE-${runId}`,
      price: '1.00',
      categoryId,
    });

    const deleted = await repository.delete(created.id);

    expect(deleted.id).toBe(created.id);
    expect(await repository.findById(created.id)).toBeNull();
  });
});
