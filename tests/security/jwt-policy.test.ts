import { assertDevelopmentSeedTarget } from '../../src/config/seed-options.js';
import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import {
  createAccessToken,
  verifyAccessToken,
} from '../../src/common/security/jwt.js';
import { env } from '../../src/config/env.js';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      JWT_ISSUER: 'security-test-issuer',
      JWT_AUDIENCE: 'flutter-test-audience',
    },
  };
});
describe('explicit optional JWT issuer and audience policy', () => {
  it('issues and verifies configured claims without changing Bearer transport', async () => {
    const token = await createAccessToken('test-subject');
    expect(await verifyAccessToken(token)).toMatchObject({
      sub: 'test-subject',
      iss: 'security-test-issuer',
      aud: 'flutter-test-audience',
      type: 'access',
    });
  });
  it.each(['issuer', 'audience'])(
    'rejects a wrong configured %s',
    async (kind) => {
      const token = await new SignJWT({ type: 'access' })
        .setSubject('test-subject')
        .setIssuedAt()
        .setExpirationTime('5m')
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(kind === 'issuer' ? 'wrong' : 'security-test-issuer')
        .setAudience(kind === 'audience' ? 'wrong' : 'flutter-test-audience')
        .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
      await expect(verifyAccessToken(token)).rejects.toThrow();
    },
  );
});

describe('development seeding safety', () => {
  it('blocks production and remote targets without connecting', () => {
    expect(() =>
      assertDevelopmentSeedTarget('production', 'postgresql://localhost/local'),
    ).toThrow();
    expect(() =>
      assertDevelopmentSeedTarget(
        'development',
        'postgresql://database.example/commerce',
      ),
    ).toThrow();
    expect(() =>
      assertDevelopmentSeedTarget(
        'development',
        'postgresql://localhost/local',
      ),
    ).not.toThrow();
  });
});
