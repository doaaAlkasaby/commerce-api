import { vi } from 'vitest';

// Prevent in-process Vitest tests and dotenv/config from loading real Firebase credentials from .env
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.FIREBASE_PROJECT_ID = '';
process.env.FIREBASE_CLIENT_EMAIL = '';
process.env.FIREBASE_PRIVATE_KEY = '';

process.env.SECURITY_FINGERPRINT_SECRET ??=
  'test_security_fingerprint_secret_min_32_chars_long_12345';

vi.mock('../src/config/database.js', async () => {
  const { testPrisma } = await import('../src/config/test-database.js');

  return {
    prisma: testPrisma,
  };
});
