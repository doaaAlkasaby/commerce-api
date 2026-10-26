import { TenantService } from './tenant.service.js';
import { tenantRepository } from './tenant.repository.instance.js';

export const tenantService =
  new TenantService(tenantRepository);