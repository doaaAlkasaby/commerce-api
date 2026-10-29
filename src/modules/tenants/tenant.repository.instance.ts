import { prisma } from '../../config/database.js';
import { TenantRepository } from './tenant.repository.js';

export const tenantRepository = new TenantRepository(prisma);
