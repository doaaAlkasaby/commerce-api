import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';

import { createUserRepository } from '../../src/modules/users/user.repository.js';

import { createAuthService } from '../../src/modules/auth/auth.service.js';

import { verifyPassword } from '../../src/common/security/password.js';
import { refreshTokenRepository } from '../../src/modules/auth/refresh-token.repository.instance.js';

const userRepository = createUserRepository(testPrisma);

const authService = createAuthService(userRepository, refreshTokenRepository, {
  createVerificationToken: async () => {},
  verifyEmail: async () => {},
  resendVerification: async () => {},
});

describe('Auth service', () => {
  const testEmail = `auth-test-${Date.now()}@example.com`;

  beforeAll(async () => {
    await testPrisma.$connect();
  });

  afterAll(async () => {
    await testPrisma.user.deleteMany({
      where: {
        email: testEmail,
      },
    });

    await testPrisma.$disconnect();
  });

  it('should register a new user', async () => {
    const user = await authService.register({
      email: testEmail,
      password: 'StrongPassword123!',
      firstName: 'Test',
      lastName: 'User',
    });

    expect(user.email).toBe(testEmail);

    expect(user.firstName).toBe('Test');

    expect(user.lastName).toBe('User');

    expect(user.passwordHash).toContain('$argon2id$');

    const passwordIsValid = await verifyPassword(
      'StrongPassword123!',
      user.passwordHash,
    );

    expect(passwordIsValid).toBe(true);
  });

  it('should reject duplicate email', async () => {
    await expect(
      authService.register({
        email: testEmail,
        password: 'StrongPassword123!',
        firstName: 'Another',
        lastName: 'User',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMAIL_ALREADY_EXISTS',
    });
  });
});
