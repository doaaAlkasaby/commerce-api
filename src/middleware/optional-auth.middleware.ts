import type { NextFunction, Request, Response } from 'express';
import { authenticate } from './auth.middleware.js';

export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.headers.authorization) {
    next();
    return;
  }
  // Supplied credentials must follow the same token and active-account policy
  // as protected routes. Anonymous browsing remains available without a header.
  await authenticate(req, res, next);
};
