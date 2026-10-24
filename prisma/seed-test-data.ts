import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  DiscountType,
  InventoryTransactionType,
  PrismaClient,
  ProductStatus,
  UserRole,
} from '../src/generated/prisma/client.js';

import { hashPassword } from '../src/common/security/password.js';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL must be set to seed test data.');
}

const databaseName = new URL(testDatabaseUrl).pathname.slice(1);

if (!databaseName.endsWith('_test')) {
  throw new Error(
    'Refusing to seed: TEST_DATABASE_URL must point to a database ending in "_test".',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: testDatabaseUrl,
  }),
});

const seed = async (): Promise<void> => {
  const passwordHash = await hashPassword('TestPassword123!');

  const seeded = await prisma.$transaction(async (tx) => {
    const category = await tx.category.upsert({
      where: { slug: 'test-accessories' },
      update: {
        name: 'Test Accessories',
        description: 'Sample category for local API testing.',
        isActive: true,
      },
      create: {
        name: 'Test Accessories',
        slug: 'test-accessories',
        description: 'Sample category for local API testing.',
      },
    });

    const brand = await tx.brand.upsert({
      where: { slug: 'test-brand' },
      update: {
        name: 'Test Brand',
        description: 'Sample brand for local API testing.',
        isActive: true,
      },
      create: {
        name: 'Test Brand',
        slug: 'test-brand',
        description: 'Sample brand for local API testing.',
      },
    });

    const user = await tx.user.upsert({
      where: { email: 'test.customer@commerce.test' },
      update: {
        role: UserRole.CUSTOMER,
        isActive: true,
      },
      create: {
        email: 'test.customer@commerce.test',
        passwordHash,
        firstName: 'Test',
        lastName: 'Customer',
        role: UserRole.CUSTOMER,
        emailVerifiedAt: new Date(),
      },
    });

    const product = await tx.product.upsert({
      where: { slug: 'test-everyday-backpack' },
      update: {
        name: 'Test Everyday Backpack',
        description: 'A sample product with two color variants.',
        status: ProductStatus.ACTIVE,
        categoryId: category.id,
        brandId: brand.id,
        basePrice: '59.99',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '10.00',
        discountStartsAt: null,
        discountEndsAt: null,
      },
      create: {
        name: 'Test Everyday Backpack',
        slug: 'test-everyday-backpack',
        description: 'A sample product with two color variants.',
        status: ProductStatus.ACTIVE,
        categoryId: category.id,
        brandId: brand.id,
        basePrice: '59.99',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '10.00',
      },
    });

    const color = await tx.productAttribute.upsert({
      where: {
        productId_name: {
          productId: product.id,
          name: 'Color',
        },
      },
      update: { sortOrder: 0 },
      create: {
        productId: product.id,
        name: 'Color',
        sortOrder: 0,
      },
    });

    const black = await tx.productAttributeValue.upsert({
      where: {
        attributeId_value: {
          attributeId: color.id,
          value: 'Black',
        },
      },
      update: { sortOrder: 0 },
      create: {
        attributeId: color.id,
        value: 'Black',
        sortOrder: 0,
      },
    });

    const navy = await tx.productAttributeValue.upsert({
      where: {
        attributeId_value: {
          attributeId: color.id,
          value: 'Navy',
        },
      },
      update: { sortOrder: 1 },
      create: {
        attributeId: color.id,
        value: 'Navy',
        sortOrder: 1,
      },
    });

    const blackVariant = await tx.productVariant.upsert({
      where: {
        productId_combinationKey: {
          productId: product.id,
          combinationKey: black.id,
        },
      },
      update: {
        sku: 'TEST-BACKPACK-BLACK',
        price: null,
        isActive: true,
        values: {
          deleteMany: {},
          create: {
            attributeValueId: black.id,
          },
        },
      },
      create: {
        productId: product.id,
        sku: 'TEST-BACKPACK-BLACK',
        price: null,
        isActive: true,
        combinationKey: black.id,
        values: {
          create: {
            attributeValueId: black.id,
          },
        },
      },
    });

    const navyVariant = await tx.productVariant.upsert({
      where: {
        productId_combinationKey: {
          productId: product.id,
          combinationKey: navy.id,
        },
      },
      update: {
        sku: 'TEST-BACKPACK-NAVY',
        price: '64.99',
        isActive: true,
        values: {
          deleteMany: {},
          create: {
            attributeValueId: navy.id,
          },
        },
      },
      create: {
        productId: product.id,
        sku: 'TEST-BACKPACK-NAVY',
        price: '64.99',
        isActive: true,
        combinationKey: navy.id,
        values: {
          create: {
            attributeValueId: navy.id,
          },
        },
      },
    });

    const blackInventory = await tx.inventory.upsert({
      where: { variantId: blackVariant.id },
      update: {
        quantity: 25,
        reservedQuantity: 0,
      },
      create: {
        variantId: blackVariant.id,
        quantity: 25,
        reservedQuantity: 0,
      },
    });

    const navyInventory = await tx.inventory.upsert({
      where: { variantId: navyVariant.id },
      update: {
        quantity: 15,
        reservedQuantity: 0,
      },
      create: {
        variantId: navyVariant.id,
        quantity: 15,
        reservedQuantity: 0,
      },
    });

    await tx.inventoryTransaction.upsert({
      where: {
        inventoryId_type_referenceId: {
          inventoryId: blackInventory.id,
          type: InventoryTransactionType.STOCK_IN,
          referenceId: 'seed-test-data-black-v1',
        },
      },
      update: { quantity: 25, reason: 'Initial test stock' },
      create: {
        inventoryId: blackInventory.id,
        type: InventoryTransactionType.STOCK_IN,
        quantity: 25,
        referenceId: 'seed-test-data-black-v1',
        reason: 'Initial test stock',
      },
    });

    await tx.inventoryTransaction.upsert({
      where: {
        inventoryId_type_referenceId: {
          inventoryId: navyInventory.id,
          type: InventoryTransactionType.STOCK_IN,
          referenceId: 'seed-test-data-navy-v1',
        },
      },
      update: { quantity: 15, reason: 'Initial test stock' },
      create: {
        inventoryId: navyInventory.id,
        type: InventoryTransactionType.STOCK_IN,
        quantity: 15,
        referenceId: 'seed-test-data-navy-v1',
        reason: 'Initial test stock',
      },
    });

    const cart = await tx.cart.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    await tx.cartItem.upsert({
      where: {
        cartId_variantId: {
          cartId: cart.id,
          variantId: blackVariant.id,
        },
      },
      update: { quantity: 2 },
      create: {
        cartId: cart.id,
        variantId: blackVariant.id,
        quantity: 2,
      },
    });

    return {
      categoryId: category.id,
      brandId: brand.id,
      productId: product.id,
      variantIds: [blackVariant.id, navyVariant.id],
      userId: user.id,
      cartId: cart.id,
    };
  });

  console.log('Seeded test catalog and cart data:', seeded);
  console.log('Test user: test.customer@commerce.test / TestPassword123!');
};

try {
  await seed();
} catch (error) {
  console.error('Test data seed failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
