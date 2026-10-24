import request from 'supertest';

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'vitest';

import app from '../../src/app.js';

import {
  testPrisma,
} from '../../src/config/test-database.js';

import {
  hashPassword,
} from '../../src/common/security/password.js';

import {
  createAccessToken,
} from '../../src/common/security/jwt.js';

describe('Authorization / RBAC', () => {
  let customerId: string;
  let adminId: string;

  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword(
      'Password123!',
    );

    const customer = await testPrisma.user.create({
      data: {
        email: 'rbac-customer@example.com',
        passwordHash,
        firstName: 'RBAC',
        lastName: 'Customer',
        role: 'CUSTOMER',
      },
    });

    const admin = await testPrisma.user.create({
      data: {
        email: 'rbac-admin@example.com',
        passwordHash,
        firstName: 'RBAC',
        lastName: 'Admin',
        role: 'ADMIN',
      },
    });

    customerId = customer.id;
    adminId = admin.id;

    customerToken = await createAccessToken(
      customer.id,
    );

    adminToken = await createAccessToken(
      admin.id,
    );
  });

  afterAll(async () => {
    await testPrisma.user.deleteMany({
      where: {
        id: {
          in: [
            customerId,
            adminId,
          ],
        },
      },
    });

    await testPrisma.$disconnect();
  });

  it('allows an ADMIN to access an admin endpoint', async () => {
    const response = await request(app)
      .get('/api/v1/users/admin-test')
      .set(
        'Authorization',
        `Bearer ${adminToken}`,
      );

    expect(response.status).toBe(200);

    expect(
      response.body.success,
    ).toBe(true);

    expect(
      response.body.message,
    ).toBe('Admin access granted');
  });

  it('rejects a CUSTOMER from an admin endpoint', async () => {
    const response = await request(app)
      .get('/api/v1/users/admin-test')
      .set(
        'Authorization',
        `Bearer ${customerToken}`,
      );

    expect(response.status).toBe(403);

    expect(
      response.body.code,
    ).toBe('FORBIDDEN');
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app)
      .get('/api/v1/users/admin-test');

    expect(response.status).toBe(401);

    expect(
      response.body.code,
    ).toBe(
      'AUTHENTICATION_REQUIRED',
    );
  });

  it('rejects an inactive ADMIN', async () => {
    await testPrisma.user.update({
      where: {
        id: adminId,
      },
      data: {
        isActive: false,
      },
    });

    const response = await request(app)
      .get('/api/v1/users/admin-test')
      .set(
        'Authorization',
        `Bearer ${adminToken}`,
      );

    expect(response.status).toBe(403);

    expect(
      response.body.code,
    ).toBe('ACCOUNT_INACTIVE');

    await testPrisma.user.update({
      where: {
        id: adminId,
      },
      data: {
        isActive: true,
      },
    });
  });
});