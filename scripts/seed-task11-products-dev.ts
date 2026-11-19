import { prisma } from '../src/config/database.js';
import { seedTask11Products } from '../prisma/seeds/task11-products.seed.js';

async function verifyDevelopmentDatabaseTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development Task 11 seed script is prohibited in production environment.');
  }

  const dbUrlStr = process.env.DATABASE_URL;
  if (!dbUrlStr || !dbUrlStr.trim()) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  try {
    const url = new URL(dbUrlStr);
    const dbName = url.pathname.replace(/^\//, '');
    const hostname = url.hostname.toLowerCase();
    if (dbName !== 'commerce_api_dev') {
      throw new Error(`Invalid database name: "${dbName}". Task 11 seed script must target "commerce_api_dev".`);
    }

    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      throw new Error(`Invalid database host: "${hostname}". Task 11 seed script must target "localhost" or "127.0.0.1".`);
    }

    if (!url.port) {
      throw new Error('DATABASE_URL must explicitly specify port 5432.');
    }

    if (url.port !== '5432') {
      throw new Error(`Invalid database port: "${url.port}". Task 11 seed script must target port 5432.`);
    }
  } catch (e: any) {
    if (e.message?.includes('Invalid database')) throw e;
    throw new Error(`Failed to parse DATABASE_URL: ${e.message}`);
  }

  // Read-only database identity query before write transaction
  const result = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const currentDb = result[0]?.current_database;
  if (currentDb !== 'commerce_api_dev') {
    throw new Error(`Database verification query returned unexpected database "${currentDb}". Expected "commerce_api_dev".`);
  }
}

async function main() {
  console.log('🔒 Verifying database target...');
  await verifyDevelopmentDatabaseTarget();

  console.log('🚀 Executing Atomic Task 11 Seeding against Development Database (commerce_api_dev)...');
  await prisma.$transaction(
    async (tx) => {
      await seedTask11Products(tx);
    },
    { timeout: 30000 },
  );
  console.log('✅ Atomic Task 11 Product Seeding Completed Successfully.');
}

main()
  .catch((err) => {
    console.error('❌ Seeding Failed:', err.message || err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
