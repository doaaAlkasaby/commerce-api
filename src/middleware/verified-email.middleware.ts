import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../common/errors/app-error.js';

import {
  userRepository,
} from '../modules/users/user.repository.instance.js';

export const requireVerifiedEmail = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = req.user?.userId;

  if (!userId) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  const user =
    await userRepository.findById(userId);

  if (!user) {
    throw new AppError(
      'Authentication required',
      401,
      'AUTHENTICATION_REQUIRED',
    );
  }

  if (!user.isActive) {
    throw new AppError(
      'Account is inactive',
      403,
      'ACCOUNT_INACTIVE',
    );
  }

  if (!user.emailVerifiedAt) {
    throw new AppError(
      'Email address must be verified',
      403,
      'EMAIL_NOT_VERIFIED',
    );
  }

  next();
};