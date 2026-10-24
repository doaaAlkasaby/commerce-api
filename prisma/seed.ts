import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  type Brand,
  type Category,
  type Product,
  type ProductAttributeValue,
  type User,
} from '../src/generated/prisma/client.js';
import { hash } from 'argon2';

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

// ============================================================
// Constants
// ============================================================

const DEV_PASSWORD = 'Password123!';

const IMAGE_BASE_URL = 'https://placehold.co';

const image = (width: number, height: number, text: string) =>
  `${IMAGE_BASE_URL}/${width}x${height}?text=${encodeURIComponent(text)}`;

// ============================================================
// Helpers
// ============================================================

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function createPasswordHash(): Promise<string> {
  return hash(DEV_PASSWORD);
}

// ============================================================
// Users
// ============================================================

async function seedUsers() {
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
// Categories
// ============================================================

async function seedCategories() {
  console.log('📂 Seeding categories...');

  const categoryData = [
    {
      name: 'Women',
      description: 'Women fashion and accessories',
    },
    {
      name: 'Men',
      description: 'Men fashion and accessories',
    },
    {
      name: 'Shoes',
      description: 'Shoes and footwear',
    },
    {
      name: 'Bags',
      description: 'Bags and handbags',
    },
    {
      name: 'Accessories',
      description: 'Fashion accessories',
    },
    {
      name: 'Beauty',
      description: 'Beauty and personal care products',
    },
    {
      name: 'Sports',
      description: 'Sports and fitness products',
    },
    {
      name: 'Electronics',
      description: 'Consumer electronics',
    },
  ];

  const categories: Category[] = [];

  for (const data of categoryData) {
    const slug = slugify(data.name);

    const category = await prisma.category.upsert({
      where: {
        slug,
      },
      update: {
        name: data.name,
        description: data.description,
        isActive: true,
      },
      create: {
        name: data.name,
        slug,
        description: data.description,
        isActive: true,
      },
    });

    categories.push(category);
  }

  console.log(`   ✓ ${categories.length} categories created`);

  return categories;
}

// ============================================================
// Brands
// ============================================================

async function seedBrands() {
  console.log('🏷️ Seeding brands...');

  const brandData = [
    {
      name: 'Urban Style',
      description: 'Modern urban fashion',
    },
    {
      name: 'Nova',
      description: 'Contemporary lifestyle products',
    },
    {
      name: 'Elite',
      description: 'Premium products and accessories',
    },
    {
      name: 'Active Pro',
      description: 'Sports and fitness products',
    },
    {
      name: 'TechOne',
      description: 'Modern consumer electronics',
    },
    {
      name: 'Luna',
      description: 'Beauty and lifestyle products',
    },
  ];

  const brands: Brand[] = [];

  for (const data of brandData) {
    const slug = slugify(data.name);

    const brand = await prisma.brand.upsert({
      where: {
        slug,
      },
      update: {
        name: data.name,
        description: data.description,
        isActive: true,
      },
      create: {
        name: data.name,
        slug,
        description: data.description,
        isActive: true,
      },
    });

    brands.push(brand);
  }

  console.log(`   ✓ ${brands.length} brands created`);

  return brands;
}

// ============================================================
// Products
// ============================================================

async function seedProducts(
  categories: Category[],
  brands: Brand[],
): Promise<Product[]> {
  console.log('🛍️ Seeding products...');

  const productsData = [
    {
      name: 'Classic T-Shirt',
      price: '29.99',
      category: 'Women',
      brand: 'Urban Style',
      description: 'Classic everyday cotton t-shirt.',
    },
    {
      name: 'Premium Hoodie',
      price: '59.99',
      category: 'Women',
      brand: 'Urban Style',
      description: 'Premium comfortable hoodie.',
    },
    {
      name: 'Slim Fit Jeans',
      price: '79.99',
      category: 'Women',
      brand: 'Nova',
      description: 'Modern slim fit jeans.',
    },
    {
      name: 'Summer Dress',
      price: '89.99',
      category: 'Women',
      brand: 'Luna',
      description: 'Elegant summer dress.',
    },
    {
      name: 'Leather Jacket',
      price: '149.99',
      category: 'Women',
      brand: 'Elite',
      description: 'Premium leather jacket.',
    },

    {
      name: 'Basic Men T-Shirt',
      price: '24.99',
      category: 'Men',
      brand: 'Urban Style',
      description: "Classic men's t-shirt.",
    },
    {
      name: 'Men Casual Shirt',
      price: '49.99',
      category: 'Men',
      brand: 'Nova',
      description: "Casual men's shirt.",
    },
    {
      name: 'Men Chino Pants',
      price: '69.99',
      category: 'Men',
      brand: 'Elite',
      description: 'Comfortable chino pants.',
    },
    {
      name: 'Men Denim Jacket',
      price: '99.99',
      category: 'Men',
      brand: 'Urban Style',
      description: 'Classic denim jacket.',
    },
    {
      name: 'Men Running Shoes',
      price: '119.99',
      category: 'Shoes',
      brand: 'Active Pro',
      description: 'Lightweight running shoes.',
    },

    {
      name: 'Classic Sneakers',
      price: '89.99',
      category: 'Shoes',
      brand: 'Active Pro',
      description: 'Everyday sneakers.',
    },
    {
      name: 'Leather Handbag',
      price: '129.99',
      category: 'Bags',
      brand: 'Elite',
      description: 'Premium leather handbag.',
    },
    {
      name: 'Travel Backpack',
      price: '79.99',
      category: 'Bags',
      brand: 'Nova',
      description: 'Durable travel backpack.',
    },
    {
      name: 'Classic Sunglasses',
      price: '39.99',
      category: 'Accessories',
      brand: 'Elite',
      description: 'Classic sunglasses.',
    },
    {
      name: 'Premium Watch',
      price: '199.99',
      category: 'Accessories',
      brand: 'Elite',
      description: 'Premium everyday watch.',
    },

    {
      name: 'Face Moisturizer',
      price: '34.99',
      category: 'Beauty',
      brand: 'Luna',
      description: 'Daily face moisturizer.',
    },
    {
      name: 'Beauty Gift Set',
      price: '59.99',
      category: 'Beauty',
      brand: 'Luna',
      description: 'Complete beauty gift set.',
    },
    {
      name: 'Yoga Mat',
      price: '29.99',
      category: 'Sports',
      brand: 'Active Pro',
      description: 'Comfortable fitness yoga mat.',
    },
    {
      name: 'Sports Water Bottle',
      price: '19.99',
      category: 'Sports',
      brand: 'Active Pro',
      description: 'Reusable sports water bottle.',
    },
    {
      name: 'Wireless Headphones',
      price: '149.99',
      category: 'Electronics',
      brand: 'TechOne',
      description: 'Wireless noise-isolating headphones.',
    },
  ];

  const products: Product[] = [];

  for (const [index, data] of productsData.entries()) {
    const category = categories.find((item) => item.name === data.category);

    const brand = brands.find((item) => item.name === data.brand);

    if (!category) {
      throw new Error(`Category not found: ${data.category}`);
    }

    if (!brand) {
      throw new Error(`Brand not found: ${data.brand}`);
    }

    const slug = slugify(data.name);

    const product = await prisma.product.upsert({
      where: {
        slug,
      },
      update: {
        name: data.name,
        description: data.description,
        basePrice: data.price,
        status: 'ACTIVE',
        categoryId: category.id,
        brandId: brand.id,
      },
      create: {
        name: data.name,
        slug,
        description: data.description,
        status: 'ACTIVE',
        categoryId: category.id,
        brandId: brand.id,
        basePrice: data.price,
      },
    });

    // Product image
    await prisma.productImage.upsert({
      where: {
        id: `seed-product-image-${index + 1}`,
      },
      update: {
        productId: product.id,
        storageKey: `seed/products/${slug}.jpg`,
        url: image(800, 800, data.name),
        altText: data.name,
        sortOrder: 0,
        isPrimary: true,
      },
      create: {
        id: `seed-product-image-${index + 1}`,
        productId: product.id,
        storageKey: `seed/products/${slug}.jpg`,
        url: image(800, 800, data.name),
        altText: data.name,
        sortOrder: 0,
        isPrimary: true,
      },
    });

    products.push(product);
  }

  console.log(`   ✓ ${products.length} products created`);

  return products;
}

// ============================================================
// Home - Product Discounts
// ============================================================

async function seedHomeProductDiscounts() {
  console.log('🏠 Seeding home product discounts...');

  const now = new Date();

  const discountData = [
    {
      slug: 'classic-t-shirt',
      discountType: 'PERCENTAGE' as const,
      discountValue: '20.00',
    },
    {
      slug: 'premium-hoodie',
      discountType: 'PERCENTAGE' as const,
      discountValue: '15.00',
    },
    {
      slug: 'summer-dress',
      discountType: 'PERCENTAGE' as const,
      discountValue: '25.00',
    },
    {
      slug: 'leather-handbag',
      discountType: 'PERCENTAGE' as const,
      discountValue: '30.00',
    },
    {
      slug: 'wireless-headphones',
      discountType: 'PERCENTAGE' as const,
      discountValue: '20.00',
    },
    {
      slug: 'premium-watch',
      discountType: 'PERCENTAGE' as const,
      discountValue: '10.00',
    },
  ];

  for (const discount of discountData) {
    const product = await prisma.product.findUnique({
      where: {
        slug: discount.slug,
      },
    });

    if (!product) {
      throw new Error(`Product not found for home discount: ${discount.slug}`);
    }

    await prisma.product.update({
      where: {
        id: product.id,
      },
      data: {
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        discountStartsAt: now,
        discountEndsAt: null,
      },
    });
  }

  console.log(
    `   ✓ ${discountData.length} products configured as special offers`,
  );
}
// ============================================================
// Product Attributes + Variants
// ============================================================

async function seedProductAttributesAndVariants(products: Product[]) {
  console.log('🎨 Seeding product attributes and variants...');

  let variantCount = 0;
  let attributeCount = 0;
  let attributeValueCount = 0;

  const productsWithVariants = products.slice(0, 15);

  for (const product of productsWithVariants) {
    const sizeAttribute = await prisma.productAttribute.upsert({
      where: {
        productId_name: {
          productId: product.id,
          name: 'Size',
        },
      },
      update: {
        sortOrder: 0,
      },
      create: {
        productId: product.id,
        name: 'Size',
        sortOrder: 0,
      },
    });

    const colorAttribute = await prisma.productAttribute.upsert({
      where: {
        productId_name: {
          productId: product.id,
          name: 'Color',
        },
      },
      update: {
        sortOrder: 1,
      },
      create: {
        productId: product.id,
        name: 'Color',
        sortOrder: 1,
      },
    });

    attributeCount += 2;

    const sizes = ['S', 'M', 'L'];
    const colors = ['Black', 'White'];

    const sizeValues: ProductAttributeValue[] = [];
    const colorValues: ProductAttributeValue[] = [];

    for (const [index, value] of sizes.entries()) {
      const attributeValue = await prisma.productAttributeValue.upsert({
        where: {
          attributeId_value: {
            attributeId: sizeAttribute.id,
            value,
          },
        },
        update: {
          sortOrder: index,
        },
        create: {
          attributeId: sizeAttribute.id,
          value,
          sortOrder: index,
        },
      });

      sizeValues.push(attributeValue);
      attributeValueCount++;
    }

    for (const [index, value] of colors.entries()) {
      const attributeValue = await prisma.productAttributeValue.upsert({
        where: {
          attributeId_value: {
            attributeId: colorAttribute.id,
            value,
          },
        },
        update: {
          sortOrder: index,
          imageStorageKey: `seed/products/${slugify(
            product.name,
          )}-${slugify(value)}.jpg`,
          imageUrl: image(400, 400, `${product.name} ${value}`),
        },
        create: {
          attributeId: colorAttribute.id,
          value,
          sortOrder: index,
          imageStorageKey: `seed/products/${slugify(
            product.name,
          )}-${slugify(value)}.jpg`,
          imageUrl: image(400, 400, `${product.name} ${value}`),
        },
      });

      colorValues.push(attributeValue);
      attributeValueCount++;
    }

    /*
     * Create:
     *
     * S / Black
     * S / White
     * M / Black
     * M / White
     * L / Black
     * L / White
     */

    for (const size of sizeValues) {
      for (const color of colorValues) {
        const combinationKey = [size.id, color.id].sort().join(':');

        const sku = `SKU-${product.slug
          .replace(/-/g, '')
          .toUpperCase()}-${size.value.toUpperCase()}-${color.value
          .replace(/\s+/g, '')
          .toUpperCase()}`;

        const variant = await prisma.productVariant.upsert({
          where: {
            sku,
          },
          update: {
            productId: product.id,
            price: product.basePrice,
            isActive: true,
            combinationKey,
          },
          create: {
            productId: product.id,
            sku,
            price: product.basePrice,
            isActive: true,
            combinationKey,
          },
        });

        await prisma.productVariantValue.upsert({
          where: {
            variantId_attributeValueId: {
              variantId: variant.id,
              attributeValueId: size.id,
            },
          },
          update: {},
          create: {
            variantId: variant.id,
            attributeValueId: size.id,
          },
        });

        await prisma.productVariantValue.upsert({
          where: {
            variantId_attributeValueId: {
              variantId: variant.id,
              attributeValueId: color.id,
            },
          },
          update: {},
          create: {
            variantId: variant.id,
            attributeValueId: color.id,
          },
        });

        // Variant image
        const variantImageId = `seed-variant-image-${variant.id}`;

        await prisma.productVariantImage.upsert({
          where: {
            id: variantImageId,
          },
          update: {
            variantId: variant.id,
            storageKey: `seed/variants/${variant.sku}.jpg`,
            url: image(600, 600, `${product.name} ${color.value}`),
            altText: `${product.name} ${color.value}`,
            sortOrder: 0,
            isPrimary: true,
          },
          create: {
            id: variantImageId,
            variantId: variant.id,
            storageKey: `seed/variants/${variant.sku}.jpg`,
            url: image(600, 600, `${product.name} ${color.value}`),
            altText: `${product.name} ${color.value}`,
            sortOrder: 0,
            isPrimary: true,
          },
        });

        variantCount++;
      }
    }
  }

  console.log(`   ✓ ${attributeCount} attributes`);
  console.log(`   ✓ ${attributeValueCount} attribute values`);
  console.log(`   ✓ ${variantCount} variants`);

  return {
    variantCount,
  };
}

// ============================================================
// Inventory
// ============================================================

async function seedInventory() {
  console.log('📦 Seeding inventory...');

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
    },
  });

  for (const variant of variants) {
    await prisma.inventory.upsert({
      where: {
        variantId: variant.id,
      },
      update: {
        quantity: 100,
        reservedQuantity: 0,
      },
      create: {
        variantId: variant.id,
        quantity: 100,
        reservedQuantity: 0,
      },
    });
  }

  console.log(`   ✓ ${variants.length} inventory records`);

  return variants;
}

// ============================================================
// Addresses
// ============================================================

async function seedAddresses(customers: User[]) {
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

// ============================================================
// Cart
// ============================================================

async function seedCarts(customers: User[]) {
  console.log('🛒 Seeding carts...');

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 10,
  });

  for (const [index, customer] of customers.slice(0, 2).entries()) {
    const cart = await prisma.cart.upsert({
      where: {
        userId: customer.id,
      },
      update: {},
      create: {
        userId: customer.id,
      },
    });

    const variantsForCustomer = variants.slice(index * 2, index * 2 + 3);

    for (const [variantIndex, variant] of variantsForCustomer.entries()) {
      await prisma.cartItem.upsert({
        where: {
          cartId_variantId: {
            cartId: cart.id,
            variantId: variant.id,
          },
        },
        update: {
          quantity: variantIndex + 1,
        },
        create: {
          cartId: cart.id,
          variantId: variant.id,
          quantity: variantIndex + 1,
        },
      });
    }
  }

  console.log('   ✓ Carts seeded');
}

// ============================================================
// Wishlist
// ============================================================

async function seedWishlists(customers: User[]) {
  console.log('❤️ Seeding wishlists...');

  const products = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
    },
    take: 10,
  });

  for (const [index, customer] of customers.slice(0, 3).entries()) {
    const wishlist = await prisma.wishlist.upsert({
      where: {
        userId: customer.id,
      },
      update: {},
      create: {
        userId: customer.id,
      },
    });

    const productsForCustomer = products.slice(index, index + 3);

    for (const product of productsForCustomer) {
      await prisma.wishlistItem.upsert({
        where: {
          wishlistId_productId: {
            wishlistId: wishlist.id,
            productId: product.id,
          },
        },
        update: {},
        create: {
          wishlistId: wishlist.id,
          productId: product.id,
        },
      });
    }
  }

  console.log('   ✓ Wishlists seeded');
}

// ============================================================
// Collections
// ============================================================

async function seedCollections(products: Product[]) {
  console.log('📚 Seeding collections...');

  const collectionData = [
    {
      name: 'New Arrivals',
      description: 'Our latest products',
    },
    {
      name: 'Best Sellers',
      description: 'Our most popular products',
    },
    {
      name: 'Summer Collection',
      description: 'Products for summer',
    },
    {
      name: 'Featured',
      description: 'Featured products',
    },
  ];

  for (const data of collectionData) {
    const slug = slugify(data.name);

    const collection = await prisma.productCollection.upsert({
      where: {
        slug,
      },
      update: {
        name: data.name,
        description: data.description,
        isActive: true,
      },
      create: {
        name: data.name,
        slug,
        description: data.description,
        isActive: true,
      },
    });

    const selectedProducts =
      data.name === 'Featured' ? products.slice(0, 10) : products.slice(0, 5);

    for (const [index, product] of selectedProducts.entries()) {
      await prisma.productCollectionItem.upsert({
        where: {
          collectionId_productId: {
            collectionId: collection.id,
            productId: product.id,
          },
        },
        update: {
          sortOrder: index,
        },
        create: {
          collectionId: collection.id,
          productId: product.id,
          sortOrder: index,
        },
      });
    }
  }

  console.log(`   ✓ ${collectionData.length} collections seeded`);
}

// ============================================================
// Home - Best Seller Orders
// ============================================================

async function seedHomeBestSellerOrders(customers: User[]) {
  console.log('🏆 Seeding home best seller orders...');

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
    },
    include: {
      product: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 10,
  });

  if (customers.length === 0) {
    throw new Error(
      'At least one customer is required to seed best seller orders.',
    );
  }

  if (variants.length < 5) {
    throw new Error('Not enough active variants to seed best seller orders.');
  }

  const bestSellerQuantities = [30, 25, 20, 15, 12, 10, 8, 6, 5, 4];

  for (const [index, variant] of variants.entries()) {
    const customer = customers[index % customers.length];
    if (!customer) {
      throw new Error(`Customer not found for best seller order ${index + 1}.`);
    }

    const quantity = bestSellerQuantities[index] ?? 3;

    const orderNumber = `SEED-BESTSELLER-${String(index + 1).padStart(3, '0')}`;

    const unitPrice = variant.price ?? variant.product.basePrice;
    const totalPrice = unitPrice.mul(quantity).toFixed(2);

    const order = await prisma.order.upsert({
      where: {
        orderNumber,
      },

      update: {
        userId: customer.id,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        subtotal: totalPrice,
        discountAmount: '0.00',
        shippingAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: totalPrice,
        currency: 'USD',
      },

      create: {
        orderNumber,
        userId: customer.id,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        currency: 'USD',

        subtotal: totalPrice,
        discountAmount: '0.00',
        shippingAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: totalPrice,

        shippingAddress: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          addressLine1: '10 Example Street',
          city: 'Cairo',
          state: 'Cairo',
          postalCode: '11511',
          country: 'Egypt',
        },

        billingAddress: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          addressLine1: '10 Example Street',
          city: 'Cairo',
          state: 'Cairo',
          postalCode: '11511',
          country: 'Egypt',
        },
      },
    });

    await prisma.orderItem.upsert({
      where: {
        id: `seed-best-seller-item-${index + 1}`,
      },

      update: {
        orderId: order.id,
        productId: variant.productId,
        variantId: variant.id,
        productName: variant.product.name,
        sku: variant.sku,
        quantity,
        unitPrice,
        itemDiscountAmount: '0.00',
        finalUnitPrice: unitPrice,
        totalPrice,
        variantSnapshot: {
          id: variant.id,
          sku: variant.sku,
          price: unitPrice.toString(),
        },
      },

      create: {
        id: `seed-best-seller-item-${index + 1}`,
        orderId: order.id,
        productId: variant.productId,
        variantId: variant.id,
        productName: variant.product.name,
        sku: variant.sku,
        quantity,
        unitPrice,
        itemDiscountAmount: '0.00',
        finalUnitPrice: unitPrice,
        totalPrice,
        variantSnapshot: {
          id: variant.id,
          sku: variant.sku,
          price: unitPrice.toString(),
        },
      },
    });
  }

  console.log(`   ✓ ${variants.length} best seller orders seeded`);
}
// ============================================================
// Banners
// ============================================================

async function seedBanners() {
  console.log('🖼️ Seeding banners...');

  const banners = [
    {
      id: 'seed-banner-1',
      title: 'New Collection',
      subtitle: 'Discover our latest products',
      sortOrder: 0,
    },
    {
      id: 'seed-banner-2',
      title: 'Summer Sale',
      subtitle: 'Up to 30% off selected products',
      sortOrder: 1,
    },
    {
      id: 'seed-banner-3',
      title: 'Best Sellers',
      subtitle: 'Shop our most popular products',
      sortOrder: 2,
    },
    {
      id: 'seed-banner-4',
      title: 'Sports Collection',
      subtitle: 'Everything you need to stay active',
      sortOrder: 3,
    },
    {
      id: 'seed-banner-5',
      title: 'Electronics',
      subtitle: 'Discover the latest technology',
      sortOrder: 4,
    },
  ];

  for (const banner of banners) {
    await prisma.banner.upsert({
      where: {
        id: banner.id,
      },
      update: {
        title: banner.title,
        subtitle: banner.subtitle,
        imageStorageKey: `seed/banners/${banner.id}.jpg`,
        imageUrl: image(1600, 600, banner.title),
        sortOrder: banner.sortOrder,
        isActive: true,
        targetType: 'NONE',
      },
      create: {
        id: banner.id,
        title: banner.title,
        subtitle: banner.subtitle,
        imageStorageKey: `seed/banners/${banner.id}.jpg`,
        imageUrl: image(1600, 600, banner.title),
        sortOrder: banner.sortOrder,
        isActive: true,
        targetType: 'NONE',
      },
    });
  }

  console.log(`   ✓ ${banners.length} banners seeded`);
}

// ============================================================
// Coupons
// ============================================================

async function seedCoupons() {
  console.log('🎟️ Seeding coupons...');

  const coupons = [
    {
      code: 'WELCOME10',
      discountType: 'PERCENTAGE' as const,
      discountValue: '10.00',
      minimumOrderAmount: '50.00',
      maximumDiscountAmount: '30.00',
    },
    {
      code: 'SAVE20',
      discountType: 'PERCENTAGE' as const,
      discountValue: '20.00',
      minimumOrderAmount: '100.00',
      maximumDiscountAmount: '50.00',
    },
    {
      code: 'FLAT15',
      discountType: 'FIXED_AMOUNT' as const,
      discountValue: '15.00',
      minimumOrderAmount: '75.00',
      maximumDiscountAmount: null,
    },
    {
      code: 'VIP25',
      discountType: 'PERCENTAGE' as const,
      discountValue: '25.00',
      minimumOrderAmount: '150.00',
      maximumDiscountAmount: '75.00',
    },
    {
      code: 'NO_MINIMUM',
      discountType: 'FIXED_AMOUNT' as const,
      discountValue: '5.00',
      minimumOrderAmount: null,
      maximumDiscountAmount: null,
    },
  ];

  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: {
        code: coupon.code,
      },
      update: {
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minimumOrderAmount: coupon.minimumOrderAmount,
        maximumDiscountAmount: coupon.maximumDiscountAmount,
        isActive: true,
      },
      create: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minimumOrderAmount: coupon.minimumOrderAmount,
        maximumDiscountAmount: coupon.maximumDiscountAmount,
        isActive: true,
      },
    });
  }

  console.log(`   ✓ ${coupons.length} coupons seeded`);
}

async function seedAppSettings() {
  console.log('⚙️ Seeding app settings...');

  const settings = [
    {
      key: 'android_build',
      value: [1,2,3,4,5],
      description:
        'Supported Android build numbers for mobile application updates',
      isPublic: true,
    },
    {
      key: 'ios_build',
      value: [1,2,3,4,5],
      description:
        'Supported iOS build numbers for mobile application updates',
      isPublic: true,
    },
    {
      key: 'forceUpdate',
      value: true,
      description:
        'Whether the mobile application should force users to update',
      isPublic: true,
    },
    {
      key: 'currency_ar',
      value: 'ج.م',
      description: 'Currency display name in Arabic',
      isPublic: true,
    },
    {
      key: 'currency_en',
      value: 'L.E',
      description: 'Currency display name in English',
      isPublic: true,
    },
    {
      key: 'features',
      value: [
        'aiAssistant',
        'offers',
        'wishlist',
      ],
      description:
        'Features enabled for the mobile application',
      isPublic: true,
    },
  ];

  for (const setting of settings) {
    await prisma.appSetting.upsert({
      where: {
        key: setting.key,
      },
      update: {
        value: setting.value,
        description: setting.description,
        isPublic: setting.isPublic,
      },
      create: {
        key: setting.key,
        value: setting.value,
        description: setting.description,
        isPublic: setting.isPublic,
      },
    });
  }

  console.log(
    `   ✓ ${settings.length} app settings seeded`,
  );
}
// ============================================================
// Main
// ============================================================

async function main() {
  console.log('');
  console.log('🌱 Starting database seed...');
  console.log('');

  try {
    const { customers } = await seedUsers();

    const categories = await seedCategories();

    const brands = await seedBrands();

    const products = await seedProducts(categories, brands);

    await seedAppSettings();

    await seedProductAttributesAndVariants(products);

    await seedInventory();

    await seedAddresses(customers);

    await seedCarts(customers);

    await seedWishlists(customers);

    await seedCollections(products);

    await seedHomeProductDiscounts();

    await seedBanners();

    await seedHomeBestSellerOrders(customers);

    await seedCoupons();

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
