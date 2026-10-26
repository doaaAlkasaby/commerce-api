import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { UnauthorizedError } from '../common/errors/unauthorized.error.js';
import { tenantService } from '../modules/tenants/tenant.service.instance.js';

export async function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantSlug = req
      .header('X-Tenant-Slug')
      ?.trim()
      .toLowerCase();

    if (!tenantSlug) {
      throw new UnauthorizedError(
        'Tenant context is required',
      );
    }

    const tenant =
      await tenantService.getTenantBySlug(
        tenantSlug,
      );

    if (tenant.status !== 'ACTIVE') {
      throw new UnauthorizedError(
        'Tenant is not active',
      );
    }

    req.tenant = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantStatus: tenant.status,
      userId: req.user?.userId,
    };

    next();
  } catch (error) {
    next(error);
  }
}