import type {
  TenantMemberRole,
  TenantMemberStatus,
  TenantStatus,
} from '../../generated/prisma/client.js';

export interface CreateTenantInput {
  name: string;
  slug: string;
  code: string;
  legalName?: string;
  defaultCountryCode?: string;
  defaultCurrency?: string;
  timezone?: string;
  logoStorageKey?: string;
  logoUrl?: string;
}

export interface UpdateTenantInput {
  name?: string;
  legalName?: string;
  defaultCountryCode?: string | null;
  defaultCurrency?: string | null;
  timezone?: string;
  logoStorageKey?: string | null;
  logoUrl?: string | null;
  status?: TenantStatus;
}

export interface AddTenantMemberInput {
  tenantId: string;
  userId: string;
  role?: TenantMemberRole;
}

export interface UpdateTenantMemberInput {
  role?: TenantMemberRole;
  status?: TenantMemberStatus;
}

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  tenantStatus: TenantStatus;
  userId?: string;
  memberId?: string;
  memberRole?: TenantMemberRole;
}