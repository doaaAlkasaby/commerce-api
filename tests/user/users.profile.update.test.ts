import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../src/app.js';

import { testPrisma } from '../../src/config/test-database.js';

import { hashPassword } from '../../src/common/security/password.js';

import { createAccessToken } from '../../src/common/security/jwt.js';

describe('PATCH /api/v1/users/me', () => {
  const userEmail =
    `profile-update-${Date.now()}@example.com`;

  let userId: string;
  let accessToken: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword('Password123!');

    const user = await testPrisma.user.create({
      data: {
        email: userEmail,
        passwordHash,
        firstName: 'Original',
        lastName: 'Name',
        isActive: true,
      },
    });

    userId = user.id;

    accessToken = await createAccessToken(user.id);
  });

  afterAll(async () => {
    await testPrisma.user.delete({
      where: {
        id: userId,
      },
    });

    await testPrisma.$disconnect();
  });

  it('updates the authenticated user profile', async () => {
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Updated',
        lastName: 'User',
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe('Profile updated successfully');

    expect(response.body.data.firstName).toBe('Updated');

    expect(response.body.data.lastName).toBe('User');

    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).patch('/api/v1/users/me').send({
      firstName: 'Updated',
    });

    expect(response.status).toBe(401);

    expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('validates profile fields', async () => {
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: '',
      });

    expect(response.status).toBe(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('does not allow protected fields to be updated', async () => {
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Safe',
        isActive: false,
        passwordHash: 'hacked',
      });

    expect(response.status).toBe(200);

    const user = await testPrisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    expect(user).not.toBeNull();

    expect(user?.firstName).toBe('Safe');

    expect(user?.isActive).toBe(true);

    expect(user?.passwordHash).not.toBe('hacked');
  });
});
