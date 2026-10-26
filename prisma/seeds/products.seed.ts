
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  type Brand,
  type Category,
  type Product,
  type ProductAttributeValue,
  type User,
} from '../../src/generated/prisma/client.js';

import {slugify, unsplash} from "../seed.js";




const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined');
}

const productImage = (slug: string, width: number, height: number) =>
  unsplash(PRODUCT_PHOTO_IDS[slug] ?? FALLBACK_PHOTO_ID, width, height);


/** Fallback if a slug is missing from the map above */
const FALLBACK_PHOTO_ID = '1523381210434-271e8be1f52b';
/** Banner id -> Unsplash photo id */
const BANNER_PHOTO_IDS: Record<string, string> = {
  'seed-banner-1': '1483985988355-763728e1935b',
  'seed-banner-2': '1441986300917-64674bd600d8',
  'seed-banner-3': '1523381210434-271e8be1f52b',
  'seed-banner-4': '1517836357463-d25dfeac3438',
  'seed-banner-5': '1498049794561-7780e7231661',
};


/** Product slug -> Unsplash photo id */
const PRODUCT_PHOTO_IDS: Record<string, string> = {
  'classic-t-shirt': '1521572163474-6864f9cf17ab',
  'premium-hoodie': '1556821840-3a63f95609a7',
  'slim-fit-jeans': '1542272604-787c3835535d',
  'summer-dress': '1595777457583-95e059d581b8',
  'leather-jacket': '1551028719-00167b16eac5',
  'basic-men-t-shirt': '1583743814966-8936f5b7be1a',
  'men-casual-shirt': '1596755094514-f87e34085b2c',
  'men-chino-pants': '1473966968600-fa801b869a1a',
  'men-denim-jacket': '1576995853123-5a10305d93c0',
  'men-running-shoes': '1542291026-7eec264c27ff',
  'classic-sneakers': '1491553895911-0055eca6402d',
  'leather-handbag': '1584917865442-de89df76afd3',
  'travel-backpack': '1553062407-98eeb64c6a62',
  'classic-sunglasses': '1572635196237-14b3f281503f',
  'premium-watch': '1523275335684-37898b6baf30',
  'face-moisturizer': '1556228720-195a672e8a03',
  'beauty-gift-set': '1596462502278-27bfdc403348',
  'yoga-mat': '1601925260368-ae2f83cf8b7f',
  'sports-water-bottle': '1602143407151-7111542de6e8',
  'wireless-headphones': '1505740420928-5e560c06d30e',
};

// ============================================================
// Products
// ============================================================

export async function seedProducts(
  categories: Category[],
  brands: Brand[],
  prisma: PrismaClient,
): Promise<Product[]> {
  console.log('🛍️ Seeding products...');

 const productsData = [
  // ============================================================
  // Women
  // ============================================================

  {
    name: 'Classic T-Shirt',
    price: '29.99',
    categorySlug: 'women-tops',
    brand: 'Urban Style',
    description: 'Classic everyday cotton t-shirt.',
  },
  {
    name: 'Premium Hoodie',
    price: '59.99',
    categorySlug: 'women-tops',
    brand: 'Urban Style',
    description: 'Premium comfortable hoodie.',
  },
  {
    name: 'Slim Fit Jeans',
    price: '79.99',
    categorySlug: 'women-jeans',
    brand: 'Nova',
    description: 'Modern slim fit jeans.',
  },
  {
    name: 'Summer Dress',
    price: '89.99',
    categorySlug: 'women-dresses',
    brand: 'Luna',
    description: 'Elegant summer dress.',
  },
  {
    name: 'Leather Jacket',
    price: '149.99',
    categorySlug: 'women-jackets',
    brand: 'Elite',
    description: 'Premium leather jacket.',
  },

  // ============================================================
  // Men
  // ============================================================

  {
    name: 'Basic Men T-Shirt',
    price: '24.99',
    categorySlug: 'men-t-shirts',
    brand: 'Urban Style',
    description: "Classic men's t-shirt.",
  },
  {
    name: 'Men Casual Shirt',
    price: '49.99',
    categorySlug: 'men-shirts',
    brand: 'Nova',
    description: "Casual men's shirt.",
  },
  {
    name: 'Men Chino Pants',
    price: '69.99',
    categorySlug: 'men-pants',
    brand: 'Elite',
    description: 'Comfortable chino pants.',
  },
  {
    name: 'Men Denim Jacket',
    price: '99.99',
    categorySlug: 'men-jackets',
    brand: 'Urban Style',
    description: 'Classic denim jacket.',
  },

  // ============================================================
  // Shoes
  // ============================================================

  {
    name: 'Men Running Shoes',
    price: '119.99',
    categorySlug: 'shoes-running-shoes',
    brand: 'Active Pro',
    description: 'Lightweight running shoes.',
  },
  {
    name: 'Classic Sneakers',
    price: '89.99',
    categorySlug: 'shoes-sneakers',
    brand: 'Active Pro',
    description: 'Everyday sneakers.',
  },

  // ============================================================
  // Bags
  // ============================================================

  {
    name: 'Leather Handbag',
    price: '129.99',
    categorySlug: 'bags-handbags',
    brand: 'Elite',
    description: 'Premium leather handbag.',
  },
  {
    name: 'Travel Backpack',
    price: '79.99',
    categorySlug: 'bags-backpacks',
    brand: 'Nova',
    description: 'Durable travel backpack.',
  },

  // ============================================================
  // Accessories
  // ============================================================

  {
    name: 'Classic Sunglasses',
    price: '39.99',
    categorySlug: 'accessories-sunglasses',
    brand: 'Elite',
    description: 'Classic sunglasses.',
  },
  {
    name: 'Premium Watch',
    price: '199.99',
    categorySlug: 'accessories-watches',
    brand: 'Elite',
    description: 'Premium everyday watch.',
  },

  // ============================================================
  // Beauty
  // ============================================================

  {
    name: 'Face Moisturizer',
    price: '34.99',
    categorySlug: 'beauty-skincare',
    brand: 'Luna',
    description: 'Daily face moisturizer.',
  },
  {
    name: 'Beauty Gift Set',
    price: '59.99',
    categorySlug: 'beauty-makeup',
    brand: 'Luna',
    description: 'Complete beauty gift set.',
  },

  // ============================================================
  // Sports
  // ============================================================

  {
    name: 'Yoga Mat',
    price: '29.99',
    categorySlug: 'sports-fitness',
    brand: 'Active Pro',
    description: 'Comfortable fitness yoga mat.',
  },
  {
    name: 'Sports Water Bottle',
    price: '19.99',
    categorySlug: 'sports-fitness',
    brand: 'Active Pro',
    description: 'Reusable sports water bottle.',
  },

  // ============================================================
  // Electronics
  // ============================================================

  {
    name: 'Wireless Headphones',
    price: '149.99',
    categorySlug: 'electronics-headphones',
    brand: 'TechOne',
    description: 'Wireless noise-isolating headphones.',
  },
];

  const products: Product[] = [];

  for (const [index, data] of productsData.entries()) {
// const category = categories.find(
//   (item) => item.slug === data.categorySlug,
// );

// const brand = brands.find(
//   (item) => item.name === data.brand,
// );

const categoryMap = new Map(
  categories.map((category) => [
    category.slug,
    category,
  ]),
);

const brandMap = new Map(
  brands.map((brand) => [
    brand.name,
    brand,
  ]),
);

const category = categoryMap.get(
  data.categorySlug,
);

const brand = brandMap.get(
  data.brand,
);

if (!category) {
  throw new Error(
    `Category not found: ${data.categorySlug}`,
  );
}

if (!brand) {
  throw new Error(
    `Brand not found: ${data.brand}`,
  );
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
        url: productImage(slug, 800, 800),
        altText: data.name,
        sortOrder: 0,
        isPrimary: true,
      },
      create: {
        id: `seed-product-image-${index + 1}`,
        productId: product.id,
        storageKey: `seed/products/${slug}.jpg`,
        url: productImage(slug, 800, 800),
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
// Cart
// ============================================================

export async function seedCarts(customers: User[], prisma: PrismaClient,) {
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

export async function seedWishlists(customers: User[], prisma: PrismaClient,) {
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

export async function seedCollections(products: Product[], prisma: PrismaClient,) {
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

export async function seedHomeBestSellerOrders(customers: User[], prisma: PrismaClient,) {
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

export async function seedBanners(prisma: PrismaClient,) {
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
    const bannerUrl = unsplash(
      BANNER_PHOTO_IDS[banner.id] ?? FALLBACK_PHOTO_ID,
      1600,
      600,
    );

    await prisma.banner.upsert({
      where: {
        id: banner.id,
      },
      update: {
        title: banner.title,
        subtitle: banner.subtitle,
        imageStorageKey: `seed/banners/${banner.id}.jpg`,
        imageUrl: bannerUrl,
        sortOrder: banner.sortOrder,
        isActive: true,
        targetType: 'NONE',
      },
      create: {
        id: banner.id,
        title: banner.title,
        subtitle: banner.subtitle,
        imageStorageKey: `seed/banners/${banner.id}.jpg`,
        imageUrl: bannerUrl,
        sortOrder: banner.sortOrder,
        isActive: true,
        targetType: 'NONE',
      },
    });
  }

  console.log(`   ✓ ${banners.length} banners seeded`);
}


// ============================================================
// Home - Product Discounts
// ============================================================

export async function seedHomeProductDiscounts(prisma: PrismaClient,) {
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

export async function seedProductAttributesAndVariants(products: Product[],prisma: PrismaClient,) {
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
          imageUrl: productImage(product.slug, 400, 400),
        },
        create: {
          attributeId: colorAttribute.id,
          value,
          sortOrder: index,
          imageStorageKey: `seed/products/${slugify(
            product.name,
          )}-${slugify(value)}.jpg`,
          imageUrl: productImage(product.slug, 400, 400),
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
    isDefault: false,
    combinationKey,
  },
  create: {
    productId: product.id,
    sku,
    price: product.basePrice,
    isActive: true,
    isDefault: false,
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
            url: productImage(product.slug, 600, 600),
            altText: `${product.name} ${color.value}`,
            sortOrder: 0,
            isPrimary: true,
          },
          create: {
            id: variantImageId,
            variantId: variant.id,
            storageKey: `seed/variants/${variant.sku}.jpg`,
            url: productImage(product.slug, 600, 600),
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
// Default Variants for Products Without Selectable Options
// ============================================================

export async function seedDefaultVariants(products: Product[], prisma: PrismaClient,) {
  console.log('📦 Seeding default variants for products without options...');

  let createdCount = 0;
  let updatedCount = 0;

  for (const product of products) {
    /*
     * Products that already have selectable attributes/variants
     * do not need a default variant.
     *
     * We identify these products by checking whether they already
     * have ProductAttribute records.
     */
    const attributes = await prisma.productAttribute.count({
      where: {
        productId: product.id,
      },
    });

    if (attributes > 0) {
      continue;
    }

    /*
     * Products without attributes must have exactly one
     * canonical default variant.
     */
    const existingDefaultVariant =
      await prisma.productVariant.findFirst({
        where: {
          productId: product.id,
          isDefault: true,
        },
      });

    if (existingDefaultVariant) {
      await prisma.productVariant.update({
        where: {
          id: existingDefaultVariant.id,
        },
        data: {
          productId: product.id,
          price: product.basePrice,
          isActive: true,
          isDefault: true,
          combinationKey: 'DEFAULT',
        },
      });

      updatedCount++;
      continue;
    }

    /*
     * Defensive cleanup:
     *
     * If an older seed created a variant for this product but
     * didn't mark it as default, reuse it when possible.
     */
    const existingVariant =
      await prisma.productVariant.findFirst({
        where: {
          productId: product.id,
          combinationKey: 'DEFAULT',
        },
      });

    if (existingVariant) {
      await prisma.productVariant.update({
        where: {
          id: existingVariant.id,
        },
        data: {
          price: product.basePrice,
          isActive: true,
          isDefault: true,
        },
      });

      updatedCount++;
      continue;
    }

    const sku =
      `SKU-${product.slug
        .replace(/-/g, '')
        .toUpperCase()}-DEFAULT`;

    await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku,
        price: product.basePrice,
        isActive: true,
        isDefault: true,
        combinationKey: 'DEFAULT',
      },
    });

    createdCount++;
  }

  /*
   * Safety check:
   *
   * Every ACTIVE product must have at least one active variant.
   */
  const activeProducts = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
    },
  });

  for (const product of activeProducts) {
    const activeVariantCount =
      await prisma.productVariant.count({
        where: {
          productId: product.id,
          isActive: true,
        },
      });

    if (activeVariantCount === 0) {
      throw new Error(
        `Active product "${product.name}" (${product.id}) has no active variant.`,
      );
    }
  }

  console.log(
    `   ✓ ${createdCount} default variants created`,
  );

  console.log(
    `   ✓ ${updatedCount} default variants updated`,
  );
}