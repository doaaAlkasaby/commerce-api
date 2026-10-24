export const HOME_LIMITS = {
  mobile: {
    banners: 5,
    categories: 8,
    bestSellers: 10,
    specialOffers: 10,
    newArrivals: 10,
    featuredProducts: 10,
    brands: 8,
  },

  web: {
    banners: 5,
    categories: 12,
    bestSellers: 20,
    specialOffers: 20,
    newArrivals: 20,
    featuredProducts: 20,
    brands: 12,
  },
} as const;

export type HomePlatform =
  keyof typeof HOME_LIMITS;