import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
} from 'vitest';

import request from 'supertest';

import {
  testPrisma,
} from '../../src/config/test-database.js';

import {
  hashPassword,
} from '../../src/common/security/password.js';

import {
  authService,
} from '../../src/modules/auth/auth.service.instance.js';

import app from '../../src/app.js';





describe('GET /api/v1/users/me', () => {
  const password =
    'Password123!';

  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    userEmail =
      `profile-${Date.now()}@example.com`;

    const passwordHash =
      await hashPassword(password);

    const user =
      await testPrisma.user.create({
        data: {
          email: userEmail,
          passwordHash,
          firstName: 'Profile',
          lastName: 'Test',
          isActive: true,
        },
      });

    userId = user.id;
  });

  afterAll(async () => {
    await testPrisma.refreshToken.deleteMany({
      where: {
        userId,
      },
    });

    await testPrisma.user.delete({
      where: {
        id: userId,
      },
    });

    await testPrisma.$disconnect();
  });

  it('should reject requests without an access token', async () => {
    const response =
      await request(app)
        .get('/api/v1/users/me');

    expect(
      response.status,
    ).toBe(401);

    expect(
      response.body.success,
    ).toBe(false);

    expect(
      response.body.code,
    ).toBe(
      'AUTHENTICATION_REQUIRED',
    );
  });

  it('should reject an invalid access token', async () => {
    const response =
      await request(app)
        .get('/api/v1/users/me')
        .set(
          'Authorization',
          'Bearer invalid-token',
        );

    expect(
      response.status,
    ).toBe(401);

    expect(
      response.body.success,
    ).toBe(false);

    expect(
      response.body.code,
    ).toBe(
      'INVALID_ACCESS_TOKEN',
    );
  });

  it('should return the authenticated user profile', async () => {
    const loginResult =
      await authService.login({
        email: userEmail,
        password,
      });

    const response =
      await request(app)
        .get('/api/v1/users/me')
        .set(
          'Authorization',
          `Bearer ${loginResult.accessToken}`,
        );

    expect(
      response.status,
    ).toBe(200);

    expect(
      response.body.success,
    ).toBe(true);

    expect(
      response.body.data.id,
    ).toBe(userId);

    expect(
      response.body.data.email,
    ).toBe(userEmail);

    expect(
      response.body.data.firstName,
    ).toBe('Profile');

    expect(
      response.body.data.lastName,
    ).toBe('Test');

    /*
     * Password hash must never appear
     * in the API response.
     */
    expect(
      response.body.data.passwordHash,
    ).toBeUndefined();
  });

  it('should reject malformed authorization headers', async () => {
    const response =
      await request(app)
        .get('/api/v1/users/me')
        .set(
          'Authorization',
          'Basic abc123',
        );

    expect(
      response.status,
    ).toBe(401);

    expect(
      response.body.code,
    ).toBe(
      'INVALID_AUTHORIZATION_HEADER',
    );
  });

  it('should reject a Bearer header without a token', async () => {
    const response =
      await request(app)
        .get('/api/v1/users/me')
        .set(
          'Authorization',
          'Bearer',
        );

    expect(
      response.status,
    ).toBe(401);

    expect(
      response.body.code,
    ).toBe(
      'INVALID_AUTHORIZATION_HEADER',
    );
  });
});