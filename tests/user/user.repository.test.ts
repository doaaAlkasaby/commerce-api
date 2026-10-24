import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';

import { createUserRepository } from '../../src/modules/users/user.repository.js';

describe('User repository', () => {
  const testEmail = `repository-test-${Date.now()}@example.com`;

  const userRepository = createUserRepository(testPrisma);

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

  it('should create and retrieve a user', async () => {
    const created = await userRepository.create({
      email: testEmail,
      passwordHash: 'test-hash',
      firstName: 'Test',
      lastName: 'User',
    });

    expect(created.email).toBe(testEmail);

    const found = await userRepository.findByEmail(testEmail);

    expect(found).not.toBeNull();
    expect(found?.email).toBe(testEmail);
  });
});
