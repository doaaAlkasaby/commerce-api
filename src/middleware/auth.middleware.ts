import { administrativeRateLimiter } from '../config/rate-limit.js';
import { userRepository } from '../modules/users/user.repository.instance.js';
import type { NextFunction, Request, Response } from 'express';

import {
  verifyAccessToken,
  type AccessTokenPayload,
} from '../common/security/jwt.js';

import { AppError } from '../common/errors/app-error.js';

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  const [scheme, token] = authorization.split(' ');

  if (
    scheme !== 'Bearer' ||
    !token ||
    authorization.split(' ').length !== 2 ||
    token.length > 8192
  ) {
    throw new AppError(
      'Invalid authorization header',
      401,
      'INVALID_AUTHORIZATION_HEADER',
    );
  }

  let payload: AccessTokenPayload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw new AppError(
      'Invalid or expired access token',
      401,
      'INVALID_ACCESS_TOKEN',
    );
  }

  if (!payload.sub) {
    throw new AppError('Invalid access token', 401, 'INVALID_ACCESS_TOKEN');
  }

  const account = await userRepository.findById(payload.sub);
  if (!account)
    throw new AppError('Invalid access token', 401, 'INVALID_ACCESS_TOKEN');
  if (!account.isActive)
    throw new AppError('Account is inactive', 403, 'ACCOUNT_INACTIVE');
  req.user = {
    userId: payload.sub,
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    administrativeRateLimiter(req, _res, next);
    return;
  }
  next();
};
