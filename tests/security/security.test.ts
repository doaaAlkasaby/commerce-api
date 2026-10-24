import { describe, expect, it } from 'vitest';

import request from 'supertest';

import app from '../../src/app.js';

describe('Security middleware', () => {
  it('should set security headers', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.headers).toHaveProperty('x-content-type-options');

    expect(response.headers).toHaveProperty('x-frame-options');
  });

  it('should hide Express technology header', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  it('should allow configured frontend origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });

  it('should not allow an unknown origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://malicious.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
