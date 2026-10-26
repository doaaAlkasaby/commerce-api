import { hash } from 'argon2';
import {
  PrismaClient,
  type User,
} from '../../src/generated/prisma/client.js';

import {DEV_PASSWORD} from "../seed.js";

// ============================================================

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined');
}


// Users
// ============================================================

export async function seedUsers(prisma: PrismaClient,) {
  console.log('👤 Seeding users...');

  const passwordHash = await createPasswordHash();

  const admin = await prisma.user.upsert({
    where: {
      email: 'admin@example.com',
    },
    update: {
      firstName: 'Admin',
      lastName: 'User',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: 'admin@example.com',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  const manager = await prisma.user.upsert({
    where: {
      email: 'manager@example.com',
    },
    update: {
      firstName: 'Store',
      lastName: 'Manager',
      passwordHash,
      role: 'MANAGER',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: 'manager@example.com',
      passwordHash,
      firstName: 'Store',
      lastName: 'Manager',
      role: 'MANAGER',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  const customers: User[] = [];

  for (let index = 1; index <= 5; index++) {
    const customer = await prisma.user.upsert({
      where: {
        email: `customer${index}@example.com`,
      },
      update: {
        firstName: `Customer`,
        lastName: `${index}`,
        passwordHash,
        role: 'CUSTOMER',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
      create: {
        email: `customer${index}@example.com`,
        passwordHash,
        firstName: `Customer`,
        lastName: `${index}`,
        role: 'CUSTOMER',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });

    customers.push(customer);
  }

  console.log('   ✓ Admin created');
  console.log('   ✓ Manager created');
  console.log(`   ✓ ${customers.length} customers created`);

  return {
    admin,
    manager,
    customers,
  };
}
 
// ============================================================
// Helpers
// ============================================================


async function createPasswordHash(): Promise<string> {
  return hash(DEV_PASSWORD);
}



// ============================================================
// Addresses
// ============================================================

export async function seedAddresses(customers: User[], prisma: PrismaClient,) {
  console.log('🏠 Seeding addresses...');

  for (const [index, customer] of customers.entries()) {
    const existing = await prisma.address.findFirst({
      where: {
        userId: customer.id,
        label: 'Home',
      },
    });

    if (existing) {
      await prisma.address.update({
        where: {
          id: existing.id,
        },
        data: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          addressLine1: `${10 + index} Example Street`,
          city: 'Cairo',
          state: 'Cairo',
          postalCode: '11511',
          country: 'Egypt',
          phone: `0100000000${index}`,
          isDefaultShipping: true,
          isDefaultBilling: true,
        },
      });
    } else {
      await prisma.address.create({
        data: {
          userId: customer.id,
          label: 'Home',
          firstName: customer.firstName,
          lastName: customer.lastName,
          addressLine1: `${10 + index} Example Street`,
          city: 'Cairo',
          state: 'Cairo',
          postalCode: '11511',
          country: 'Egypt',
          phone: `0100000000${index}`,
          isDefaultShipping: true,
          isDefaultBilling: true,
        },
      });
    }
  }

  console.log(`   ✓ ${customers.length} addresses created`);
}
