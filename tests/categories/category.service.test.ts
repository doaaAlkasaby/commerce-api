import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  Category,
} from '../../src/generated/prisma/client.js';

import {
  createCategoryService,
} from '../../src/modules/categories/category.service.js';

import type {
  createCategoryRepository,
} from '../../src/modules/categories/category.repository.js';

type CategoryRepository =
  ReturnType<typeof createCategoryRepository>;

const categoryId =
  '00000000-0000-4000-8000-000000000001';
const parentId =
  '00000000-0000-4000-8000-000000000002';
const otherCategoryId =
  '00000000-0000-4000-8000-000000000003';

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

const categoryService =
  createCategoryService(categoryRepository);

describe('Category service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('create', () => {
    it('creates a category', async () => {
      const createdCategory = makeCategory();
      vi.mocked(categoryRepository.findBySlug).mockResolvedValue(null);
      vi.mocked(categoryRepository.create).mockResolvedValue(createdCategory);

      await expect(
        categoryService.create({
          name: 'Category',
          slug: 'category',
        }),
      ).resolves.toMatchObject({
        id: categoryId,
        name: 'Category',
        slug: 'category',
      });
    });

    it('rejects a duplicate slug', async () => {
      vi.mocked(categoryRepository.findBySlug).mockResolvedValue(
        makeCategory(),
      );

      await expect(
        categoryService.create({
          name: 'Another Category',
          slug: 'category',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CATEGORY_SLUG_ALREADY_EXISTS',
      });

      expect(categoryRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a missing parent', async () => {
      vi.mocked(categoryRepository.findBySlug).mockResolvedValue(null);
      vi.mocked(categoryRepository.findById).mockResolvedValue(null);

      await expect(
        categoryService.create({
          name: 'Child',
          slug: 'child',
          parentId,
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'PARENT_CATEGORY_NOT_FOUND',
      });

      expect(categoryRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive parent', async () => {
      vi.mocked(categoryRepository.findBySlug).mockResolvedValue(null);
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory({
          id: parentId,
          isActive: false,
        }),
      );

      await expect(
        categoryService.create({
          name: 'Child',
          slug: 'child',
          parentId,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PARENT_CATEGORY_INACTIVE',
      });

      expect(categoryRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates a category', async () => {
      const updatedCategory = makeCategory({
        name: 'Renamed Category',
      });
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory(),
      );
      vi.mocked(categoryRepository.update).mockResolvedValue(
        updatedCategory,
      );

      await expect(
        categoryService.update(categoryId, {
          name: 'Renamed Category',
        }),
      ).resolves.toMatchObject({
        id: categoryId,
        name: 'Renamed Category',
      });
    });

    it('rejects a duplicate slug', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory(),
      );
      vi.mocked(categoryRepository.findBySlug).mockResolvedValue(
        makeCategory({
          id: otherCategoryId,
          slug: 'taken-slug',
        }),
      );

      await expect(
        categoryService.update(categoryId, {
          slug: 'taken-slug',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CATEGORY_SLUG_ALREADY_EXISTS',
      });

      expect(categoryRepository.update).not.toHaveBeenCalled();
    });

    it('rejects making the category its own parent', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory(),
      );

      await expect(
        categoryService.update(categoryId, {
          parentId: categoryId,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'CATEGORY_CANNOT_BE_OWN_PARENT',
      });

      expect(categoryRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a missing parent', async () => {
      vi.mocked(categoryRepository.findById)
        .mockResolvedValueOnce(makeCategory())
        .mockResolvedValueOnce(null);

      await expect(
        categoryService.update(categoryId, {
          parentId,
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'PARENT_CATEGORY_NOT_FOUND',
      });

      expect(categoryRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('deactivates a category', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory(),
      );
      vi.mocked(categoryRepository.updateStatus).mockResolvedValue(
        makeCategory({
          isActive: false,
        }),
      );

      await expect(
        categoryService.updateStatus(categoryId, false),
      ).resolves.toMatchObject({
        id: categoryId,
        isActive: false,
      });
      expect(categoryRepository.updateStatus).toHaveBeenCalledWith(
        categoryId,
        false,
      );
    });

    it('activates a category', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory({
          isActive: false,
        }),
      );
      vi.mocked(categoryRepository.updateStatus).mockResolvedValue(
        makeCategory({
          isActive: true,
        }),
      );

      await expect(
        categoryService.updateStatus(categoryId, true),
      ).resolves.toMatchObject({
        id: categoryId,
        isActive: true,
      });
      expect(categoryRepository.updateStatus).toHaveBeenCalledWith(
        categoryId,
        true,
      );
    });
  });

  describe('retrieval', () => {
    it('gets a category', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory(),
      );

      await expect(
        categoryService.getById(categoryId),
      ).resolves.toMatchObject({
        id: categoryId,
        slug: 'category',
      });
    });

    it('gets active categories', async () => {
      vi.mocked(categoryRepository.findActive).mockResolvedValue([
        makeCategory(),
      ]);

      await expect(
        categoryService.getActive(),
      ).resolves.toMatchObject([
        {
          id: categoryId,
          isActive: true,
        },
      ]);
    });

    it('gets a category’s children', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(
        makeCategory({
          id: parentId,
        }),
      );
      vi.mocked(categoryRepository.findChildren).mockResolvedValue([
        makeCategory({
          id: categoryId,
          parentId,
        }),
      ]);

      await expect(
        categoryService.getChildren(parentId),
      ).resolves.toMatchObject([
        {
          id: categoryId,
          parentId,
        },
      ]);
    });

    it('returns a not-found error for a missing category', async () => {
      vi.mocked(categoryRepository.findById).mockResolvedValue(null);

      await expect(
        categoryService.getById(categoryId),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'CATEGORY_NOT_FOUND',
      });
    });
  });
});
