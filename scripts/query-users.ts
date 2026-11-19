import { prisma } from '../src/config/database.js';

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      emailVerifiedAt: true,
      tenantMemberships: {
        select: {
          tenantId: true,
          role: true,
          tenant: { select: { slug: true, name: true } }
        }
      }
    }
  });

  console.log('--- USER DIAGNOSTICS START ---');
  console.log('TOTAL USERS IN DB:', users.length);
  for (const user of users) {
    console.log(`EMAIL: ${user.email} | ROLE: ${user.role} | IS_ACTIVE: ${user.isActive} | VERIFIED: ${user.emailVerifiedAt != null}`);
    for (const mem of user.tenantMemberships) {
      console.log(`   -> Tenant Slug: ${mem.tenant.slug} | Name: ${mem.tenant.name} | TenantRole: ${mem.role}`);
    }
  }
  console.log('--- USER DIAGNOSTICS END ---');
}

main().catch(console.error).finally(() => prisma.$disconnect());
