import { describe, expect, it } from 'vitest';

import type { Response } from 'express';

import {
  sendSuccess,
  sendError,
} from '../../src/common/responses/api-response.js';

describe('API response utilities', () => {
  it('should create a success response', () => {
    const json = (body: unknown) => body;

    const res = {
      status: () => ({
        json,
      }),
    } as unknown as Response;

    const result = sendSuccess(
      res,
      {
        id: '123',
      },
      'Product retrieved successfully',
    );

    expect(result).toEqual({
      success: true,
      message: 'Product retrieved successfully',
      data: {
        id: '123',
      },
    });
  });

  it('should create an error response', () => {
    const json = (body: unknown) => body;

    const res = {
      status: () => ({
        json,
      }),
    } as unknown as Response;

    const result = sendError(
      res,
      'Product not found',
      'PRODUCT_NOT_FOUND',
      404,
    );

    expect(result).toEqual({
      success: false,
      message: 'Product not found',
      error: {
        code: 'PRODUCT_NOT_FOUND',
      },
    });
  });
});
