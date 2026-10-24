import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  testPrisma,
} from '../../src/config/test-database.js';

import {
  hashPassword,
} from '../../src/common/security/password.js';

import {
  authService,
} from '../../src/modules/auth/auth.service.instance.js';

import {
  verifyAccessToken,
} from '../../src/common/security/jwt.js';

describe('Authentication Middleware - JWT', () => {
  const password =
    'Password123!';

  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    userEmail =
      `middleware-${Date.now()}@example.com`;

    const passwordHash =
      await hashPassword(password);

    const user =
      await testPrisma.user.create({
        data: {
          email: userEmail,
          passwordHash,
          firstName: 'Middleware',
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

  it('should create an access token containing the user ID', async () => {
    const result =
      await authService.login({
        email: userEmail,
        password,
      });

    const payload =
      await verifyAccessToken(
        result.accessToken,
      );

    expect(payload.sub).toBe(
      userId,
    );

    expect(payload.type).toBe(
      'access',
    );
  });

  it('should reject a modified access token', async () => {
    const result =
      await authService.login({
        email: userEmail,
        password,
      });

    const modifiedToken =
      `${result.accessToken}invalid`;

    await expect(
      verifyAccessToken(
        modifiedToken,
      ),
    ).rejects.toThrow();
  });

  it('should reject an invalid token', async () => {
    await expect(
      verifyAccessToken(
        'invalid-token',
      ),
    ).rejects.toThrow();
  });
});