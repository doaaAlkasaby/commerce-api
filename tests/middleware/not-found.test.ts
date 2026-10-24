
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
