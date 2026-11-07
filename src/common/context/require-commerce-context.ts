import type { Request } from 'express';

import { AppError } from '../errors/app-error.js';

import type { CommerceContext } from './commerce-context.types.js';

export function requireCommerceContext(req: Request): CommerceContext {
  if (!req.commerceContext) {
    throw new AppError(
      'Commerce country context is required.',
      400,
      'COUNTRY_REQUIRED',
    );
  }

  return req.commerceContext;
}
