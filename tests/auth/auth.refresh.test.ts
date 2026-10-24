import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';

import { hashPassword } from '../../src/common/security/password.js';

import { authService } from '../../src/modules/auth/auth.service.instance.js';

import {
  generateRefreshToken,
  hashToken,
} from '../../src/common/security/token.js';

describe('Auth Service - Refresh Tokens', () => {
  const password = 'Password123!';

  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    userEmail =
      `refresh-${Date.now()}@example.com`;

    const passwordHash =
      await hashPassword(password);

    const user =
      await testPrisma.user.create({
        data: {
          email: userEmail,
          passwordHash,
          firstName: 'Refresh',
          lastName: 'Test',
          isActive: true,
        },
      });

    userId = user.id;
  });

  beforeEach(async () => {
    /*
     * Keep every test independent.
     *
     * Remove all refresh tokens belonging
     * to our test user before each test.
     */
    await testPrisma.refreshToken.deleteMany({
      where: {
        userId,
      },
    });

    /*
     * Make sure the user is active before
     * every test.
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

  const loginAndGetRefreshToken =
    async () => {
      const result =
        await authService.login({
          email: userEmail,
          password,
        });

      return result;
    };

  it('should refresh successfully with a valid refresh token', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const oldRefreshToken =
      loginResult.refreshToken;

    const refreshResult =
      await authService.refresh(
        oldRefreshToken,
      );

    expect(
      refreshResult.accessToken,
    ).toBeTruthy();

    expect(
      refreshResult.refreshToken,
    ).toBeTruthy();

    expect(
      refreshResult.tokenType,
    ).toBe('Bearer');

    expect(
      refreshResult.expiresIn,
    ).toBeTruthy();

    /*
     * Rotation means the new refresh
     * token must be different.
     */
    expect(
      refreshResult.refreshToken,
    ).not.toBe(oldRefreshToken);
  });

  it('should revoke the old refresh token after rotation', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const oldRefreshToken =
      loginResult.refreshToken;

    const oldTokenHash =
      hashToken(oldRefreshToken);

    const oldToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash: oldTokenHash,
        },
      });

    expect(oldToken).not.toBeNull();

    const refreshResult =
      await authService.refresh(
        oldRefreshToken,
      );

    const newTokenHash =
      hashToken(
        refreshResult.refreshToken,
      );

    const updatedOldToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          id: oldToken!.id,
        },
      });

    const newToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash: newTokenHash,
        },
      });

    /*
     * Old token must be revoked.
     */
    expect(
      updatedOldToken?.revokedAt,
    ).not.toBeNull();

    /*
     * Old token must point to its
     * replacement.
     */
    expect(
      updatedOldToken?.replacedByTokenId,
    ).toBe(newToken?.id);

    /*
     * New token must be active.
     */
    expect(
      newToken?.revokedAt,
    ).toBeNull();
  });

  it('should keep the same token family during rotation', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const oldRefreshToken =
      loginResult.refreshToken;

    const oldTokenHash =
      hashToken(oldRefreshToken);

    const oldToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash: oldTokenHash,
        },
      });

    expect(oldToken).not.toBeNull();

    const refreshResult =
      await authService.refresh(
        oldRefreshToken,
      );

    const newTokenHash =
      hashToken(
        refreshResult.refreshToken,
      );

    const newToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash: newTokenHash,
        },
      });

    expect(newToken).not.toBeNull();

    expect(
      newToken?.familyId,
    ).toBe(oldToken?.familyId);
  });

  it('should reject reuse of an old refresh token', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const oldRefreshToken =
      loginResult.refreshToken;

    /*
     * First use is valid.
     *
     * A → B
     */
    await authService.refresh(
      oldRefreshToken,
    );

    /*
     * Second use of A means reuse.
     */
    await expect(
      authService.refresh(
        oldRefreshToken,
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSED',
      message:
        'Refresh token reuse detected',
    });
  });

  it('should revoke the entire token family after reuse detection', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const tokenA =
      loginResult.refreshToken;

    /*
     * A → B
     */
    const refreshResult =
      await authService.refresh(
        tokenA,
      );

    const tokenB =
      refreshResult.refreshToken;

    /*
     * A is now revoked.
     *
     * Reusing A should revoke
     * the entire family.
     */
    await expect(
      authService.refresh(tokenA),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSED',
    });

    /*
     * B should now also be unusable.
     */
    await expect(
      authService.refresh(tokenB),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSED',
    });

    /*
     * Verify all tokens in the family
     * have been revoked.
     */
    const tokens =
      await testPrisma.refreshToken.findMany({
        where: {
          userId,
        },
      });

    expect(tokens.length).toBeGreaterThan(
      0,
    );

    for (const token of tokens) {
      expect(
        token.revokedAt,
      ).not.toBeNull();
    }
  });

  it('should reject an invalid refresh token', async () => {
    await expect(
      authService.refresh(
        'completely-invalid-refresh-token',
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_REFRESH_TOKEN',
      message:
        'Invalid refresh token',
    });
  });

  it('should reject an expired refresh token', async () => {
    const refreshToken =
      generateRefreshToken();

    const tokenHash =
      hashToken(refreshToken);

    const expiredDate =
      new Date(
        Date.now() - 1000,
      );

    await testPrisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId: crypto.randomUUID(),
        expiresAt: expiredDate,
      },
    });

    await expect(
      authService.refresh(
        refreshToken,
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_EXPIRED',
      message:
        'Refresh token has expired',
    });
  });

  it('should reject a revoked refresh token and revoke its family', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const refreshToken =
      loginResult.refreshToken;

    const tokenHash =
      hashToken(refreshToken);

    const token =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash,
        },
      });

    expect(token).not.toBeNull();

    await testPrisma.refreshToken.update({
      where: {
        id: token!.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await expect(
      authService.refresh(
        refreshToken,
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSED',
      message:
        'Refresh token reuse detected',
    });
  });

  it('should reject refresh when the user account is inactive', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const refreshToken =
      loginResult.refreshToken;

    await testPrisma.user.update({
      where: {
        id: userId,
      },
      data: {
        isActive: false,
      },
    });

    await expect(
      authService.refresh(
        refreshToken,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_INACTIVE',
      message:
        'This account is inactive',
    });
  });

  it('should create a new refresh token with a future expiration date', async () => {
    const loginResult =
      await loginAndGetRefreshToken();

    const refreshResult =
      await authService.refresh(
        loginResult.refreshToken,
      );

    const newTokenHash =
      hashToken(
        refreshResult.refreshToken,
      );

    const newToken =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash: newTokenHash,
        },
      });

    expect(newToken).not.toBeNull();

    expect(
      newToken!.expiresAt.getTime(),
    ).toBeGreaterThan(
      Date.now(),
    );

    expect(
      newToken!.revokedAt,
    ).toBeNull();
  });

  it('should rotate multiple times while preserving the same token family', async () => {
    /*
     * A → B → C → D
     */
    const loginResult =
      await loginAndGetRefreshToken();

    const tokenA =
      loginResult.refreshToken;

    const tokenAHash =
      hashToken(tokenA);

    const dbTokenA =
      await testPrisma.refreshToken.findUnique({
        where: {
          tokenHash: tokenAHash,
        },
      });

    expect(dbTokenA).not.toBeNull();

    const resultB =
      await authService.refresh(tokenA);

    const tokenB =
      resultB.refreshToken;

    const resultC =
      await authService.refresh(tokenB);

    const tokenC =
      resultC.refreshToken;

    const resultD =
      await authService.refresh(tokenC);

    const tokenD =
      resultD.refreshToken;

    expect(tokenB).not.toBe(tokenA);
    expect(tokenC).not.toBe(tokenB);
    expect(tokenD).not.toBe(tokenC);

    const tokens =
      await testPrisma.refreshToken.findMany({
        where: {
          userId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

    expect(tokens.length).toBe(4);

    const familyIds = new Set(
      tokens.map(
        (token) => token.familyId,
      ),
    );

    /*
     * All four tokens must belong
     * to the same family.
     */
    expect(familyIds.size).toBe(1);

    /*
     * A, B and C are revoked.
     * D is active.
     */
    const revokedTokens =
      tokens.filter(
        (token) =>
          token.revokedAt !== null,
      );

    const activeTokens =
      tokens.filter(
        (token) =>
          token.revokedAt === null,
      );

    expect(
      revokedTokens.length,
    ).toBe(3);

    expect(
      activeTokens.length,
    ).toBe(1);

    const activeToken =
      activeTokens[0];

    expect(
      activeToken.tokenHash,
    ).toBe(hashToken(tokenD));
  });
});