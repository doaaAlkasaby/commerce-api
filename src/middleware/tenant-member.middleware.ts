import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { AppError } from '../common/errors/app-error.js';
import { tenantService } from '../modules/tenants/tenant.service.instance.js';

export async function tenantMemberMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(
        'Authentication is required',
        401,
        'UNAUTHORIZED',
      );
    }

    if (!req.tenant) {
      throw new AppError(
        'Tenant context is required',
        401,
        'UNAUTHORIZED',
      );
    }

    const membership =
      await tenantService.getMembership(
        req.tenant.tenantId,
        req.user.userId,
      );

    if (!membership) {
      throw new AppError(
        'You do not have access to this tenant',
        401,
        'UNAUTHORIZED',
      );
    }

    if (membership.status !== 'ACTIVE') {
      throw new AppError(
        'Your tenant membership is not active',
        401,
        'UNAUTHORIZED',
      );
    }

    req.tenant = {
      ...req.tenant,
      userId: req.user.userId,
      memberId: membership.id,
      memberRole: membership.role,
    };

    next();
  } catch (error) {
    next(error);
  }
}
