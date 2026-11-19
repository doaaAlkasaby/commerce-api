export interface BannerDef {
  tenantSlug: string;
  index: number;
  title: string;
  subtitle: string;
  url: string;
  targetType: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'COLLECTION' | 'EXTERNAL_URL';
  targetCategorySlug?: string;
}

export const bannerDefinitions: BannerDef[] = [
  // Luma (Fashion)
  { tenantSlug: 'dev81-kuwait-fashion', index: 1, title: 'New Season Collection', subtitle: 'Elevate your wardrobe with silk & satin', url: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'dresses' },
  { tenantSlug: 'dev81-kuwait-fashion', index: 2, title: 'Luxury Handbags Edit', subtitle: 'Statement totes and crossbody bags', url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'handbags' },
  { tenantSlug: 'dev81-kuwait-fashion', index: 3, title: 'Eveningwear Essentials', subtitle: 'Glamorous gowns & heels for special occasions', url: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'heels' },
  { tenantSlug: 'dev81-kuwait-fashion', index: 4, title: 'Summer Accessories', subtitle: 'Designer sunglasses & silk scarves', url: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'sunglasses' },

  // Noura (Gifts & Lifestyle)
  { tenantSlug: 'dev81-independent', index: 1, title: 'Curated Gift Boxes', subtitle: 'Beautifully wrapped presents for every moment', url: 'https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'gift-sets' },
  { tenantSlug: 'dev81-independent', index: 2, title: 'Aromatherapy Candles', subtitle: 'Hand-poured soy wax & cedarwood', url: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'candles' },
  { tenantSlug: 'dev81-independent', index: 3, title: 'Artisan Ceramics', subtitle: 'Handcrafted mugs, vases & clay pottery', url: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'pottery' },
  { tenantSlug: 'dev81-independent', index: 4, title: 'Specialty Coffee & Teas', subtitle: 'Arabica beans & organic matcha', url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'gourmet' },

  // Toota (Kids & Toys)
  { tenantSlug: 'toota-kids', index: 1, title: 'Plush & Cuddle Friends', subtitle: 'Soft giant teddy bears & plush bunnies', url: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'plush' },
  { tenantSlug: 'toota-kids', index: 2, title: 'Wooden Educational Toys', subtitle: 'Rainbow stackers, train sets & abacus', url: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'wooden-toys' },
  { tenantSlug: 'toota-kids', index: 3, title: 'Creative Play & Bricks', subtitle: 'Building blocks & magnetic tiles', url: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'building-blocks' },
  { tenantSlug: 'toota-kids', index: 4, title: 'Organic Baby Wear', subtitle: 'Soft cotton onesies, overalls & cardigans', url: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'baby-clothing' },

  // Dar (Home & Decor)
  { tenantSlug: 'dar-home', index: 1, title: 'Modern Living Spaces', subtitle: 'Nordic armchairs, sofas & oak tables', url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'furniture' },
  { tenantSlug: 'dar-home', index: 2, title: 'Atmospheric Lighting', subtitle: 'Brass table lamps & arched floor lights', url: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'lighting' },
  { tenantSlug: 'dar-home', index: 3, title: 'Artisan Vases & Pots', subtitle: 'Ceramic urns, glass vases & planters', url: 'https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'vases' },
  { tenantSlug: 'dar-home', index: 4, title: 'Cozy Textiles & Rugs', subtitle: 'Knitted throw blankets & velvet cushions', url: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'textiles' },

  // Velo (Sportswear)
  { tenantSlug: 'velo-sports', index: 1, title: 'Pro Running Gear', subtitle: 'Ultra-light marathon runners & cushioned trainers', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'running-shoes' },
  { tenantSlug: 'velo-sports', index: 2, title: 'High-Performance Activewear', subtitle: 'Dry-fit tops & seamless leggings', url: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'fitness-apparel' },
  { tenantSlug: 'velo-sports', index: 3, title: 'Smart Fitness Tech', subtitle: 'Activity watches & wireless sport earbuds', url: 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'trackers' },
  { tenantSlug: 'velo-sports', index: 4, title: 'Yoga & Recovery', subtitle: 'Non-slip eco mats, blocks & foam rollers', url: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'yoga-gear' },

  // Sera (Beauty & Skincare)
  { tenantSlug: 'sera-beauty', index: 1, title: 'Radiant Vitamin C Serums', subtitle: 'Glow drops & hyaluronic acid boosters', url: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'serums' },
  { tenantSlug: 'sera-beauty', index: 2, title: 'Hydrating Moisture Creams', subtitle: 'Deep ceramides & soothing aloe gels', url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'creams' },
  { tenantSlug: 'sera-beauty', index: 3, title: 'Botanical Cleansers', subtitle: 'Foaming face washes & rosewater toners', url: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'cleansers' },
  { tenantSlug: 'sera-beauty', index: 4, title: 'Velvet Matte Lipsticks', subtitle: 'Rich tints & sculpting liquid blush', url: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=1200&h=600&fit=crop&q=80', targetType: 'CATEGORY', targetCategorySlug: 'makeup' },
];
