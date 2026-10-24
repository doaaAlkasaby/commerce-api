import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';

import { hashPassword } from '../../src/common/security/password.js';

import { authService } from '../../src/modules/auth/auth.service.instance.js';

describe('Auth Service - Login', () => {
  const password = 'Password123!';

  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    userEmail = `login-${Date.now()}@example.com`;

    const passwordHash =
      await hashPassword(password);

    const user =
      await testPrisma.user.create({
        data: {
          email: userEmail,
          passwordHash,
          firstName: 'Login',
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

  it('should login successfully with valid credentials', async () => {
    const result =
      await authService.login({
        email: userEmail,
        password,
      });

    expect(result.accessToken).toBeTruthy();

    expect(result.refreshToken).toBeTruthy();

    expect(result.tokenType).toBe('Bearer');

    expect(result.expiresIn).toBeTruthy();

    expect(result.user.id).toBe(userId);

    expect(result.user.email).toBe(
      userEmail,
    );

    expect(result.user.firstName).toBe(
      'Login',
    );

    expect(result.user.lastName).toBe(
      'Test',
    );

    expect(result.user.isActive).toBe(true);

    /*
     * Verify that a refresh token
     * was actually persisted.
     */
    const storedRefreshToken =
      await testPrisma.refreshToken.findFirst({
        where: {
          userId,
        },
      });

    expect(
      storedRefreshToken,
    ).not.toBeNull();

    /*
     * The raw refresh token returned
     * to the client must NOT be stored
     * directly in the database.
     */
    expect(
      storedRefreshToken?.tokenHash,
    ).not.toBe(result.refreshToken);

    expect(
      storedRefreshToken?.familyId,
    ).toBeTruthy();

    expect(
      storedRefreshToken?.expiresAt.getTime(),
    ).toBeGreaterThan(
      Date.now(),
    );

    expect(
      storedRefreshToken?.revokedAt,
    ).toBeNull();
  });

  it('should reject login with an incorrect password', async () => {
    await expect(
      authService.login({
        email: userEmail,
        password: 'WrongPassword123!',
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message:
        'Invalid email or password',
    });
  });

  it('should reject login when the email does not exist', async () => {
    await expect(
      authService.login({
        email: 'does-not-exist@example.com',
        password,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message:
        'Invalid email or password',
    });
  });

  it('should use the same error for unknown email and wrong password', async () => {
    let wrongPasswordError: unknown;
    let unknownEmailError: unknown;

    try {
      await authService.login({
        email: userEmail,
        password: 'WrongPassword123!',
      });
    } catch (error) {
      wrongPasswordError = error;
    }

    try {
      await authService.login({
        email: 'unknown@example.com',
        password,
      });
    } catch (error) {
      unknownEmailError = error;
    }

    expect(wrongPasswordError).toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message:
        'Invalid email or password',
    });

    expect(unknownEmailError).toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message:
        'Invalid email or password',
    });
  });

  it('should reject login for an inactive account', async () => {
    await testPrisma.user.update({
      where: {
        id: userId,
      },
      data: {
        isActive: false,
      },
    });

    await expect(
      authService.login({
        email: userEmail,
        password,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_INACTIVE',
      message:
        'This account is inactive',
    });

    /*
     * Restore the user so other tests
     * and cleanup remain predictable.
     */
    await testPrisma.user.update({
      where: {
        id: userId,
      },
      data: {
        isActive: true,
      },
    });
  });

  it('should not create a refresh token when login fails', async () => {
    const beforeCount =
      await testPrisma.refreshToken.count({
        where: {
          userId,
        },
      });

    await expect(
      authService.login({
        email: userEmail,
        password: 'WrongPassword123!',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    const afterCount =
      await testPrisma.refreshToken.count({
        where: {
          userId,
        },
      });

    expect(afterCount).toBe(
      beforeCount,
    );
  });
});