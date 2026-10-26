import type {
  TenantMemberRole,
  TenantStatus,
} from '../../generated/prisma/client.js';

export interface TenantContext {
  tenantId: string;

  tenantSlug: string;

  tenantStatus: TenantStatus;

  userId?: string;

  memberId?: string;

  memberRole?: TenantMemberRole;
}