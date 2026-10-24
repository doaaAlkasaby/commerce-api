import { vi } from 'vitest';

vi.mock('../src/config/database.js', async () => {
  const { testPrisma } = await import('../src/config/test-database.js');

  return {
    prisma: testPrisma,
  };
});
