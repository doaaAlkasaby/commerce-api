import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../common/errors/app-error.js';
import { tenantService } from '../modules/tenants/tenant.service.instance.js';

export async function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantSlug = req.header('X-Tenant-Slug')?.trim().toLowerCase();

    if (!tenantSlug) {
      throw new AppError('Tenant context is required', 401, 'UNAUTHORIZED');
    }

    const tenant = await tenantService.getTenantBySlug(tenantSlug);

    if (tenant.status !== 'ACTIVE') {
      throw new AppError('Tenant is not active', 401, 'UNAUTHORIZED');
    }

    req.tenant = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantStatus: tenant.status,
      ...(req.user ? { userId: req.user.userId } : {}),
    };

    next();
  } catch (error) {
    next(error);
  }
}
