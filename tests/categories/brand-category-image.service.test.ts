import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  Brand,
  Category,
} from '../../src/generated/prisma/client.js';

import {
  storageService,
} from '../../src/common/storage/storage.service.js';

import {
  createBrandRepository,
} from '../../src/modules/brands/brand.repository.js';

import {
  createBrandService,
} from '../../src/modules/brands/brand.service.js';

import {
  createCategoryRepository,
} from '../../src/modules/categories/category.repository.js';

import {
  createCategoryService,
} from '../../src/modules/categories/category.service.js';

vi.mock('../../src/common/storage/storage.service.js', () => ({
  storageService: {
    upload: vi.fn(),
    delete: vi.fn(),
  },
}));

type BrandRepository =
  ReturnType<typeof createBrandRepository>;
type CategoryRepository =
  ReturnType<typeof createCategoryRepository>;

const now = new Date('2026-01-01T00:00:00.000Z');
const imageFile = Buffer.from([0xff, 0xd8, 0xff]);

const brand: Brand = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Brand',
  slug: 'brand',
  description: null,
  imageStorageKey: null,
  imageUrl: null,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

const category: Category = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Category',
  slug: 'category',
  description: null,
  imageStorageKey: null,
  imageUrl: null,
  isActive: true,
  parentId: null,
  createdAt: now,
  updatedAt: now,
};

const brandRepository: BrandRepository = {
  findById: vi.fn<BrandRepository['findById']>(),
  findBySlug: vi.fn<BrandRepository['findBySlug']>(),
  findAll: vi.fn<BrandRepository['findAll']>(),
  findActive: vi.fn<BrandRepository['findActive']>(),
  create: vi.fn<BrandRepository['create']>(),
  update: vi.fn<BrandRepository['update']>(),
  updateStatus: vi.fn<BrandRepository['updateStatus']>(),
  updateImage: vi.fn<BrandRepository['updateImage']>(),
  delete: vi.fn<BrandRepository['delete']>(),
};

const categoryRepository: CategoryRepository = {
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
};

const brandService = createBrandService(brandRepository);
const categoryService = createCategoryService(categoryRepository);

describe('Brand and category image services', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uploads a brand image and returns its URL', async () => {
    vi.mocked(brandRepository.findById).mockResolvedValue({
      ...brand,
      imageStorageKey: 'brands/old-brand.jpg',
    });
    vi.mocked(storageService.upload).mockResolvedValue({
      storageKey: 'brands/brand.jpg',
      url: '/uploads/brands/brand.jpg',
    });
    vi.mocked(brandRepository.updateImage).mockResolvedValue({
      ...brand,
      imageStorageKey: 'brands/brand.jpg',
      imageUrl: '/uploads/brands/brand.jpg',
    });

    const response = await brandService.uploadImage(brand.id, {
      file: imageFile,
      originalName: 'brand.jpg',
      contentType: 'image/jpeg',
    });

    expect(response.imageUrl).toBe('/uploads/brands/brand.jpg');
    expect(storageService.upload).toHaveBeenCalledWith(
      imageFile,
      'brand.jpg',
      'image/jpeg',
      'brands',
    );
    expect(storageService.delete).toHaveBeenCalledWith(
      'brands/old-brand.jpg',
    );
  });

  it('uploads a category image and returns its URL', async () => {
    vi.mocked(categoryRepository.findById).mockResolvedValue(category);
    vi.mocked(storageService.upload).mockResolvedValue({
      storageKey: 'categories/category.jpg',
      url: '/uploads/categories/category.jpg',
    });
    vi.mocked(categoryRepository.updateImage).mockResolvedValue({
      ...category,
      imageStorageKey: 'categories/category.jpg',
      imageUrl: '/uploads/categories/category.jpg',
    });

    const response = await categoryService.uploadImage(category.id, {
      file: imageFile,
      originalName: 'category.jpg',
      contentType: 'image/jpeg',
    });

    expect(response.imageUrl).toBe('/uploads/categories/category.jpg');
    expect(storageService.upload).toHaveBeenCalledWith(
      imageFile,
      'category.jpg',
      'image/jpeg',
      'categories',
    );
  });

  it('clears and deletes a category image', async () => {
    vi.mocked(categoryRepository.findById).mockResolvedValue({
      ...category,
      imageStorageKey: 'categories/old.jpg',
      imageUrl: '/uploads/categories/old.jpg',
    });

    await categoryService.deleteImage(category.id);

    expect(categoryRepository.updateImage).toHaveBeenCalledWith(
      category.id,
      null,
      null,
    );
    expect(storageService.delete).toHaveBeenCalledWith(
      'categories/old.jpg',
    );
  });

  it('clears and deletes a brand image', async () => {
    vi.mocked(brandRepository.findById).mockResolvedValue({
      ...brand,
      imageStorageKey: 'brands/brand.jpg',
      imageUrl: '/uploads/brands/brand.jpg',
    });

    await brandService.deleteImage(brand.id);

    expect(brandRepository.updateImage).toHaveBeenCalledWith(
      brand.id,
      null,
      null,
    );
    expect(storageService.delete).toHaveBeenCalledWith(
      'brands/brand.jpg',
    );
  });
});
