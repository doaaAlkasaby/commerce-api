import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  testPrisma,
} from '../../src/config/test-database.js';

import {
  createCategoryRepository,
} from '../../src/modules/categories/category.repository.js';

describe('Category repository', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const parentSlug = `repository-parent-${runId}`;
  const childSlug = `repository-child-${runId}`;
  const inactiveSlug = `repository-inactive-${runId}`;
  const deleteSlug = `repository-delete-${runId}`;

  const repository = createCategoryRepository(testPrisma);

  let parentId: string;
  let childId: string;
  let inactiveId: string;

  beforeAll(async () => {
    await testPrisma.$connect();

    const parent = await repository.create({
      name: 'Repository Parent',
      slug: parentSlug,
    });
    parentId = parent.id;
    await testPrisma.category.update({
      where: {
        id: parentId,
      },
      data: {
        imageStorageKey: 'categories/repository-parent.jpg',
        imageUrl: 'https://example.com/repository-parent.jpg',
      },
    });

    const child = await repository.create({
      name: 'Repository Child',
      slug: childSlug,
      parentId,
    });
    childId = child.id;

    const inactive = await repository.create({
      name: 'Repository Inactive',
      slug: inactiveSlug,
    });
    inactiveId = inactive.id;
    await repository.updateStatus(inactiveId, false);
  });

  afterAll(async () => {
    await testPrisma.category.deleteMany({
      where: {
        slug: {
          in: [parentSlug, childSlug, inactiveSlug, deleteSlug],
        },
      },
    });
    await testPrisma.$disconnect();
  });

  it('creates and finds a category by ID and slug', async () => {
    const category = await repository.findById(parentId);
    const bySlug = await repository.findBySlug(parentSlug);

    expect(category).not.toBeNull();
    expect(category?.id).toBe(parentId);
    expect(category?.imageStorageKey).toBe(
      'categories/repository-parent.jpg',
    );
    expect(category?.imageUrl).toBe(
      'https://example.com/repository-parent.jpg',
    );
    expect(bySlug?.id).toBe(parentId);
  });

  it('finds all categories, active categories, and children', async () => {
    const all = await repository.findAll();
    const active = await repository.findActive();
    const children = await repository.findChildren(parentId);

    expect(all.map(({ id }) => id)).toContain(parentId);
    expect(
      all.find(({ id }) => id === parentId)?.imageUrl,
    ).toBe('https://example.com/repository-parent.jpg');
    expect(active.map(({ id }) => id)).toContain(parentId);
    expect(active.map(({ id }) => id)).not.toContain(inactiveId);
    expect(children.map(({ id }) => id)).toContain(childId);
  });

  it('updates category data and status', async () => {
    const updated = await repository.update(parentId, {
      name: 'Updated Repository Parent',
    });
    const deactivated = await repository.updateStatus(parentId, false);
    const activated = await repository.updateStatus(parentId, true);

    expect(updated.name).toBe('Updated Repository Parent');
    expect(deactivated.isActive).toBe(false);
    expect(activated.isActive).toBe(true);
  });

  it('deletes a category', async () => {
    const created = await repository.create({
      name: 'Repository Delete',
      slug: deleteSlug,
    });

    const deleted = await repository.delete(created.id);

    expect(deleted.id).toBe(created.id);
    expect(await repository.findById(created.id)).toBeNull();
  });
});
