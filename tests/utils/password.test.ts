import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  verifyPassword,
} from '../../src/common/security/password.js';

describe('Password security', () => {
  it('should hash a password', async () => {
    const password = 'MyStrongPassword123!';

    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash).toContain('$argon2id$');
  });

  it('should verify a correct password', async () => {
    const password = 'MyStrongPassword123!';

    const hash = await hashPassword(password);

    const valid = await verifyPassword(password, hash);

    expect(valid).toBe(true);
  });

  it('should reject an incorrect password', async () => {
    const password = 'MyStrongPassword123!';
    const wrongPassword = 'WrongPassword123!';

    const hash = await hashPassword(password);

    const valid = await verifyPassword(wrongPassword, hash);

    expect(valid).toBe(false);
  });
});
