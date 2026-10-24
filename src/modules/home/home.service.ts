import type { HomePlatform } from './home.constants.js';
import { HOME_LIMITS } from './home.constants.js';
import type { HomeResponse, HomeSection } from './home.types.js';
import { homeRepository } from './home.repository.instance.js';
import { productRepository } from '../products/product.repository.instance.js';
import { productCollectionRepository } from '../product-collections/product-collection.repository.instance.js';
import {
  mapHomeBanner,
  mapHomeBrand,
  mapHomeCategory,
  mapHomeProduct,
} from './home.mapper.js';
import { productEnrichmentService } from '../products/product-enrichment.service.js';

export class HomeService {
  private async enrichProductPage<T extends { id: string }>(
    productPage: Promise<{ items: T[]; total: number }>,
    userId?: string,
  ) {
    const { items, total } = await productPage;

    return {
      items: await productEnrichmentService.enrichProducts(items, userId),
      total,
    };
  }

  async getHome(
    platform: HomePlatform,
    userId?: string,
  ): Promise<HomeResponse> {
    const limits = HOME_LIMITS[platform];

    // Find the public Featured collection first.
    const featuredCollection =
      await productCollectionRepository.findPublicBySlug('featured');

    const [
      banners,
      categories,
      bestSellers,
      specialOffers,
      newArrivals,
      featuredProducts,
      brands,
    ] = await Promise.all([
      homeRepository.findBanners(limits.banners),

      homeRepository.findCategories(limits.categories),

      this.enrichProductPage(
        productRepository.findBestSellers(0, limits.bestSellers),
        userId,
      ),

      this.enrichProductPage(
        productRepository.findOffers(0, limits.specialOffers),
        userId,
      ),

      this.enrichProductPage(
        productRepository.findNewArrivals(0, limits.newArrivals),
        userId,
      ),

      featuredCollection
        ? this.enrichProductPage(
            productRepository.findCollectionProducts(
              featuredCollection.id,
              0,
              limits.featuredProducts,
            ),
            userId,
          )
        : Promise.resolve({
            items: [],
            total: 0,
          }),

      homeRepository.findBrands(limits.brands),
    ]);

    const sections: HomeSection[] = [
      {
        type: 'BEST_SELLERS',
        title: 'Best Sellers',
        displayType: 'HORIZONTAL_PRODUCTS',
        products: bestSellers.items.map(mapHomeProduct),
        seeAll: {
          enabled: true,
          targetType: 'PRODUCT_LIST',
          target: 'BEST_SELLERS',
        },
      },

      {
        type: 'SPECIAL_OFFERS',
        title: 'Special Offers',
        displayType: 'HORIZONTAL_PRODUCTS',
        products: specialOffers.items.map(mapHomeProduct),
        seeAll: {
          enabled: true,
          targetType: 'PRODUCT_LIST',
          target: 'OFFERS',
        },
      },

      {
        type: 'NEW_ARRIVALS',
        title: 'New Arrivals',
        displayType: 'HORIZONTAL_PRODUCTS',
        products: newArrivals.items.map(mapHomeProduct),
        seeAll: {
          enabled: true,
          targetType: 'PRODUCT_LIST',
          target: 'NEW_ARRIVALS',
        },
      },

      {
        type: 'FEATURED_PRODUCTS',
        title: 'Featured Products',
        displayType: 'HORIZONTAL_PRODUCTS',
        products: featuredProducts.items.map(mapHomeProduct),
        seeAll: {
          enabled: Boolean(featuredCollection),
          targetType: 'COLLECTION',
          target: featuredCollection?.id ?? '',
        },
      },
    ];

    return {
      platform,
      banners: banners.map(mapHomeBanner),
      categories: categories.map(mapHomeCategory),
      sections,
      brands: brands.map(mapHomeBrand),
    };
  }
}

export const homeService = new HomeService();
