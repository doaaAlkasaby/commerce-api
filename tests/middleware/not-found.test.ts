import request from 'supertest';
import { describe, expect, it } from 'vitest';

import app from '../../src/app.js';

describe('404 handling', () => {
  it('should return a standardized 404 response', async () => {
    const response = await request(app)
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Route GET /api/v1/does-not-exist not found',
      data: null,
    });
  });
});

describe('Unknown routes are not intercepted by review middleware', () => {
  it.each(['get', 'post', 'patch'] as const)(
    'returns the existing 404 envelope for %s with an unrelated tenant header',
    async (method) => {
      const path = '/api/v1/unknown-route?source=regression';
      const client = request(app);
      const response = await client[method](path).set(
        'X-Tenant-Slug',
        'nonexistent-tenant',
      );
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        message: `Route ${method.toUpperCase()} ${path} not found`,
        code: 'ROUTE_NOT_FOUND',
        data: null,
      });
    },
  );
});
