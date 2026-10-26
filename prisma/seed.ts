import { seedTax } from './seeds/tax.seed.js';
import { seedAppSettings } from './seeds/settings.seed.js';
import { seedUsers, seedAddresses } from './seeds/users.seed.js';
import { seedProducts,
  seedProductAttributesAndVariants,
  seedDefaultVariants,
  seedCarts ,
  seedWishlists, 
  seedCollections,
  seedHomeProductDiscounts,
  seedBanners,
  seedHomeBestSellerOrders,
 } from './seeds/products.seed.js';
import { seedCoupons } from './seeds/coupons.seed.js';
import { seedInventory } from './seeds/inventory.seed.js';
import { seedCategories, seedBrands } from './seeds/categories.seed.js';

import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
} from '../src/generated/prisma/client.js';

import { seedShipping } from './seeds/shipping.seed.js';
import { seedCountries } from './seeds/country.seed.js';




export const DEV_PASSWORD = 'Password123!';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined');
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});


/**
 * Real images hosted on Unsplash's public CDN.
 * Pass the photo id (the part after "photo-") plus the wanted size.
 */
export const unsplash = (photoId: string, width: number, height: number) =>
  `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${width}&h=${height}&q=80`;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}


// ============================================================
// Constants
// ============================================================











// ============================================================
// Main
// ============================================================

async function main() {
  console.log('');
  console.log('🌱 Starting database seed...');
  console.log('');

  try {

   

    const { customers } = await seedUsers(prisma);

    const categories = await seedCategories(prisma);

    const brands = await seedBrands(prisma);

    const products = await seedProducts(categories, brands, prisma);
    
    await seedCountries(prisma);
    
    await seedAppSettings(prisma);

    await seedTax(prisma);
    await seedShipping(prisma);

    await seedProductAttributesAndVariants(products, prisma);

    await seedDefaultVariants(products, prisma);

    await seedInventory(prisma);

    await seedAddresses(customers, prisma);

    await seedCarts(customers, prisma);

    await seedWishlists(customers, prisma);

    await seedCollections(products, prisma);

    await seedHomeProductDiscounts(prisma);

    await seedBanners(prisma);

    await seedHomeBestSellerOrders(customers, prisma);

    await seedCoupons(prisma);

    console.log('');
    console.log('✅ Database seed completed successfully!');
    console.log('');

    console.log('🔐 Development accounts:');
    console.log('');
    console.log('Admin:');
    console.log('  email: admin@example.com');
    console.log(`  password: ${DEV_PASSWORD}`);
    console.log('');
    console.log('Manager:');
    console.log('  email: manager@example.com');
    console.log(`  password: ${DEV_PASSWORD}`);
    console.log('');
    console.log('Customer:');
    console.log('  email: customer1@example.com');
    console.log(`  password: ${DEV_PASSWORD}`);
    console.log('');
  } catch (error) {
    console.error('');
    console.error('❌ Database seed failed');
    console.error(error);
    console.error('');

    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();