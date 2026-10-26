
 import {slugify, unsplash} from '../seed.js';
import {
  PrismaClient,
  type Brand,
  type Category,
} from '../../src/generated/prisma/client.js';




/** Category slug -> Unsplash photo id (shown on the home screen) */
const CATEGORY_PHOTO_IDS: Record<string, string> = {
  women: '1483985988355-763728e1935b',
  men: '1596755094514-f87e34085b2c',
  shoes: '1542291026-7eec264c27ff',
  bags: '1584917865442-de89df76afd3',
  accessories: '1523275335684-37898b6baf30',
  beauty: '1596462502278-27bfdc403348',
  sports: '1517836357463-d25dfeac3438',
  electronics: '1498049794561-7780e7231661',
};


/** Fallback if a slug is missing from the map above */
const FALLBACK_PHOTO_ID = '1523381210434-271e8be1f52b';


// ============================================================
// Categories
// ============================================================

export  async function seedCategories(prisma: PrismaClient,) {
  console.log('📂 Seeding categories...');

  // ------------------------------------------------------------
  // Parent categories
  // ------------------------------------------------------------

  const parentCategoryData = [
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

  // ------------------------------------------------------------
  // Create parent categories
  // ------------------------------------------------------------

  const parentCategories = new Map<string, Category>();

  for (const data of parentCategoryData) {
    const slug = slugify(data.name);

    const category = await prisma.category.upsert({
      where: {
        slug,
      },
      update: {
        name: data.name,
        description: data.description,
        imageStorageKey: `seed/categories/${slug}.jpg`,
        imageUrl: unsplash(
          CATEGORY_PHOTO_IDS[slug] ?? FALLBACK_PHOTO_ID,
          600,
          600,
        ),
        isActive: true,
        parentId: null,
      },
      create: {
        name: data.name,
        slug,
        description: data.description,
        imageStorageKey: `seed/categories/${slug}.jpg`,
        imageUrl: unsplash(
          CATEGORY_PHOTO_IDS[slug] ?? FALLBACK_PHOTO_ID,
          600,
          600,
        ),
        isActive: true,
        parentId: null,
      },
    });

    categories.push(category);
    parentCategories.set(category.name, category);
  }

  // ------------------------------------------------------------
  // Child categories
  // ------------------------------------------------------------

  const childCategoryData = [
    // Women
    {
      name: 'Dresses',
      description: 'Women dresses',
      parent: 'Women',
    },
    {
      name: 'Tops',
      description: 'Women tops and shirts',
      parent: 'Women',
    },
    {
      name: 'Jeans',
      description: 'Women jeans and denim',
      parent: 'Women',
    },
    {
      name: 'Jackets',
      description: 'Women jackets and coats',
      parent: 'Women',
    },

    // Men
    {
      name: 'T-Shirts',
      description: 'Men t-shirts',
      parent: 'Men',
    },
    {
      name: 'Shirts',
      description: 'Men shirts',
      parent: 'Men',
    },
    {
      name: 'Pants',
      description: 'Men pants and trousers',
      parent: 'Men',
    },
    {
      name: 'Jackets',
      description: 'Men jackets and coats',
      parent: 'Men',
    },

    // Shoes
    {
      name: 'Sneakers',
      description: 'Casual and lifestyle sneakers',
      parent: 'Shoes',
    },
    {
      name: 'Running Shoes',
      description: 'Running and training shoes',
      parent: 'Shoes',
    },
    {
      name: 'Formal Shoes',
      description: 'Formal and dress shoes',
      parent: 'Shoes',
    },

    // Bags
    {
      name: 'Handbags',
      description: 'Women handbags',
      parent: 'Bags',
    },
    {
      name: 'Backpacks',
      description: 'Backpacks and travel bags',
      parent: 'Bags',
    },
    {
      name: 'Travel Bags',
      description: 'Travel bags and luggage',
      parent: 'Bags',
    },

    // Accessories
    {
      name: 'Watches',
      description: 'Watches and smart watches',
      parent: 'Accessories',
    },
    {
      name: 'Sunglasses',
      description: 'Sunglasses',
      parent: 'Accessories',
    },
    {
      name: 'Belts',
      description: 'Fashion belts',
      parent: 'Accessories',
    },

    // Beauty
    {
      name: 'Skincare',
      description: 'Skin care products',
      parent: 'Beauty',
    },
    {
      name: 'Makeup',
      description: 'Makeup products',
      parent: 'Beauty',
    },
    {
      name: 'Hair Care',
      description: 'Hair care products',
      parent: 'Beauty',
    },

    // Sports
    {
      name: 'Fitness',
      description: 'Fitness and gym products',
      parent: 'Sports',
    },
    {
      name: 'Running',
      description: 'Running products',
      parent: 'Sports',
    },
    {
      name: 'Outdoor',
      description: 'Outdoor sports products',
      parent: 'Sports',
    },

    // Electronics
    {
      name: 'Headphones',
      description: 'Headphones and earbuds',
      parent: 'Electronics',
    },
    {
      name: 'Smartphones',
      description: 'Smartphones and mobile devices',
      parent: 'Electronics',
    },
    {
      name: 'Smart Watches',
      description: 'Smart watches and wearable devices',
      parent: 'Electronics',
    },
  ];

  for (const data of childCategoryData) {
    const parentCategory = parentCategories.get(data.parent);

    if (!parentCategory) {
      throw new Error(
        `Parent category not found: ${data.parent}`,
      );
    }

    /*
     * Important:
     * The slug must be globally unique.
     *
     * For example:
     * Women / Jackets
     * Men / Jackets
     *
     * cannot both have slug "jackets".
     *
     * Therefore we include the parent in the slug.
     */
    const slug = slugify(
      `${data.parent}-${data.name}`,
    );

    const category = await prisma.category.upsert({
      where: {
        slug,
      },
      update: {
        name: data.name,
        description: data.description,
        imageStorageKey: `seed/categories/${slug}.jpg`,
        imageUrl: unsplash(
          FALLBACK_PHOTO_ID,
          600,
          600,
        ),
        isActive: true,
        parentId: parentCategory.id,
      },
      create: {
        name: data.name,
        slug,
        description: data.description,
        imageStorageKey: `seed/categories/${slug}.jpg`,
        imageUrl: unsplash(
          FALLBACK_PHOTO_ID,
          600,
          600,
        ),
        isActive: true,
        parentId: parentCategory.id,
      },
    });

    categories.push(category);
  }

  console.log(
    `   ✓ ${categories.length} categories created`,
  );

  return categories;
}

// ============================================================
// Brands
// ============================================================

export  async function seedBrands(prisma: PrismaClient,) {
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
