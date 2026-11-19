import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authenticate } from '../../src/middleware/auth.middleware.js';
import { optionalAuthenticate } from '../../src/middleware/optional-auth.middleware.js';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.middleware.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { userRepository } from '../../src/modules/users/user.repository.instance.js';

vi.mock('../../src/modules/users/user.repository.instance.js', () => ({
  userRepository: { findById: vi.fn() },
}));

const account = {
  id: 'account-policy-test',
  email: 'policy@example.test',
  passwordHash: 'unused',
  firstName: 'Policy',
  lastName: 'Test',
  role: 'CUSTOMER' as const,
  isActive: true,
  emailVerifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const app = express();
app.use(requestIdMiddleware);
app.get('/protected', authenticate, (req, res) =>
  res.json({ userId: req.user?.userId }),
);
app.get('/public', optionalAuthenticate, (req, res) =>
  res.json({ userId: req.user?.userId ?? null }),
);
app.use(errorMiddleware);
let token: string;
beforeAll(async () => {
  token = await createAccessToken(account.id);
});
beforeEach(() => {
  vi.mocked(userRepository.findById).mockReset().mockResolvedValue(account);
});

describe.each(['/protected', '/public'])(
  'supplied authentication on %s',
  (path) => {
    it('accepts a valid token for an active account', async () => {
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(account.id);
    });
    it('rejects a deleted account', async () => {
      vi.mocked(userRepository.findById).mockResolvedValue(null);
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_ACCESS_TOKEN');
    });
    it('rejects an inactive account', async () => {
      vi.mocked(userRepository.findById).mockResolvedValue({
        ...account,
        isActive: false,
      });
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_INACTIVE');
    });
    it('reports account lookup failures as server errors without exposing their details', async () => {
      vi.mocked(userRepository.findById).mockRejectedValue(
        new Error('DATABASE_SECRET_CANARY'),
      );
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(response.body)).not.toContain(
        'DATABASE_SECRET_CANARY',
      );
    });
    it.each([
      'Bearer invalid-token',
      'Basic invalid-token',
      'Bearer token extra',
      'Bearer  token',
      `Bearer ${'x'.repeat(8193)}`,
    ])('rejects invalid or malformed credentials (%#)', async (header) => {
      const response = await request(app)
        .get(path)
        .set('Authorization', header);
      expect(response.status).toBe(401);
      expect(userRepository.findById).not.toHaveBeenCalled();
    });
  },
);

describe('anonymous browsing', () => {
  it('allows guests on public routes without looking up an account', async () => {
    expect((await request(app).get('/public')).status).toBe(200);
    expect(userRepository.findById).not.toHaveBeenCalled();
  });
  it('requires a token on protected routes', async () => {
    expect((await request(app).get('/protected')).status).toBe(401);
    expect(userRepository.findById).not.toHaveBeenCalled();
  });
});
