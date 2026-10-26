import { prisma } from '../../config/prisma.js';
import { TenantRepository } from './tenant.repository.js';

export const tenantRepository = new TenantRepository(prisma);