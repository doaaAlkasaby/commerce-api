import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  verifyAccessToken,
} from '../common/security/jwt.js';

import { AppError } from '../common/errors/app-error.js';

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const authorization =
    req.headers.authorization;

  if (!authorization) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  const [scheme, token] =
    authorization.split(' ');

  if (
    scheme !== 'Bearer' ||
    !token
  ) {
    throw new AppError(
      'Invalid authorization header',
      401,
      'INVALID_AUTHORIZATION_HEADER',
    );
  }

  try {
    const payload =
      await verifyAccessToken(token);

    if (!payload.sub) {
      throw new AppError(
        'Invalid access token',
        401,
        'INVALID_ACCESS_TOKEN',
      );
    }

    req.user = {
      userId: payload.sub,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      'Invalid or expired access token',
      401,
      'INVALID_ACCESS_TOKEN',
    );
  }
};