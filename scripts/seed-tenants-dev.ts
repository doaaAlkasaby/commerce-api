import { prisma } from '../src/config/database.js';
import { seedTenants } from '../prisma/seeds/tenants.seed.js';

function verifyDevelopmentDatabaseTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development tenant seed script is prohibited in production environment.');
  }

  const dbUrlStr = process.env.DATABASE_URL;
  if (!dbUrlStr || !dbUrlStr.trim()) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  try {
    const url = new URL(dbUrlStr);
    const dbName = url.pathname.replace(/^\//, '');
    if (dbName !== 'commerce_api_dev') {
      throw new Error(`Invalid database target: "${dbName}". Tenant seed script must target "commerce_api_dev".`);
    }
  } catch (e: any) {
    if (e.message?.includes('Invalid database target')) throw e;
    throw new Error(`Failed to parse DATABASE_URL: ${e.message}`);
  }
}

async function main() {
  console.log('🔒 Verifying database target...');
  verifyDevelopmentDatabaseTarget();

  console.log('🚀 Executing Atomic Tenant-Only Seeding against Development Database (commerce_api_dev)...');
  await prisma.$transaction(
    async (tx) => {
      await seedTenants(tx);
    },
    { timeout: 30000 },
  );
  console.log('✅ Atomic Tenant-Only Seeding Completed Successfully.');
}

main()
  .catch((err) => {
    console.error('❌ Seeding Failed:', err.message || err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
