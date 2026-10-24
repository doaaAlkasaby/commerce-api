import request from 'supertest';
import { describe, expect, it } from 'vitest';

import app from '../../src/app.js';

describe('Request ID', () => {
  it('should generate a request ID when one is not provided', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);

    const requestId = response.headers['x-request-id'];

    expect(requestId).toBeDefined();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should preserve an incoming request ID', async () => {
    const requestId = 'test-request-id-123';

    const response = await request(app)
      .get('/api/v1/health')
      .set('X-Request-ID', requestId)
      .expect(200);

    expect(response.headers['x-request-id']).toBe(requestId);
  });
});
