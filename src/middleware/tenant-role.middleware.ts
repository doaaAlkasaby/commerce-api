import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import type { TenantMemberRole } from '../generated/prisma/client.js';

import { AppError } from '../common/errors/app-error.js';

export function requireTenantRoles(
  ...allowedRoles: TenantMemberRole[]
) {
  return (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    const role = req.tenant?.memberRole;

    if (!role) {
      next(
        new AppError(
          'Tenant membership is required',
          403,
          'FORBIDDEN',
        ),
      );
      return;
    }

    if (!allowedRoles.includes(role)) {
      next(
        new AppError(
          'You do not have permission to perform this action',
          403,
          'FORBIDDEN',
        ),
      );
      return;
    }

    next();
  };
}
