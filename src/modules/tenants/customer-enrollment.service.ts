import { prisma } from '../../config/database.js';
import { AppError } from '../../common/errors/app-error.js';
import { CustomerEnrollmentRepository } from './customer-enrollment.repository.js';

export async function enrollCustomer(tenantId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const repository = new CustomerEnrollmentRepository(tx);
    if (!(await repository.lockActiveTenant(tenantId)))
      throw new AppError(
        'Store does not permit enrollment',
        403,
        'STORE_ENROLLMENT_NOT_ALLOWED',
      );
    if (!(await repository.lockActiveUser(userId)))
      throw new AppError('This account is inactive', 403, 'ACCOUNT_INACTIVE');
    const inserted = await repository.createCustomer(tenantId, userId);
    const member = await repository.membership(tenantId, userId);
    if (member.status !== 'ACTIVE')
      throw new AppError(
        'Existing membership requires merchant review',
        403,
        'TENANT_MEMBERSHIP_INACTIVE',
      );
    return {
      created: inserted.count === 1,
      membership: {
        id: member.id,
        tenantId: member.tenantId,
        userId: member.userId,
        role: member.role,
        status: member.status,
      },
    };
  });
}
