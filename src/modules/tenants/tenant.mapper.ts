export function mapTenant(tenant: any) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    code: tenant.code,
    legalName: tenant.legalName,
    status: tenant.status,
    defaultCountryCode:
      tenant.defaultCountryCode,
    defaultCurrency:
      tenant.defaultCurrency,
    timezone: tenant.timezone,
    logoUrl: tenant.logoUrl,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

export function mapTenantMember(
  member: any,
) {
  return {
    id: member.id,
    tenantId: member.tenantId,
    userId: member.userId,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    user: member.user
      ? {
          id: member.user.id,
          email: member.user.email,
          firstName: member.user.firstName,
          lastName: member.user.lastName,
        }
      : undefined,
  };
}
export function mapTenantMembership(
  membership: {
    id: string;
    role: string;
    status: string;
    tenant: {
      id: string;
      name: string;
      slug: string;
      code: string;
      status: string;
      defaultCurrency: string | null;
      timezone: string;
      logoUrl: string | null;
    };
  },
) {
  return {
    membershipId: membership.id,
    role: membership.role,
    status: membership.status,

    tenant: {
      id: membership.tenant.id,
      name: membership.tenant.name,
      slug: membership.tenant.slug,
      code: membership.tenant.code,
      status: membership.tenant.status,
      defaultCurrency:
        membership.tenant.defaultCurrency,
      timezone: membership.tenant.timezone,
      logoUrl: membership.tenant.logoUrl,
    },
  };
}