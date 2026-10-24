import request from 'supertest';

import app from '../../src/app.js';

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

import { testPrisma } from '../../src/config/test-database.js';

import { hashPassword } from '../../src/common/security/password.js';

import {
  generateSecureToken,
  hashToken,
} from '../../src/common/security/token.js';

describe('Email Verification', () => {
  let userId: string;

  beforeEach(async () => {
    const passwordHash = await hashPassword('Password123!');

    const user = await testPrisma.user.create({
      data: {
        email: `verification-${Date.now()}@example.com`,
        passwordHash,
        firstName: 'Verification',
        lastName: 'User',
      },
    });

    userId = user.id;
  });

  afterEach(async () => {
    await testPrisma.user.delete({
      where: {
        id: userId,
      },
    });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('verifies a valid email token', async () => {
    const rawToken = generateSecureToken();

    await testPrisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const response = await request(app).get('/api/v1/auth/verify-email').query({
      token: rawToken,
    });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    const user = await testPrisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    expect(user?.emailVerifiedAt).not.toBeNull();

    const token = await testPrisma.emailVerificationToken.findUnique({
      where: {
        tokenHash: hashToken(rawToken),
      },
    });

    expect(token?.usedAt).not.toBeNull();
  });

  it('rejects an invalid token', async () => {
    const response = await request(app).get('/api/v1/auth/verify-email').query({
      token: 'invalid-token',
    });

    expect(response.status).toBe(400);

    expect(response.body.code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('rejects an expired token', async () => {
    const rawToken = generateSecureToken();

    await testPrisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    });

    const response = await request(app).get('/api/v1/auth/verify-email').query({
      token: rawToken,
    });

    expect(response.status).toBe(400);

    expect(response.body.code).toBe('VERIFICATION_TOKEN_EXPIRED');
  });

  it('rejects a token that was already used', async () => {
    const rawToken = generateSecureToken();

    await testPrisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: new Date(),
      },
    });

    const response = await request(app).get('/api/v1/auth/verify-email').query({
      token: rawToken,
    });

    expect(response.status).toBe(400);

    expect(response.body.code).toBe('VERIFICATION_TOKEN_ALREADY_USED');
  });

  it('stores only the token hash', async () => {
    const rawToken = generateSecureToken();

    const tokenHash = hashToken(rawToken);

    const token = await testPrisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    expect(token.tokenHash).toBe(tokenHash);

    expect(token.tokenHash).not.toBe(rawToken);
  });

  it('cannot verify the same token twice', async () => {
    const rawToken = generateSecureToken();

    await testPrisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const firstResponse = await request(app)
      .get('/api/v1/auth/verify-email')
      .query({
        token: rawToken,
      });

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .get('/api/v1/auth/verify-email')
      .query({
        token: rawToken,
      });

    expect(secondResponse.status).toBe(400);

    expect(secondResponse.body.code).toBe('VERIFICATION_TOKEN_ALREADY_USED');
  });
});
