import { ProductStatus } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logger/logger.js';
import { toCents } from '../../common/pricing/pricing.service.js';
import { appSettingRepository } from '../app-settings/app-setting.repository.instance.js';
import {
  CART_RECOMMENDATIONS_SETTING_KEY,
  COMPLEMENTARY_PRODUCTS_SETTING_KEY,
  SIMILAR_PRODUCTS_SETTING_KEY,
  readShowCartRecommendationsSetting,
  readShowComplementaryProductsSetting,
  readShowSimilarProductsSetting,
} from '../app-settings/similar-products-settings.js';
import { productEnrichmentService } from './product-enrichment.service.js';
import {
  calculateProductCardEffectivePrice,
  mapProductCardAt,
} from './product.mapper.js';
import {
  CART_COMPLEMENTARY_CANDIDATE_POOL_LIMIT,
  COMPLEMENTARY_CANDIDATE_POOL_LIMIT,
  RECOMMENDATION_GROUP_POOL_LIMIT,
  productRecommendationRepository,
  type ComplementaryCandidateRef,
  type ProductRecommendationRepository,
} from './product-recommendation.repository.js';
import type {
  ProductRecommendationsResponse,
  RecommendationSectionResponse,
  RecommendedProductCardResponse,
} from './product.types.js';

type SourceProduct = NonNullable<
  Awaited<ReturnType<ProductRecommendationRepository['findSourceProduct']>>
>;

type HydratedCandidate = Awaited<
  ReturnType<ProductRecommendationRepository['hydrateCandidatesByIds']>
>[number];

const MAX_RECOMMENDATIONS_LIMIT = 8;

export const COMPLEMENTARY_DEFAULT_LIMIT = 6;
export const COMPLEMENTARY_MAX_LIMIT = 15;
export const CART_RECOMMENDATIONS_DEFAULT_LIMIT = 15;
export const CART_RECOMMENDATIONS_MAX_LIMIT = 15;
export const COMPLEMENTARY_HISTORY_WINDOW_DAYS = 180;
export const COMPLEMENTARY_MAX_SOURCE_ORDERS = 2000;
export const COMPLEMENTARY_MIN_SOURCE_ORDERS = 3;
export const COMPLEMENTARY_MIN_CO_PURCHASE_ORDERS = 2;
export const COMPLEMENTARY_MIN_CONFIDENCE = 0.05;

const COMPLEMENTARY_MIN_CONFIDENCE_BPS = Math.round(
  COMPLEMENTARY_MIN_CONFIDENCE * 10_000,
);
const MILLISECONDS_PER_DAY = 86_400_000;

export interface GetRecommendationsOptions {
  includeComplementary?: boolean;
  complementaryLimit?: number;
}

const absBigInt = (value: bigint): bigint => (value < 0n ? -value : value);

function variantHasAvailableStock(variant: {
  inventory: Array<{ quantity: number; reservedQuantity: number }>;
}): boolean {
  return variant.inventory.some(
    (stock) => stock.quantity - stock.reservedQuantity > 0,
  );
}

function productHasPurchasableVariant(product: HydratedCandidate): boolean {
  return product.variants.some(
    (variant) => variant.isActive && variantHasAvailableStock(variant),
  );
}

/**
 * Approved Quick Add Option B eligibility:
 * A product may be directly added to cart only when it requires no customer
 * option selections, has no product attributes, and has a single unambiguous
 * active default variant that is currently purchasable in an active warehouse.
 */
function canProductQuickAdd(product: HydratedCandidate): boolean {
  if (product._count.attributes > 0) {
    return false;
  }

  const activeVariants = product.variants.filter((variant) => variant.isActive);
  const selectableVariants = activeVariants.filter(
    (variant) => !variant.isDefault,
  );
  const defaultVariants = activeVariants.filter((variant) => variant.isDefault);

  if (selectableVariants.length > 0 || defaultVariants.length !== 1) {
    return false;
  }

  const defaultVariant = defaultVariants[0];
  return defaultVariant ? variantHasAvailableStock(defaultVariant) : false;
}

export class ProductRecommendationService {
  constructor(
    private readonly repository: ProductRecommendationRepository,
  ) {}

  async getRecommendations(
    tenantId: string,
    productId: string,
    requestedLimit: number = MAX_RECOMMENDATIONS_LIMIT,
    userId?: string,
    options: GetRecommendationsOptions = {},
  ): Promise<ProductRecommendationsResponse> {
    const includeComplementary = options.includeComplementary === true;
    const limit = Math.min(
      Math.max(1, Math.trunc(requestedLimit)),
      MAX_RECOMMENDATIONS_LIMIT,
    );
    const complementaryLimit = Math.min(
      Math.max(
        1,
        Math.trunc(options.complementaryLimit ?? COMPLEMENTARY_DEFAULT_LIMIT),
      ),
      COMPLEMENTARY_MAX_LIMIT,
    );
    const pricingNow = new Date();

    // Always validate source product identity, tenant ownership, and ACTIVE
    // status even when store feature toggles are disabled.
    // Legacy requests (includeComplementary=false) preserve the exact single
    // setting lookup so query count and behavior remain unchanged.
    let sourceProduct: SourceProduct | null;
    let similarEnabled: boolean;
    let complementaryEnabled = false;

    if (includeComplementary) {
      const [foundSource, featureSettings] = await Promise.all([
        this.repository.findSourceProduct(tenantId, productId),
        appSettingRepository.findByKeys(tenantId, [
          SIMILAR_PRODUCTS_SETTING_KEY,
          COMPLEMENTARY_PRODUCTS_SETTING_KEY,
        ]),
      ]);
      sourceProduct = foundSource;
      const similarSetting =
        featureSettings.find((row) => row.key === SIMILAR_PRODUCTS_SETTING_KEY) ??
        null;
      const complementarySetting =
        featureSettings.find(
          (row) => row.key === COMPLEMENTARY_PRODUCTS_SETTING_KEY,
        ) ?? null;
      similarEnabled = readShowSimilarProductsSetting(similarSetting);
      complementaryEnabled =
        readShowComplementaryProductsSetting(complementarySetting);
    } else {
      const [foundSource, similarSetting] = await Promise.all([
        this.repository.findSourceProduct(tenantId, productId),
        appSettingRepository.findByKey(tenantId, SIMILAR_PRODUCTS_SETTING_KEY),
      ]);
      sourceProduct = foundSource;
      similarEnabled = readShowSimilarProductsSetting(similarSetting);
    }

    if (!sourceProduct || sourceProduct.status !== ProductStatus.ACTIVE) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    if (!includeComplementary) {
      if (!similarEnabled) {
        return {
          enabled: false,
          items: [],
        };
      }
    } else if (!similarEnabled && !complementaryEnabled) {
      return {
        enabled: false,
        items: [],
        complementary: {
          enabled: false,
          items: [],
        },
      };
    }

    // Validate the entire source category ancestor chain before querying candidates.
    const hierarchy = await this.repository.validateCategoryHierarchy(
      tenantId,
      sourceProduct.categoryId,
    );
    if (!hierarchy.isEligible) {
      return includeComplementary
        ? {
            enabled: similarEnabled,
            items: [],
            complementary: {
              enabled: complementaryEnabled,
              items: [],
            },
          }
        : {
            enabled: true,
            items: [],
          };
    }

    const categoryEligibilityCache = new Map<string, boolean>([
      [sourceProduct.categoryId, true],
    ]);

    const isCategoryEligible = async (categoryId: string): Promise<boolean> => {
      const cached = categoryEligibilityCache.get(categoryId);
      if (cached !== undefined) {
        return cached;
      }
      const result = await this.repository.validateCategoryHierarchy(
        tenantId,
        categoryId,
      );
      categoryEligibilityCache.set(categoryId, result.isEligible);
      return result.isEligible;
    };

    // ------------------------------------------------------------------
    // Section 1 (Opt-in only): Complementary Products resolved FIRST so
    // selected IDs can be excluded from Similar Products with backfill.
    // ------------------------------------------------------------------
    let complementaryOrderedIds: string[] = [];
    let complementaryFailed = false;
    let complementaryError: unknown = null;

    if (includeComplementary && complementaryEnabled) {
      try {
        complementaryOrderedIds = await this.resolveComplementaryCandidateIds(
          tenantId,
          sourceProduct,
          complementaryLimit,
          pricingNow,
          isCategoryEligible,
        );
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        complementaryFailed = true;
        complementaryError = err;
        complementaryOrderedIds = [];
        logger.error(
          {
            err,
            tenantId,
            productId: sourceProduct.id,
            section: 'complementary',
          },
          'Complementary products candidate resolution failed; degrading section cleanly',
        );
      }
    }

    // ------------------------------------------------------------------
    // Section 2: Similar Products (legacy & opt-in).
    // ------------------------------------------------------------------
    const currency = sourceProduct.tenant.defaultCurrency ?? '';
    const sourcePricing = calculateProductCardEffectivePrice(
      sourceProduct,
      pricingNow,
    );
    const sourceEffectivePriceMinor = toCents(
      sourcePricing.finalPrice,
      currency,
    );

    let similarPriorityById = new Map<string, 1 | 2 | 3>();
    let similarFailed = false;
    let similarError: unknown = null;

    if (similarEnabled) {
      const excludeFromSimilar =
        includeComplementary &&
        complementaryEnabled &&
        !complementaryFailed &&
        complementaryOrderedIds.length > 0
          ? complementaryOrderedIds
          : [];

      if (includeComplementary) {
        try {
          similarPriorityById = await this.resolveSimilarCandidatePool(
            tenantId,
            sourceProduct,
            hierarchy.parentId,
            sourcePricing.finalPrice,
            limit,
            excludeFromSimilar,
          );
        } catch (err) {
          if (err instanceof AppError) {
            throw err;
          }
          similarFailed = true;
          similarError = err;
          similarPriorityById = new Map();
          logger.error(
            {
              err,
              tenantId,
              productId: sourceProduct.id,
              section: 'similar',
            },
            'Similar products candidate resolution failed; degrading section cleanly',
          );
        }
      } else {
        similarPriorityById = await this.resolveSimilarCandidatePool(
          tenantId,
          sourceProduct,
          hierarchy.parentId,
          sourcePricing.finalPrice,
          limit,
          [],
        );
      }
    }

    // If every enabled section in an opted-in request failed unexpectedly,
    // propagate rather than masking a full database outage as empty 200.
    if (includeComplementary) {
      const similarAttemptedAndFailed = similarEnabled && similarFailed;
      const complementaryAttemptedAndFailed =
        complementaryEnabled && complementaryFailed;

      if (
        (similarEnabled &&
          complementaryEnabled &&
          similarAttemptedAndFailed &&
          complementaryAttemptedAndFailed) ||
        (similarEnabled &&
          !complementaryEnabled &&
          similarAttemptedAndFailed) ||
        (!similarEnabled &&
          complementaryEnabled &&
          complementaryAttemptedAndFailed)
      ) {
        throw complementaryError ?? similarError;
      }
    }

    const allCandidateIds = Array.from(
      new Set([...complementaryOrderedIds, ...similarPriorityById.keys()]),
    );

    if (allCandidateIds.length === 0) {
      return includeComplementary
        ? {
            enabled: similarEnabled,
            items: [],
            complementary: {
              enabled: complementaryEnabled,
              items: [],
            },
          }
        : {
            enabled: true,
            items: [],
          };
    }

    // Single combined hydration for all candidates across both sections.
    const hydratedCandidates = await this.repository.hydrateCandidatesByIds(
      tenantId,
      allCandidateIds,
    );
    const hydratedById = new Map<string, HydratedCandidate>();
    for (const candidate of hydratedCandidates) {
      if (
        candidate.id !== sourceProduct.id &&
        productHasPurchasableVariant(candidate)
      ) {
        hydratedById.set(candidate.id, candidate);
      }
    }

    // Final ordered Complementary selection (preserving purchase-history
    // priority followed by Round Robin category fallback order).
    const selectedComplementary: Array<{
      product: HydratedCandidate;
      canQuickAdd: boolean;
    }> = [];
    const selectedComplementaryIds = new Set<string>();

    if (includeComplementary && complementaryEnabled && !complementaryFailed) {
      for (const candidateId of complementaryOrderedIds) {
        if (selectedComplementary.length >= complementaryLimit) {
          break;
        }
        if (selectedComplementaryIds.has(candidateId)) {
          continue;
        }
        const product = hydratedById.get(candidateId);
        if (!product) {
          continue;
        }
        selectedComplementaryIds.add(candidateId);
        selectedComplementary.push({
          product,
          canQuickAdd: canProductQuickAdd(product),
        });
      }
    }

    // Final ordered Similar selection (reusing PR.1A deterministic ranking).
    const rankedSimilar: Array<{
      product: HydratedCandidate;
      priorityGroup: 1 | 2 | 3;
      priceDiffMinor: bigint;
      canQuickAdd: boolean;
    }> = [];

    if (similarEnabled && !similarFailed) {
      const seenSimilar = new Set<string>();
      for (const [candidateId, priorityGroup] of similarPriorityById) {
        if (
          seenSimilar.has(candidateId) ||
          selectedComplementaryIds.has(candidateId)
        ) {
          continue;
        }
        const candidate = hydratedById.get(candidateId);
        if (!candidate) {
          continue;
        }
        seenSimilar.add(candidateId);

        const candidatePricing = calculateProductCardEffectivePrice(
          candidate,
          pricingNow,
        );
        const candidatePriceMinor = toCents(
          candidatePricing.finalPrice,
          candidate.tenant.defaultCurrency ?? currency,
        );

        rankedSimilar.push({
          product: candidate,
          priorityGroup,
          priceDiffMinor: absBigInt(
            candidatePriceMinor - sourceEffectivePriceMinor,
          ),
          canQuickAdd: canProductQuickAdd(candidate),
        });
      }

      rankedSimilar.sort((left, right) => {
        if (left.priorityGroup !== right.priorityGroup) {
          return left.priorityGroup - right.priorityGroup;
        }

        if (left.priceDiffMinor !== right.priceDiffMinor) {
          return left.priceDiffMinor < right.priceDiffMinor ? -1 : 1;
        }

        const createdDiff =
          right.product.createdAt.getTime() - left.product.createdAt.getTime();
        if (createdDiff !== 0) {
          return createdDiff;
        }

        return left.product.id < right.product.id
          ? -1
          : left.product.id > right.product.id
            ? 1
            : 0;
      });
    }

    const selectedSimilar = rankedSimilar.slice(0, limit);

    const combinedSelectedEntries = [
      ...selectedSimilar,
      ...selectedComplementary,
    ];

    if (combinedSelectedEntries.length === 0) {
      return includeComplementary
        ? {
            enabled: similarEnabled,
            items: [],
            complementary: {
              enabled: complementaryEnabled,
              items: [],
            },
          }
        : {
            enabled: true,
            items: [],
          };
    }

    // Single batched enrichment call (ratings + per-user wishlist) across both sections.
    const enrichedProducts = await productEnrichmentService.enrichProducts(
      combinedSelectedEntries.map((entry) => entry.product),
      tenantId,
      userId,
    );

    const quickAddById = new Map<string, boolean>();
    for (const entry of combinedSelectedEntries) {
      quickAddById.set(entry.product.id, entry.canQuickAdd);
    }

    const enrichedById = new Map(
      enrichedProducts.map((product) => [product.id, product]),
    );

    const mapEntries = (
      entries: Array<{ product: HydratedCandidate }>,
    ): RecommendedProductCardResponse[] =>
      entries.flatMap((entry) => {
        const enriched = enrichedById.get(entry.product.id);
        if (!enriched) {
          return [];
        }
        return [
          {
            ...mapProductCardAt(enriched, pricingNow),
            canQuickAdd: quickAddById.get(enriched.id) ?? false,
          },
        ];
      });

    const similarItems = mapEntries(selectedSimilar);

    if (!includeComplementary) {
      return {
        enabled: true,
        items: similarItems,
      };
    }

    const complementaryItems = mapEntries(selectedComplementary);

    return {
      enabled: similarEnabled,
      items: similarItems,
      complementary: {
        enabled: complementaryEnabled,
        items: complementaryItems,
      },
    };
  }

  private async resolveSimilarCandidatePool(
    tenantId: string,
    sourceProduct: SourceProduct,
    parentId: string | null,
    referencePrice: string,
    limit: number,
    excludeProductIds: string[],
  ): Promise<Map<string, 1 | 2 | 3>> {
    const hasActiveSourceBrand =
      sourceProduct.brandId !== null && sourceProduct.brand?.isActive === true;

    const priorityByCandidateId = new Map<string, 1 | 2 | 3>();

    // Priority Group 1: Same direct category + same active brand.
    if (hasActiveSourceBrand && sourceProduct.brandId) {
      const sameBrandIds = await this.repository.findEligibleCandidateIds({
        tenantId,
        excludeProductId: sourceProduct.id,
        excludeProductIds,
        categoryIds: [sourceProduct.categoryId],
        brandFilter: {
          mode: 'SAME_BRAND',
          brandId: sourceProduct.brandId,
        },
        referencePrice,
        poolLimit: RECOMMENDATION_GROUP_POOL_LIMIT,
      });

      for (const id of sameBrandIds) {
        priorityByCandidateId.set(id, 1);
      }
    }

    // Priority Group 2: Same direct category + other brands (only if needed).
    if (priorityByCandidateId.size < limit) {
      const otherBrandIds = await this.repository.findEligibleCandidateIds({
        tenantId,
        excludeProductId: sourceProduct.id,
        excludeProductIds,
        categoryIds: [sourceProduct.categoryId],
        brandFilter:
          hasActiveSourceBrand && sourceProduct.brandId
            ? { mode: 'OTHER_BRANDS', excludeBrandId: sourceProduct.brandId }
            : { mode: 'ANY' },
        referencePrice,
        poolLimit: RECOMMENDATION_GROUP_POOL_LIMIT,
      });

      for (const id of otherBrandIds) {
        if (!priorityByCandidateId.has(id)) {
          priorityByCandidateId.set(id, 2);
        }
      }
    }

    // Priority Group 3: Active sibling categories under the same immediate parent
    // (only when direct-category eligible items cannot satisfy the requested limit,
    // and never for root categories where parentId is NULL).
    if (priorityByCandidateId.size < limit && parentId !== null) {
      const siblingCategoryIds =
        await this.repository.findActiveSiblingCategoryIds(
          tenantId,
          parentId,
          sourceProduct.categoryId,
        );

      if (siblingCategoryIds.length > 0) {
        const siblingIds = await this.repository.findEligibleCandidateIds({
          tenantId,
          excludeProductId: sourceProduct.id,
          excludeProductIds,
          categoryIds: siblingCategoryIds,
          brandFilter: { mode: 'ANY' },
          referencePrice,
          poolLimit: RECOMMENDATION_GROUP_POOL_LIMIT,
        });

        for (const id of siblingIds) {
          if (!priorityByCandidateId.has(id)) {
            priorityByCandidateId.set(id, 3);
          }
        }
      }
    }

    return priorityByCandidateId;
  }

  private async resolveComplementaryCandidateIds(
    tenantId: string,
    sourceProduct: SourceProduct,
    complementaryLimit: number,
    referenceNow: Date,
    isCategoryEligible: (categoryId: string) => Promise<boolean>,
  ): Promise<string[]> {
    const windowStart = new Date(
      referenceNow.getTime() -
        COMPLEMENTARY_HISTORY_WINDOW_DAYS * MILLISECONDS_PER_DAY,
    );

    const coPurchasePool =
      await this.repository.findComplementaryCoPurchaseCandidates({
        tenantId,
        sourceProductId: sourceProduct.id,
        windowStart,
        referenceNow,
        maxSourceOrders: COMPLEMENTARY_MAX_SOURCE_ORDERS,
        minSourceOrders: COMPLEMENTARY_MIN_SOURCE_ORDERS,
        minCoPurchaseOrders: COMPLEMENTARY_MIN_CO_PURCHASE_ORDERS,
        minConfidenceBps: COMPLEMENTARY_MIN_CONFIDENCE_BPS,
        poolLimit: COMPLEMENTARY_CANDIDATE_POOL_LIMIT,
      });

    const selectedIds: string[] = [];
    const seenIds = new Set<string>([sourceProduct.id]);

    for (const candidate of coPurchasePool) {
      if (selectedIds.length >= complementaryLimit) {
        break;
      }
      if (seenIds.has(candidate.id)) {
        continue;
      }
      if (!(await isCategoryEligible(candidate.categoryId))) {
        continue;
      }
      seenIds.add(candidate.id);
      selectedIds.push(candidate.id);
    }

    // If purchase history filled the requested complementary limit, skip
    // category relationship lookup and fallback queries entirely.
    if (selectedIds.length >= complementaryLimit) {
      return selectedIds;
    }

    const configuredTargetCategoryIds =
      await this.repository.findActiveComplementaryTargetCategoryIds(
        tenantId,
        sourceProduct.categoryId,
      );

    if (configuredTargetCategoryIds.length === 0) {
      return selectedIds;
    }

    const validTargetCategoryIds: string[] = [];
    for (const targetCategoryId of configuredTargetCategoryIds) {
      if (targetCategoryId === sourceProduct.categoryId) {
        continue;
      }
      if (await isCategoryEligible(targetCategoryId)) {
        validTargetCategoryIds.push(targetCategoryId);
      }
    }

    if (validTargetCategoryIds.length === 0) {
      return selectedIds;
    }

    const remainingSlots = complementaryLimit - selectedIds.length;
    const fallbackCandidates =
      await this.repository.findCategoryFallbackCandidates({
        tenantId,
        targetCategoryIds: validTargetCategoryIds,
        excludeProductIds: Array.from(seenIds),
        perCategoryLimit: remainingSlots,
      });

    if (fallbackCandidates.length === 0) {
      return selectedIds;
    }

    const bucketsByCategory = new Map<string, string[]>();
    for (const candidate of fallbackCandidates) {
      if (seenIds.has(candidate.id)) {
        continue;
      }
      const bucket = bucketsByCategory.get(candidate.categoryId) ?? [];
      bucket.push(candidate.id);
      bucketsByCategory.set(candidate.categoryId, bucket);
    }

    this.appendRoundRobinFromCategoryBuckets(
      validTargetCategoryIds,
      bucketsByCategory,
      seenIds,
      selectedIds,
      complementaryLimit,
    );

    return selectedIds;
  }

  /**
   * Authenticated, strictly read-only cart complementary product recommendations.
   *
   * Strategy:
   * 1. Check independent `show_cart_recommendations` toggle first (short-circuits
   *    before any cart, history, or category queries when disabled).
   * 2. Resolve all distinct products in the customer's cart read-only (never
   *    auto-creates a cart). Every product in the cart is excluded from final
   *    recommendations; only ACTIVE products with eligible category hierarchies
   *    act as recommendation sources.
   * 3. Global Hybrid Priority:
   *    a) Batched purchase-history co-purchase recommendations evaluated
   *       independently per source product before global aggregation.
   *    b) Batched directional category mapping fallback with merged target
   *       category priority (matched distinct source products DESC, min
   *       merchant sortOrder ASC, targetCategoryId ASC) and Round Robin fill.
   * 4. Batched hydration + enrichment preserving pricing, currency, offers,
   *    customer-specific wishlist state, and Quick Add eligibility.
   */
  async getCartRecommendations(
    tenantId: string,
    userId: string,
    requestedLimit: number = CART_RECOMMENDATIONS_DEFAULT_LIMIT,
  ): Promise<RecommendationSectionResponse> {
    const limit = Math.min(
      Math.max(1, Math.trunc(requestedLimit)),
      CART_RECOMMENDATIONS_MAX_LIMIT,
    );

    const setting = await appSettingRepository.findByKey(
      tenantId,
      CART_RECOMMENDATIONS_SETTING_KEY,
    );
    const enabled = readShowCartRecommendationsSetting(setting);
    if (!enabled) {
      return {
        enabled: false,
        items: [],
      };
    }

    const cartProducts = await this.repository.findCartSourceProducts(
      tenantId,
      userId,
    );
    if (cartProducts.length === 0) {
      return {
        enabled: true,
        items: [],
      };
    }

    const allCartProductIds = cartProducts.map((item) => item.productId);
    const activeCartProducts = cartProducts.filter(
      (item) => item.status === ProductStatus.ACTIVE,
    );
    if (activeCartProducts.length === 0) {
      return {
        enabled: true,
        items: [],
      };
    }

    const categoryEligibilityCache = new Map<string, boolean>();
    const ensureCategoriesValidated = async (
      categoryIds: string[],
    ): Promise<void> => {
      const missing = Array.from(
        new Set(
          categoryIds.filter((id) => !categoryEligibilityCache.has(id)),
        ),
      );
      if (missing.length === 0) {
        return;
      }
      const batch = await this.repository.validateCategoryHierarchiesBatch(
        tenantId,
        missing,
      );
      for (const id of missing) {
        categoryEligibilityCache.set(id, batch.get(id)?.isEligible === true);
      }
    };

    await ensureCategoriesValidated(
      activeCartProducts.map((item) => item.categoryId),
    );

    const eligibleSources = activeCartProducts.filter(
      (item) => categoryEligibilityCache.get(item.categoryId) === true,
    );
    if (eligibleSources.length === 0) {
      return {
        enabled: true,
        items: [],
      };
    }

    const pricingNow = new Date();
    const windowStart = new Date(
      pricingNow.getTime() -
        COMPLEMENTARY_HISTORY_WINDOW_DAYS * MILLISECONDS_PER_DAY,
    );

    const coPurchasePool =
      await this.repository.findCartComplementaryCoPurchaseCandidates({
        tenantId,
        sourceProductIds: eligibleSources.map((item) => item.productId),
        excludedProductIds: allCartProductIds,
        windowStart,
        referenceNow: pricingNow,
        maxSourceOrders: COMPLEMENTARY_MAX_SOURCE_ORDERS,
        minSourceOrders: COMPLEMENTARY_MIN_SOURCE_ORDERS,
        minCoPurchaseOrders: COMPLEMENTARY_MIN_CO_PURCHASE_ORDERS,
        minConfidenceBps: COMPLEMENTARY_MIN_CONFIDENCE_BPS,
        poolLimit: Math.max(limit * 3, CART_COMPLEMENTARY_CANDIDATE_POOL_LIMIT),
      });

    await ensureCategoriesValidated(
      coPurchasePool.map((candidate) => candidate.categoryId),
    );

    const selectedIds: string[] = [];
    const seenIds = new Set<string>(allCartProductIds);

    for (const candidate of coPurchasePool) {
      if (selectedIds.length >= limit) {
        break;
      }
      if (seenIds.has(candidate.id)) {
        continue;
      }
      if (categoryEligibilityCache.get(candidate.categoryId) !== true) {
        continue;
      }
      seenIds.add(candidate.id);
      selectedIds.push(candidate.id);
    }

    // Global Hybrid Fill: only query category mappings when purchase history
    // did not fill all requested slots.
    if (selectedIds.length < limit) {
      const sourceProductsByCategory = new Map<string, Set<string>>();
      for (const source of eligibleSources) {
        const set =
          sourceProductsByCategory.get(source.categoryId) ?? new Set<string>();
        set.add(source.productId);
        sourceProductsByCategory.set(source.categoryId, set);
      }

      const uniqueSourceCategoryIds = Array.from(
        sourceProductsByCategory.keys(),
      );
      const relations =
        await this.repository.findActiveComplementaryTargetRelationsForSources(
          tenantId,
          uniqueSourceCategoryIds,
        );

      if (relations.length > 0) {
        const targetAggregates = new Map<
          string,
          { matchedSources: Set<string>; minSortOrder: number }
        >();

        for (const relation of relations) {
          if (relation.targetCategoryId === relation.sourceCategoryId) {
            continue;
          }
          const sourceProducts = sourceProductsByCategory.get(
            relation.sourceCategoryId,
          );
          if (!sourceProducts || sourceProducts.size === 0) {
            continue;
          }

          const existing = targetAggregates.get(relation.targetCategoryId);
          if (!existing) {
            targetAggregates.set(relation.targetCategoryId, {
              matchedSources: new Set(sourceProducts),
              minSortOrder: relation.sortOrder,
            });
          } else {
            for (const productId of sourceProducts) {
              existing.matchedSources.add(productId);
            }
            if (relation.sortOrder < existing.minSortOrder) {
              existing.minSortOrder = relation.sortOrder;
            }
          }
        }

        const candidateTargetIds = Array.from(targetAggregates.keys());
        await ensureCategoriesValidated(candidateTargetIds);

        // Approved deterministic target category ordering:
        // 1. Distinct eligible cart source products mapped to target DESC
        // 2. Minimum configured merchant sortOrder ASC
        // 3. Target category ID ASC
        const validTargetCategoryIds = candidateTargetIds
          .filter((id) => categoryEligibilityCache.get(id) === true)
          .sort((leftId, rightId) => {
            const left = targetAggregates.get(leftId)!;
            const right = targetAggregates.get(rightId)!;
            if (left.matchedSources.size !== right.matchedSources.size) {
              return right.matchedSources.size - left.matchedSources.size;
            }
            if (left.minSortOrder !== right.minSortOrder) {
              return left.minSortOrder - right.minSortOrder;
            }
            return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
          });

        if (validTargetCategoryIds.length > 0) {
          const remainingSlots = limit - selectedIds.length;
          const fallbackCandidates =
            await this.repository.findCategoryFallbackCandidates({
              tenantId,
              targetCategoryIds: validTargetCategoryIds,
              excludeProductIds: Array.from(seenIds),
              perCategoryLimit: remainingSlots,
            });

          if (fallbackCandidates.length > 0) {
            const bucketsByCategory = this.groupCandidatesByCategory(
              fallbackCandidates,
              seenIds,
            );
            this.appendRoundRobinFromCategoryBuckets(
              validTargetCategoryIds,
              bucketsByCategory,
              seenIds,
              selectedIds,
              limit,
            );
          }
        }
      }
    }

    if (selectedIds.length === 0) {
      return {
        enabled: true,
        items: [],
      };
    }

    const hydratedCandidates = await this.repository.hydrateCandidatesByIds(
      tenantId,
      selectedIds,
    );
    const hydratedById = new Map<string, HydratedCandidate>();
    const excludedCartSet = new Set(allCartProductIds);
    for (const candidate of hydratedCandidates) {
      if (
        !excludedCartSet.has(candidate.id) &&
        productHasPurchasableVariant(candidate)
      ) {
        hydratedById.set(candidate.id, candidate);
      }
    }

    const selectedEntries: Array<{
      product: HydratedCandidate;
      canQuickAdd: boolean;
    }> = [];
    const emittedIds = new Set<string>();
    for (const candidateId of selectedIds) {
      if (selectedEntries.length >= limit) {
        break;
      }
      if (emittedIds.has(candidateId)) {
        continue;
      }
      const product = hydratedById.get(candidateId);
      if (!product) {
        continue;
      }
      emittedIds.add(candidateId);
      selectedEntries.push({
        product,
        canQuickAdd: canProductQuickAdd(product),
      });
    }

    if (selectedEntries.length === 0) {
      return {
        enabled: true,
        items: [],
      };
    }

    const enrichedProducts = await productEnrichmentService.enrichProducts(
      selectedEntries.map((entry) => entry.product),
      tenantId,
      userId,
    );
    const enrichedById = new Map(
      enrichedProducts.map((product) => [product.id, product]),
    );
    const items: RecommendedProductCardResponse[] = selectedEntries.flatMap(
      (entry) => {
        const enriched = enrichedById.get(entry.product.id);
        if (!enriched) {
          return [];
        }
        return [
          {
            ...mapProductCardAt(enriched, pricingNow),
            canQuickAdd: entry.canQuickAdd,
          },
        ];
      },
    );

    return {
      enabled: true,
      items,
    };
  }

  private groupCandidatesByCategory(
    candidates: ComplementaryCandidateRef[],
    seenIds: Set<string>,
  ): Map<string, string[]> {
    const bucketsByCategory = new Map<string, string[]>();
    for (const candidate of candidates) {
      if (seenIds.has(candidate.id)) {
        continue;
      }
      const bucket = bucketsByCategory.get(candidate.categoryId) ?? [];
      bucket.push(candidate.id);
      bucketsByCategory.set(candidate.categoryId, bucket);
    }
    return bucketsByCategory;
  }

  private appendRoundRobinFromCategoryBuckets(
    orderedCategoryIds: string[],
    bucketsByCategory: Map<string, string[]>,
    seenIds: Set<string>,
    selectedIds: string[],
    limit: number,
  ): void {
    let round = 0;
    while (selectedIds.length < limit) {
      let pickedInRound = false;

      for (const targetCategoryId of orderedCategoryIds) {
        if (selectedIds.length >= limit) {
          break;
        }
        const bucket = bucketsByCategory.get(targetCategoryId);
        if (!bucket || round >= bucket.length) {
          continue;
        }
        const candidateId = bucket[round];
        if (!candidateId || seenIds.has(candidateId)) {
          continue;
        }
        seenIds.add(candidateId);
        selectedIds.push(candidateId);
        pickedInRound = true;
      }

      if (!pickedInRound) {
        break;
      }
      round += 1;
    }
  }
}

export const productRecommendationService = new ProductRecommendationService(
  productRecommendationRepository,
);
