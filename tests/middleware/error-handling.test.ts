import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/common/errors/app-error.js';

describe('AppError', () => {
  it('should create an operational application error', () => {
    const error = new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

    expect(error.message).toBe('Product not found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('PRODUCT_NOT_FOUND');
    expect(error.isOperational).toBe(true);
  });
});
