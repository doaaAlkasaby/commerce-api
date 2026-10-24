import request from 'supertest';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import app from '../../src/app.js';

import {
  createAccessToken,
} from '../../src/common/security/jwt.js';

import {
  hashPassword,
} from '../../src/common/security/password.js';

import {
  testPrisma,
} from '../../src/config/test-database.js';

describe('Categories API', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const categoryIds: string[] = [];

  let customerId: string;
  let adminId: string;
  let customerToken: string;
  let adminToken: string;

  const createCategory = async (
    slug: string,
    options: {
      name?: string;
      parentId?: string;
    } = {},
  ): Promise<string> => {
    const response = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: options.name ?? slug,
        slug,
        ...(options.parentId
          ? { parentId: options.parentId }
          : {}),
      });

    expect(response.status).toBe(201);
    categoryIds.push(response.body.data.id);
    return response.body.data.id;
  };

  beforeAll(async () => {
    await testPrisma.$connect();
    const passwordHash = await hashPassword('Password123!');

    const customer = await testPrisma.user.create({
      data: {
        email: `categories-customer-${runId}@example.com`,
        passwordHash,
        firstName: 'Category',
        lastName: 'Customer',
        role: 'CUSTOMER',
      },
    });

    const admin = await testPrisma.user.create({
      data: {
        email: `categories-admin-${runId}@example.com`,
        passwordHash,
        firstName: 'Category',
        lastName: 'Admin',
        role: 'ADMIN',
      },
    });

    customerId = customer.id;
    adminId = admin.id;
    customerToken = await createAccessToken(customer.id);
    adminToken = await createAccessToken(admin.id);
  });

  afterAll(async () => {
    if (categoryIds.length > 0) {
      await testPrisma.category.deleteMany({
        where: {
          id: {
            in: categoryIds,
          },
        },
      });
    }

    await testPrisma.user.deleteMany({
      where: {
        id: {
          in: [customerId, adminId],
        },
      },
    });
    await testPrisma.$disconnect();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated user from creating a category', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .send({
          name: 'Unauthorized Category',
          slug: `unauthorized-${runId}`,
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('rejects a customer from creating a category', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Customer Category',
          slug: `customer-${runId}`,
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('rejects a customer from updating a category', async () => {
      const categoryId = await createCategory(`customer-update-${runId}`);

      const response = await request(app)
        .patch(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Customer Updated Category',
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('rejects a customer from deleting a category', async () => {
      const categoryId = await createCategory(`customer-delete-${runId}`);

      const response = await request(app)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('allows an admin to create a category', async () => {
      const slug = `admin-create-${runId}`;
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Admin Created Category',
          slug,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.slug).toBe(slug);
      categoryIds.push(response.body.data.id);
    });

    it('allows an admin to update a category', async () => {
      const categoryId = await createCategory(`admin-update-${runId}`);
      const response = await request(app)
        .patch(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Admin Updated Category',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Admin Updated Category');
    });

    it('allows an admin to delete a category', async () => {
      const categoryId = await createCategory(`admin-delete-${runId}`);
      const response = await request(app)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });
  });

  describe('status', () => {
    it('allows an admin to deactivate a category', async () => {
      const categoryId = await createCategory(`deactivate-${runId}`);
      const response = await request(app)
        .patch(`/api/v1/categories/${categoryId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          isActive: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.isActive).toBe(false);
    });

    it('allows an admin to activate a category', async () => {
      const categoryId = await createCategory(`activate-${runId}`);
      await testPrisma.category.update({
        where: {
          id: categoryId,
        },
        data: {
          isActive: false,
        },
      });

      const response = await request(app)
        .patch(`/api/v1/categories/${categoryId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          isActive: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.isActive).toBe(true);
    });
  });

  describe('retrieval', () => {
    it('gets a category', async () => {
      const categoryId = await createCategory(`get-${runId}`);
      const response = await request(app)
        .get(`/api/v1/categories/${categoryId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(categoryId);
    });

    it('gets active categories', async () => {
      const activeId = await createCategory(`active-${runId}`);
      const inactiveId = await createCategory(`inactive-${runId}`);
      await testPrisma.category.update({
        where: {
          id: inactiveId,
        },
        data: {
          isActive: false,
        },
      });

      const response = await request(app)
        .get('/api/v1/categories/active');
      const returnedIds = response.body.data.map(
        (category: { id: string }) => category.id,
      );

      expect(response.status).toBe(200);
      expect(returnedIds).toContain(activeId);
      expect(returnedIds).not.toContain(inactiveId);
    });

    it('gets a category’s children', async () => {
      const parentId = await createCategory(`parent-${runId}`);
      const childId = await createCategory(`child-${runId}`, {
        parentId,
      });

      const response = await request(app)
        .get(`/api/v1/categories/${parentId}/children`);
      const returnedIds = response.body.data.map(
        (category: { id: string }) => category.id,
      );

      expect(response.status).toBe(200);
      expect(returnedIds).toContain(childId);
    });

    it('returns 404 for a missing category', async () => {
      const response = await request(app)
        .get('/api/v1/categories/00000000-0000-4000-8000-000000000099');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('CATEGORY_NOT_FOUND');
    });
  });
});
