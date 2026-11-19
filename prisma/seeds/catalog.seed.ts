import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { createHash } from 'node:crypto';

export function developmentId(name: string) {
  const hex = createHash('sha256')
    .update(`commerce-development-v81:${name}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface CatalogCategoryDef {
  slug: string;
  name: string;
  imageUrl: string;
  products: Array<{
    slug: string;
    name: string;
    price: string;
    imageUrl: string;
  }>;
}

export interface TenantCatalogDef {
  slug: string;
  categories: CatalogCategoryDef[];
}

export const catalogDefinitions: TenantCatalogDef[] = [
  // 1. LUMA — Women's Fashion (6 Categories, 24 Products)
  {
    slug: 'dev81-kuwait-fashion',
    categories: [
      {
        slug: 'dresses',
        name: 'Evening Dresses',
        imageUrl: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'emerald-satin-dress', name: 'Emerald Satin Dress', price: '45.000', imageUrl: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800&h=800&fit=crop&q=80' },
          { slug: 'silk-evening-gown', name: 'Silk Evening Gown', price: '65.000', imageUrl: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=800&h=800&fit=crop&q=80' },
          { slug: 'velvet-wrap-dress', name: 'Velvet Wrap Dress', price: '38.500', imageUrl: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=800&h=800&fit=crop&q=80' },
          { slug: 'floral-chiffon-maxi', name: 'Floral Chiffon Maxi', price: '29.000', imageUrl: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'handbags',
        name: 'Luxury Handbags',
        imageUrl: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'leather-tote-bag', name: 'Leather Tote Bag', price: '52.000', imageUrl: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=800&h=800&fit=crop&q=80' },
          { slug: 'quilted-crossbody', name: 'Quilted Crossbody Bag', price: '42.000', imageUrl: 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=800&h=800&fit=crop&q=80' },
          { slug: 'clutch-pouch', name: 'Evening Clutch Pouch', price: '25.000', imageUrl: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&h=800&fit=crop&q=80' },
          { slug: 'designer-satchel', name: 'Designer Leather Satchel', price: '68.000', imageUrl: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'heels',
        name: 'Footwear & Heels',
        imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'stiletto-pumps', name: 'Stiletto High Heels', price: '34.000', imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800&h=800&fit=crop&q=80' },
          { slug: 'ankle-strap-sandals', name: 'Ankle Strap Sandals', price: '28.000', imageUrl: 'https://images.unsplash.com/photo-1535043934128-cf0b28d52f95?w=800&h=800&fit=crop&q=80' },
          { slug: 'leather-mules', name: 'Pointed Leather Mules', price: '32.500', imageUrl: 'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=800&h=800&fit=crop&q=80' },
          { slug: 'heeled-ankle-boots', name: 'Leather Ankle Boots', price: '48.000', imageUrl: 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'scarves',
        name: 'Silk Scarves',
        imageUrl: 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'printed-silk-scarf', name: 'Printed Pure Silk Scarf', price: '18.000', imageUrl: 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=800&h=800&fit=crop&q=80' },
          { slug: 'cashmere-wrap-scarf', name: 'Cashmere Blend Wrap', price: '24.000', imageUrl: 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=800&h=800&fit=crop&q=80' },
          { slug: 'satin-head-scarf', name: 'Monogram Satin Scarf', price: '15.500', imageUrl: 'https://images.unsplash.com/photo-1584030373081-f37b7bb4fa8e?w=800&h=800&fit=crop&q=80' },
          { slug: 'wool-patterned-shawl', name: 'Patterned Wool Shawl', price: '22.000', imageUrl: 'https://images.unsplash.com/photo-1584030373081-f37b7bb4fa8e?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'jewelry',
        name: 'Fine Jewelry',
        imageUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'gold-chain-necklace', name: 'Gold Layered Necklace', price: '40.000', imageUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800&h=800&fit=crop&q=80' },
          { slug: 'pearl-drop-earrings', name: 'Pearl Drop Earrings', price: '26.000', imageUrl: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800&h=800&fit=crop&q=80' },
          { slug: 'diamond-accent-ring', name: 'Diamond Accent Ring', price: '75.000', imageUrl: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800&h=800&fit=crop&q=80' },
          { slug: 'cuff-bracelet-gold', name: 'Minimalist Gold Cuff', price: '31.000', imageUrl: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'sunglasses',
        name: 'Designer Sunglasses',
        imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'cat-eye-sunglasses', name: 'Vintage Cat-Eye Shades', price: '22.000', imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&h=800&fit=crop&q=80' },
          { slug: 'oversized-black-frames', name: 'Oversized Black Sunglasses', price: '27.500', imageUrl: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=800&h=800&fit=crop&q=80' },
          { slug: 'aviator-gold-shades', name: 'Classic Gold Aviators', price: '25.000', imageUrl: 'https://images.unsplash.com/photo-1508296695146-257a814070b4?w=800&h=800&fit=crop&q=80' },
          { slug: 'square-tortoise-sunglasses', name: 'Square Tortoise Frames', price: '21.000', imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&h=800&fit=crop&q=80' },
        ],
      },
    ],
  },

  // 2. NOURA — Gifts & Lifestyle (5 Categories, 20 Products)
  {
    slug: 'dev81-independent',
    categories: [
      {
        slug: 'candles',
        name: 'Scented Candles',
        imageUrl: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'amber-vanilla-candle', name: 'Amber & Vanilla Soy Candle', price: '120.00', imageUrl: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&h=800&fit=crop&q=80' },
          { slug: 'lavender-field-candle', name: 'Lavender Aromatherapy Candle', price: '110.00', imageUrl: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=800&h=800&fit=crop&q=80' },
          { slug: 'fig-cedar-candle', name: 'Wild Fig & Cedarwood Candle', price: '135.00', imageUrl: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&h=800&fit=crop&q=80' },
          { slug: 'rose-oud-candle', name: 'Damask Rose & Oud Candle', price: '150.00', imageUrl: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'gift-sets',
        name: 'Gift Sets',
        imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'deluxe-pamper-box', name: 'Deluxe Pamper Gift Box', price: '280.00', imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&h=800&fit=crop&q=80' },
          { slug: 'tea-tasting-set', name: 'Artisan Tea Tasting Set', price: '195.00', imageUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=800&h=800&fit=crop&q=80' },
          { slug: 'home-fragrance-kit', name: 'Home Diffuser & Reed Set', price: '210.00', imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&h=800&fit=crop&q=80' },
          { slug: 'gourmet-chocolate-hamper', name: 'Artisan Chocolate Hamper', price: '240.00', imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'journals',
        name: 'Leather Journals',
        imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'embossed-leather-notebook', name: 'Embossed Leather Journal', price: '140.00', imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&h=800&fit=crop&q=80' },
          { slug: 'linen-bound-planner', name: 'Undated Linen Planner', price: '95.00', imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&h=800&fit=crop&q=80' },
          { slug: 'brass-pen-set', name: 'Solid Brass Rollerball Pen', price: '115.00', imageUrl: 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&h=800&fit=crop&q=80' },
          { slug: 'calligraphy-sketchbook', name: 'Cotton Paper Sketchbook', price: '85.00', imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'pottery',
        name: 'Artisan Pottery',
        imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'ceramic-coffee-mug', name: 'Handcrafted Ceramic Mug', price: '75.00', imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=800&fit=crop&q=80' },
          { slug: 'speckled-clay-bowl', name: 'Speckled Clay Serving Bowl', price: '160.00', imageUrl: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=800&h=800&fit=crop&q=80' },
          { slug: 'terracotta-flower-pot', name: 'Glazed Terracotta Planter', price: '110.00', imageUrl: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=800&h=800&fit=crop&q=80' },
          { slug: 'hand-painted-plate', name: 'Hand-Painted Wall Plate', price: '130.00', imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'gourmet',
        name: 'Gourmet Coffee',
        imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'arabica-specialty-beans', name: 'Specialty Arabica Beans', price: '85.00', imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&h=800&fit=crop&q=80' },
          { slug: 'organic-matcha-powder', name: 'Ceremonial Grade Matcha', price: '165.00', imageUrl: 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=800&h=800&fit=crop&q=80' },
          { slug: 'chai-spice-blend', name: 'Organic Chai Tea Blend', price: '65.00', imageUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=800&h=800&fit=crop&q=80' },
          { slug: 'cold-brew-concentrate', name: 'Cold Brew Coffee Concentrate', price: '70.00', imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&h=800&fit=crop&q=80' },
        ],
      },
    ],
  },

  // 3. TOOTA — Kids & Toys (6 Categories, 24 Products)
  {
    slug: 'toota-kids',
    categories: [
      {
        slug: 'plush',
        name: 'Plush Toys',
        imageUrl: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'giant-teddy-bear', name: 'Soft Giant Teddy Bear', price: '350.00', imageUrl: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&h=800&fit=crop&q=80' },
          { slug: 'bunny-plush-toy', name: 'Cute Velvet Bunny Plush', price: '180.00', imageUrl: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&h=800&fit=crop&q=80' },
          { slug: 'dinosaur-stuffed-animal', name: 'Soft Dinosaur Plush', price: '220.00', imageUrl: 'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&h=800&fit=crop&q=80' },
          { slug: 'unicorn-cuddle-toy', name: 'Magical Unicorn Plush', price: '240.00', imageUrl: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'wooden-toys',
        name: 'Wooden Toys',
        imageUrl: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'wooden-rainbow-stacker', name: 'Wooden Rainbow Stacker', price: '290.00', imageUrl: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&h=800&fit=crop&q=80' },
          { slug: 'wooden-train-set', name: 'Classic Wooden Train Set', price: '450.00', imageUrl: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&h=800&fit=crop&q=80' },
          { slug: 'shape-sorter-cube', name: 'Wooden Shape Sorter Cube', price: '210.00', imageUrl: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&h=800&fit=crop&q=80' },
          { slug: 'wooden-abacus-toy', name: 'Colorful Wooden Abacus', price: '190.00', imageUrl: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'building-blocks',
        name: 'Building Blocks',
        imageUrl: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'colorful-brick-set', name: 'Creative Brick Set (500pcs)', price: '380.00', imageUrl: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&h=800&fit=crop&q=80' },
          { slug: 'magnetic-tiles-set', name: 'Magnetic Building Tiles', price: '520.00', imageUrl: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&h=800&fit=crop&q=80' },
          { slug: 'foam-block-castle', name: 'Soft Foam Building Blocks', price: '310.00', imageUrl: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&h=800&fit=crop&q=80' },
          { slug: 'marble-run-set', name: 'Interactive Marble Run', price: '420.00', imageUrl: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'baby-clothing',
        name: 'Baby Clothes',
        imageUrl: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'organic-cotton-onesie', name: 'Organic Cotton Onesie Set', price: '260.00', imageUrl: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&h=800&fit=crop&q=80' },
          { slug: 'toddler-denim-overall', name: 'Toddler Denim Overalls', price: '320.00', imageUrl: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=800&h=800&fit=crop&q=80' },
          { slug: 'knit-baby-cardigan', name: 'Cozy Knit Baby Cardigan', price: '280.00', imageUrl: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&h=800&fit=crop&q=80' },
          { slug: 'baby-beanie-socks-set', name: 'Baby Beanie & Socks Pack', price: '140.00', imageUrl: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'activity-books',
        name: 'Activity Books',
        imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'coloring-doodle-book', name: 'Giant Coloring & Doodle Book', price: '110.00', imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&h=800&fit=crop&q=80' },
          { slug: 'sticker-story-book', name: 'Interactive Sticker Book', price: '95.00', imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&h=800&fit=crop&q=80' },
          { slug: 'washable-marker-set', name: 'Washable Markers (24 Pack)', price: '130.00', imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&h=800&fit=crop&q=80' },
          { slug: 'finger-paint-kit', name: 'Non-Toxic Finger Paint Kit', price: '160.00', imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'strollers',
        name: 'Strollers & Gear',
        imageUrl: 'https://images.unsplash.com/photo-1591085686350-798c0f9faa7f?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'compact-travel-stroller', name: 'Compact Fold Travel Stroller', price: '1850.00', imageUrl: 'https://images.unsplash.com/photo-1591085686350-798c0f9faa7f?w=800&h=800&fit=crop&q=80' },
          { slug: 'ergonomic-baby-carrier', name: 'Ergonomic 3-in-1 Baby Carrier', price: '680.00', imageUrl: 'https://images.unsplash.com/photo-1591085686350-798c0f9faa7f?w=800&h=800&fit=crop&q=80' },
          { slug: 'diaper-backpack-bag', name: 'Multifunction Diaper Backpack', price: '340.00', imageUrl: 'https://images.unsplash.com/photo-1591085686350-798c0f9faa7f?w=800&h=800&fit=crop&q=80' },
          { slug: 'portable-baby-crib', name: 'Portable Folding Travel Crib', price: '920.00', imageUrl: 'https://images.unsplash.com/photo-1591085686350-798c0f9faa7f?w=800&h=800&fit=crop&q=80' },
        ],
      },
    ],
  },

  // 4. DAR — Home & Decor (6 Categories, 24 Products)
  {
    slug: 'dar-home',
    categories: [
      {
        slug: 'furniture',
        name: 'Modern Furniture',
        imageUrl: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'nordic-lounge-chair', name: 'Nordic Accent Armchair', price: '850.00', imageUrl: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&h=800&fit=crop&q=80' },
          { slug: 'oak-wood-coffee-table', name: 'Minimalist Oak Coffee Table', price: '620.00', imageUrl: 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=800&h=800&fit=crop&q=80' },
          { slug: 'velvet-2-seater-sofa', name: 'Emerald Velvet 2-Seater Sofa', price: '1950.00', imageUrl: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&h=800&fit=crop&q=80' },
          { slug: 'floating-wall-shelf-set', name: 'Walnut Floating Wall Shelves', price: '290.00', imageUrl: 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'vases',
        name: 'Decorative Vases',
        imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'ceramic-flower-vase', name: 'Matte White Ceramic Vase', price: '180.00', imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=800&fit=crop&q=80' },
          { slug: 'ribbed-glass-vase', name: 'Amber Ribbed Glass Vase', price: '140.00', imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=800&fit=crop&q=80' },
          { slug: 'sculptural-clay-urn', name: 'Sculptural Terracotta Urn', price: '260.00', imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=800&fit=crop&q=80' },
          { slug: 'fluted-gold-planter', name: 'Fluted Brass Plant Pot', price: '210.00', imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'lighting',
        name: 'Table & Floor Lamps',
        imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'brass-table-lamp', name: 'Modern Brass Desk Lamp', price: '340.00', imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&h=800&fit=crop&q=80' },
          { slug: 'arched-floor-lamp', name: 'Arched Chrome Floor Lamp', price: '580.00', imageUrl: 'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=800&h=800&fit=crop&q=80' },
          { slug: 'paper-pendant-light', name: 'Woven Rattan Pendant Light', price: '310.00', imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&h=800&fit=crop&q=80' },
          { slug: 'ceramic-bedside-lamp', name: 'Textured Ceramic Bedside Lamp', price: '260.00', imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'textiles',
        name: 'Pillows & Blankets',
        imageUrl: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'knitted-throw-blanket', name: 'Chunky Knit Throw Blanket', price: '240.00', imageUrl: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&h=800&fit=crop&q=80' },
          { slug: 'velvet-accent-pillow', name: 'Velvet Cushion Cover (Set of 2)', price: '150.00', imageUrl: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&h=800&fit=crop&q=80' },
          { slug: 'linen-duvet-cover', name: 'Washed Linen Duvet Cover Set', price: '480.00', imageUrl: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&h=800&fit=crop&q=80' },
          { slug: 'boho-fringe-runner-rug', name: 'Hand-Woven Boho Area Rug', price: '720.00', imageUrl: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'wall-art',
        name: 'Wall Art & Mirrors',
        imageUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'framed-canvas-abstract', name: 'Abstract Framed Canvas Art', price: '390.00', imageUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&h=800&fit=crop&q=80' },
          { slug: 'round-gold-wall-mirror', name: 'Round Brass Wall Mirror', price: '320.00', imageUrl: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&h=800&fit=crop&q=80' },
          { slug: 'botanical-print-trio', name: 'Botanical Print Set (3 Frames)', price: '270.00', imageUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&h=800&fit=crop&q=80' },
          { slug: 'macrame-wall-hanging', name: 'Woven Macrame Wall Hanging', price: '190.00', imageUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'dining',
        name: 'Kitchen & Dining',
        imageUrl: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'marble-serving-tray', name: 'White Marble Serving Tray', price: '210.00', imageUrl: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=800&h=800&fit=crop&q=80' },
          { slug: 'crystal-wine-decanter', name: 'Hand-Cut Crystal Decanter', price: '280.00', imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&h=800&fit=crop&q=80' },
          { slug: 'matte-black-cutlery-set', name: 'Matte Black Flatware (16-Piece)', price: '240.00', imageUrl: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=800&h=800&fit=crop&q=80' },
          { slug: 'ceramic-dinnerware-set', name: 'Stoneware Dinnerware (12-Piece)', price: '540.00', imageUrl: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=800&h=800&fit=crop&q=80' },
        ],
      },
    ],
  },

  // 5. VELO — Sportswear (5 Categories, 20 Products)
  {
    slug: 'velo-sports',
    categories: [
      {
        slug: 'running-shoes',
        name: 'Running Shoes',
        imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'ultra-light-runners', name: 'Ultra-Light Pro Runners', price: '42.000', imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&h=800&fit=crop&q=80' },
          { slug: 'cushioned-trail-sneakers', name: 'Cushioned Trail Trainers', price: '48.500', imageUrl: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800&h=800&fit=crop&q=80' },
          { slug: 'breathable-marathon-shoes', name: 'Breathable Marathon Shoes', price: '55.000', imageUrl: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=800&h=800&fit=crop&q=80' },
          { slug: 'speed-sprint-spikes', name: 'Speed Athletic Sprint Trainers', price: '39.000', imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'fitness-apparel',
        name: 'Fitness Apparel',
        imageUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'dry-fit-workout-top', name: 'Dry-Fit Performance Tee', price: '14.500', imageUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&h=800&fit=crop&q=80' },
          { slug: 'high-waist-leggings', name: 'High-Waist Seamless Leggings', price: '22.000', imageUrl: 'https://images.unsplash.com/photo-1506152983158-b4a74a01c721?w=800&h=800&fit=crop&q=80' },
          { slug: 'zip-up-hoodie-sports', name: 'Athletic Zip-Up Hoodie', price: '28.000', imageUrl: 'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=800&h=800&fit=crop&q=80' },
          { slug: 'padded-sports-bra', name: 'High-Impact Sports Bra', price: '16.000', imageUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'gym-bags',
        name: 'Gym Bags & Packs',
        imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'waterproof-duffle-bag', name: 'Waterproof Gym Duffle Bag', price: '26.000', imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&h=800&fit=crop&q=80' },
          { slug: 'sports-backpack-shoe-pocket', name: 'Sports Backpack w/ Shoe Pocket', price: '31.000', imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&h=800&fit=crop&q=80' },
          { slug: 'running-hydration-belt', name: 'Hydration Running Waist Pack', price: '12.000', imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&h=800&fit=crop&q=80' },
          { slug: 'drawstring-sackpack', name: 'Lightweight Drawstring Bag', price: '8.500', imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'trackers',
        name: 'Fitness Trackers',
        imageUrl: 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'smart-activity-watch', name: 'Smart Heart Rate Watch', price: '45.000', imageUrl: 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=800&h=800&fit=crop&q=80' },
          { slug: 'gps-running-watch', name: 'GPS Multisport Fitness Watch', price: '85.000', imageUrl: 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&h=800&fit=crop&q=80' },
          { slug: 'wireless-sport-earbuds', name: 'Sweatproof Wireless Earbuds', price: '32.000', imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&h=800&fit=crop&q=80' },
          { slug: 'chest-strap-heart-monitor', name: 'Bluetooth Heart Rate Monitor', price: '21.000', imageUrl: 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'yoga-gear',
        name: 'Yoga & Training',
        imageUrl: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'non-slip-yoga-mat', name: 'Non-Slip Eco Yoga Mat (6mm)', price: '18.500', imageUrl: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&h=800&fit=crop&q=80' },
          { slug: 'resistance-bands-set', name: 'Loop Resistance Bands (5 Pack)', price: '9.500', imageUrl: 'https://images.unsplash.com/photo-1598289431512-b97b0917affc?w=800&h=800&fit=crop&q=80' },
          { slug: 'foam-roller-recovery', name: 'Deep Tissue Foam Roller', price: '11.000', imageUrl: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&h=800&fit=crop&q=80' },
          { slug: 'cork-yoga-blocks', name: 'Natural Cork Yoga Blocks (Pair)', price: '14.000', imageUrl: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&h=800&fit=crop&q=80' },
        ],
      },
    ],
  },

  // 6. SERA — Skincare & Beauty (5 Categories, 20 Products)
  {
    slug: 'sera-beauty',
    categories: [
      {
        slug: 'serums',
        name: 'Facial Serums & Oils',
        imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'vitamin-c-glow-serum', name: 'Vitamin C Brightening Serum', price: '180.00', imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&h=800&fit=crop&q=80' },
          { slug: 'hyaluronic-acid-booster', name: 'Hyaluronic Hydrating Drops', price: '165.00', imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&h=800&fit=crop&q=80' },
          { slug: 'retinol-night-repair', name: 'Night Repair Retinol Elixir', price: '210.00', imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&h=800&fit=crop&q=80' },
          { slug: 'rosehip-face-oil', name: 'Organic Rosehip Facial Oil', price: '145.00', imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'creams',
        name: 'Hydrating Creams',
        imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'ceramide-moisturizer', name: 'Deep Moisture Ceramide Cream', price: '155.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
          { slug: 'soothing-aloe-gel', name: 'Soothing Aloe Vera Water Cream', price: '95.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
          { slug: 'peptide-eye-cream', name: 'Peptide Revitalizing Eye Cream', price: '170.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
          { slug: 'spf50-daily-sunscreen', name: 'Invisible Shield SPF50 Lotion', price: '130.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'cleansers',
        name: 'Cleansers & Toners',
        imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'botanical-cleansing-foam', name: 'Botanical Foaming Cleanser', price: '110.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
          { slug: 'rosewater-hydrating-toner', name: 'Rosewater Mist & Toner', price: '85.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
          { slug: 'micellar-makeup-remover', name: 'Gentle Micellar Water', price: '75.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
          { slug: 'salicylic-acid-cleanser', name: 'Clarifying Salicylic Cleanser', price: '125.00', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'makeup',
        name: 'Lipsticks & Cosmetics',
        imageUrl: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'matte-velvet-lipstick', name: 'Velvet Matte Lipstick', price: '120.00', imageUrl: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=800&h=800&fit=crop&q=80' },
          { slug: 'hydrating-lip-tint', name: 'Nourishing Sheer Lip Tint', price: '90.00', imageUrl: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=800&h=800&fit=crop&q=80' },
          { slug: 'liquid-blush-rose', name: 'Soft Glow Liquid Blush', price: '115.00', imageUrl: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=800&h=800&fit=crop&q=80' },
          { slug: 'volumizing-mascara', name: 'Lash Sculpt Volumizing Mascara', price: '105.00', imageUrl: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=800&h=800&fit=crop&q=80' },
        ],
      },
      {
        slug: 'hair-care',
        name: 'Organic Hair Care',
        imageUrl: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=800&h=600&fit=crop&q=80',
        products: [
          { slug: 'argan-nourishing-hair-oil', name: 'Moroccan Argan Hair Oil', price: '160.00', imageUrl: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=800&h=800&fit=crop&q=80' },
          { slug: 'sulfate-free-shampoo', name: 'Repairing Sulfate-Free Shampoo', price: '115.00', imageUrl: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=800&h=800&fit=crop&q=80' },
          { slug: 'keratin-deep-conditioner', name: 'Keratin Deep Treatment Mask', price: '140.00', imageUrl: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=800&h=800&fit=crop&q=80' },
          { slug: 'scalp-revitalizing-serum', name: 'Scalp Revitalizing Tonic', price: '150.00', imageUrl: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=800&h=800&fit=crop&q=80' },
        ],
      },
    ],
  },
];

export async function seedCatalog(prisma: PrismaClient | Prisma.TransactionClient) {
  console.log('📦 Seeding expanded demo categories & products across 6 stores...');

  for (const tenantDef of catalogDefinitions) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantDef.slug },
    });

    if (!tenant) {
      console.warn(`   ⚠️ Tenant ${tenantDef.slug} not found. Skipping catalog seed for this store.`);
      continue;
    }

    const tenantId = tenant.id;

    // Get primary warehouse
    const warehouse = await prisma.warehouse.findFirst({
      where: { tenantId },
    });
    const warehouseId = warehouse?.id ?? developmentId(`warehouse:${tenantDef.slug}`);

    if (!warehouse) {
      await prisma.warehouse.upsert({
        where: { id: warehouseId },
        update: {},
        create: {
          id: warehouseId,
          tenantId,
          code: 'PRIMARY',
          name: 'Primary Warehouse',
          countryCode: tenant.defaultCountryCode ?? 'KW',
          city: 'Primary City',
          address: 'Main Industrial Zone',
        },
      });
    }

    // Get primary brand
    let brand = await prisma.brand.findFirst({
      where: { tenantId },
    });
    if (!brand) {
      brand = await prisma.brand.create({
        data: {
          id: developmentId(`brand:${tenantDef.slug}`),
          tenantId,
          name: `${tenant.name} Official`,
          slug: `${tenant.slug}-official`,
        },
      });
    }

    for (const catDef of tenantDef.categories) {
      const categoryId = developmentId(`category:${tenantDef.slug}:${catDef.slug}`);
      const category = await prisma.category.upsert({
        where: { id: categoryId },
        update: {
          name: catDef.name,
          imageUrl: catDef.imageUrl,
        },
        create: {
          id: categoryId,
          tenantId,
          name: catDef.name,
          slug: catDef.slug,
          imageUrl: catDef.imageUrl,
        },
      });

      for (const prodDef of catDef.products) {
        const productId = developmentId(`product:${tenantDef.slug}:${prodDef.slug}`);
        const product = await prisma.product.upsert({
          where: { id: productId },
          update: {
            name: prodDef.name,
            basePrice: prodDef.price,
            categoryId: category.id,
            brandId: brand.id,
          },
          create: {
            id: productId,
            tenantId,
            categoryId: category.id,
            brandId: brand.id,
            name: prodDef.name,
            slug: prodDef.slug,
            basePrice: prodDef.price,
            status: 'ACTIVE',
          },
        });

        // Seed Primary Product Image
        const imageId = developmentId(`product-image:${tenantDef.slug}:${prodDef.slug}`);
        await prisma.productImage.upsert({
          where: { id: imageId },
          update: {
            url: prodDef.imageUrl,
          },
          create: {
            id: imageId,
            productId: product.id,
            storageKey: `seed-catalog/${prodDef.slug}`,
            url: prodDef.imageUrl,
            isPrimary: true,
            sortOrder: 0,
          },
        });

        // Seed Default Variant
        const variantId = developmentId(`variant:${tenantDef.slug}:${prodDef.slug}`);
        await prisma.productVariant.upsert({
          where: { id: variantId },
          update: {
            price: prodDef.price,
          },
          create: {
            id: variantId,
            productId: product.id,
            sku: `SKU-${tenantDef.slug.toUpperCase()}-${prodDef.slug.toUpperCase()}`,
            combinationKey: 'DEFAULT',
            price: prodDef.price,
            isDefault: true,
          },
        });

        // Seed Inventory
        await prisma.inventory.upsert({
          where: {
            warehouseId_variantId: {
              variantId,
              warehouseId,
            },
          },
          update: {
            quantity: 100,
          },
          create: {
            tenantId,
            warehouseId,
            variantId,
            quantity: 100,
            reservedQuantity: 0,
          },
        });
      }
    }
  }

  console.log('   ✓ Catalog seeded successfully with categories, products, images, and inventory');
}
