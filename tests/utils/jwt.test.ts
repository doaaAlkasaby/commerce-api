import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createAccessToken,
  verifyAccessToken,
} from '../../src/common/security/jwt.js';

describe('JWT access token', () => {
  it('should create and verify an access token', async () => {
    const userId =
      '550e8400-e29b-41d4-a716-446655440000';

    const token =
      await createAccessToken(userId);

    const payload =
      await verifyAccessToken(token);

    expect(payload.sub).toBe(
      userId,
    );

    expect(payload.type).toBe(
      'access',
    );
  });

  it('should reject a modified token', async () => {
    const token =
      await createAccessToken(
        '550e8400-e29b-41d4-a716-446655440000',
      );

    const modifiedToken =
      `${token}modified`;

    await expect(
      verifyAccessToken(
        modifiedToken,
      ),
    ).rejects.toThrow();
  });

  it('should reject an invalid token', async () => {
    await expect(
      verifyAccessToken(
        'not-a-valid-jwt',
      ),
    ).rejects.toThrow();
  });
});