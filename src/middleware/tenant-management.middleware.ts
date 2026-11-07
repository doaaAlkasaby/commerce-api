import type { RequestHandler } from 'express';
import { z } from 'zod';
import { userRepository } from '../modules/users/user.repository.instance.js';
import { tenantService } from '../modules/tenants/tenant.service.instance.js';
import { AppError } from '../common/errors/app-error.js';

export function tenantManagement(write = false): RequestHandler {
  return async (req, _res, next) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success)
      throw new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    if (!req.user)
      throw new AppError(
        'Authentication required',
        401,
        'AUTHENTICATION_REQUIRED',
      );
    const user = await userRepository.findById(req.user.userId);
    if (!user?.isActive)
      throw new AppError('Account is inactive', 403, 'ACCOUNT_INACTIVE');
    if (user.role === 'ADMIN') {
      next();
      return;
    }
    const member = await tenantService.getMembership(id.data, req.user.userId);
    if (
      !member ||
      member.status !== 'ACTIVE' ||
      (write && !['OWNER', 'ADMIN'].includes(member.role))
    )
      throw new AppError(
        'You do not have permission to access this resource',
        403,
        'FORBIDDEN',
      );
    if (write && member.role === 'ADMIN') {
      const target =
        typeof req.params.userId === 'string'
          ? await tenantService.getMembership(id.data, req.params.userId)
          : null;
      if (req.body?.role === 'OWNER' || target?.role === 'OWNER')
        throw new AppError(
          'Only an owner can manage ownership',
          403,
          'FORBIDDEN',
        );
    }
    next();
  };
}
