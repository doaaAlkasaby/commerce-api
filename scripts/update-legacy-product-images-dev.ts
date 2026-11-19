import { prisma } from '../src/config/database.js';
import { updateLegacyProductImages } from '../prisma/seeds/legacy-product-images.seed.js';

function verifyDevelopmentDatabaseTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development legacy product image update script is prohibited in production environment.');
  }

  const dbUrlStr = process.env.DATABASE_URL;
  if (!dbUrlStr || !dbUrlStr.trim()) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  try {
    const url = new URL(dbUrlStr);
    const dbName = url.pathname.replace(/^\//, '');
    if (dbName !== 'commerce_api_dev') {
      throw new Error(`Invalid database target: "${dbName}". Legacy product image update script must target "commerce_api_dev".`);
    }
  } catch (e: any) {
    if (e.message?.includes('Invalid database target')) throw e;
    throw new Error(`Failed to parse DATABASE_URL: ${e.message}`);
  }
}

async function main() {
  console.log('🔒 Verifying database target...');
  verifyDevelopmentDatabaseTarget();

  console.log('🚀 Executing Atomic Legacy Product Image Update against Development Database (commerce_api_dev)...');
  await prisma.$transaction(
    async (tx) => {
      await updateLegacyProductImages(tx);
    },
    { timeout: 30000 },
  );
  console.log('✅ Atomic Legacy Product Image Update Completed Successfully.');
}

main()
  .catch((err) => {
    console.error('❌ Update Failed:', err.message || err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
