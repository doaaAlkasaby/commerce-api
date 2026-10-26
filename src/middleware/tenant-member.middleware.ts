import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { UnauthorizedError } from '../common/errors/unauthorized.error.js';
import { tenantService } from '../modules/tenants/tenant.service.instance.js';

export async function tenantMemberMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new UnauthorizedError(
        'Authentication is required',
      );
    }

    if (!req.tenant) {
      throw new UnauthorizedError(
        'Tenant context is required',
      );
    }

    const membership =
      await tenantService.getMembership(
        req.tenant.tenantId,
        req.user.userId,
      );

    if (!membership) {
      throw new UnauthorizedError(
        'You do not have access to this tenant',
      );
    }

    if (membership.status !== 'ACTIVE') {
      throw new UnauthorizedError(
        'Your tenant membership is not active',
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