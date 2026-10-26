import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import type { TenantMemberRole } from '../generated/prisma/client.js';

import { ForbiddenError } from '../common/errors/forbidden.error.js';

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
        new ForbiddenError(
          'Tenant membership is required',
        ),
      );
      return;
    }

    if (!allowedRoles.includes(role)) {
      next(
        new ForbiddenError(
          'You do not have permission to perform this action',
        ),
      );
      return;
    }

    next();
  };
}