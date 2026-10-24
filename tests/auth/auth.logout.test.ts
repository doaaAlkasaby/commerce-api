import {
  afterAll,
  beforeAll,
  beforeEach,
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
  hashToken,
} from '../../src/common/security/token.js';

describe('Auth Service - Logout', () => {
  const password =
    'Password123!';

  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    userEmail =
      `logout-${Date.now()}@example.com`;

    const passwordHash =
      await hashPassword(password);

    const user =
      await testPrisma.user.create({
        data: {
          email: userEmail,
          passwordHash,
          firstName: 'Logout',
          lastName: 'Test',
          isActive: true,
        },
      });

    userId = user.id;
  });

  beforeEach(async () => {
    await testPrisma.refreshToken.deleteMany({
      where: {
        userId,
      },
    });

    await testPrisma.user.update({
      where: {
        id: userId,
      },
      data: {
        isActive: true,
      },
    });
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

  it('should revoke the refresh token during logout', async () => {
    const loginResult =
      await authService.login({
        email: userEmail,
        password,
      });

    const refreshToken =
      loginResult.refreshToken;

    const tokenHash =
      hashToken(refreshToken);

    const storedToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash,
        },
      });

    expect(storedToken).not.toBeNull();

    expect(
      storedToken?.revokedAt,
    ).toBeNull();

    await authService.logout(
      refreshToken,
    );

    const revokedToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash,
        },
      });

    expect(revokedToken).not.toBeNull();

    expect(
      revokedToken?.revokedAt,
    ).not.toBeNull();
  });

  it('should prevent a logged-out refresh token from being used', async () => {
    const loginResult =
      await authService.login({
        email: userEmail,
        password,
      });

    const refreshToken =
      loginResult.refreshToken;

    await authService.logout(
      refreshToken,
    );

    await expect(
      authService.refresh(
        refreshToken,
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSED',
    });
  });

  it('should allow logout to be called multiple times', async () => {
    const loginResult =
      await authService.login({
        email: userEmail,
        password,
      });

    const refreshToken =
      loginResult.refreshToken;

    await authService.logout(
      refreshToken,
    );

    await expect(
      authService.logout(
        refreshToken,
      ),
    ).resolves.toBeUndefined();

    await expect(
      authService.logout(
        refreshToken,
      ),
    ).resolves.toBeUndefined();
  });

  it('should not fail when logging out with an unknown token', async () => {
    await expect(
      authService.logout(
        'unknown-refresh-token',
      ),
    ).resolves.toBeUndefined();
  });
});