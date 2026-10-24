import type { HomePlatform } from './home.constants.js';

export type HomeSectionType =
  | 'BEST_SELLERS'
  | 'SPECIAL_OFFERS'
  | 'NEW_ARRIVALS'
  | 'FEATURED_PRODUCTS';

export type HomeDisplayType =
  | 'HORIZONTAL_PRODUCTS'
  | 'GRID_PRODUCTS';

export interface HomeCategory {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
}

export interface HomeBrand {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
}

export interface HomeBanner {
  id: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  targetType: string;
  targetId: string | null;
  actionUrl: string | null;
}

export interface HomeProduct {
  id: string;
  name: string;
  slug: string;

  price: {
    original: string;
    final: string;
    discountPercentage: number | null;
  };

  image: string | null;
}

export interface HomeSection {
  type: HomeSectionType;
  title: string;
  displayType: HomeDisplayType;
  products: HomeProduct[];

  seeAll: {
    enabled: boolean;
    targetType: 'PRODUCT_LIST' | 'COLLECTION';
    target: string;
  };
}

export interface HomeResponse {
  platform: HomePlatform;
  banners: HomeBanner[];
  categories: HomeCategory[];
  sections: HomeSection[];
  brands: HomeBrand[];
}