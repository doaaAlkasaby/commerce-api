import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import type {
  UserRole,
} from '../generated/prisma/client.js';

import {
  AppError,
} from '../common/errors/app-error.js';

import {
  userRepository,
} from '../modules/users/user.repository.instance.js';

export const authorize = (
  ...allowedRoles: UserRole[]
) => {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const userId =
      req.user?.userId;

    if (!userId) {
      throw new AppError(
        'Authentication required',
        401,
        'AUTHENTICATION_REQUIRED',
      );
    }

    const user =
      await userRepository.findById(
        userId,
      );

    if (!user) {
      throw new AppError(
        'User not found',
        401,
        'USER_NOT_FOUND',
      );
    }

    if (!user.isActive) {
      throw new AppError(
        'Account is inactive',
        403,
        'ACCOUNT_INACTIVE',
      );
    }

    if (
      !allowedRoles.includes(
        user.role,
      )
    ) {
      throw new AppError(
        'You do not have permission to access this resource',
        403,
        'FORBIDDEN',
      );
    }

    next();
  };
};