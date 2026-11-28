import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { prisma as defaultPrisma } from '../../config/database.js';

export const RECOMMENDATION_GROUP_POOL_LIMIT = 32;
export const RECOMMENDATION_CATEGORY_MAX_DEPTH = 32;
export const COMPLEMENTARY_CANDIDATE_POOL_LIMIT = 45;
export const CART_COMPLEMENTARY_CANDIDATE_POOL_LIMIT = 45;

interface CategoryChainRow {
  rootId?: string;
  id: string;
  parentId: string | null;
  isActive: boolean;
  tenantId: string;
  depth: number;
  has_cycle: boolean;
}

export interface CartSourceProductRow {
  productId: string;
  status: string;
  categoryId: string;
}

export interface ComplementaryTargetRelationRow {
  sourceCategoryId: string;
  targetCategoryId: string;
  sortOrder: number;
}

interface CandidateIdRow {
  id: string;
}

export interface ComplementaryCandidateRef {
  id: string;
  categoryId: string;
}

export interface CategoryHierarchyValidationResult {
  isEligible: boolean;
  parentId: string | null;
}

export type CandidateBrandFilter =
  | { mode: 'SAME_BRAND'; brandId: string }
  | { mode: 'OTHER_BRANDS'; excludeBrandId: string }
  | { mode: 'ANY' };

export class ProductRecommendationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSourceProduct(tenantId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
      },
      select: {
        id: true,
        status: true,
        categoryId: true,
        brandId: true,
        basePrice: true,
        discountType: true,
        discountValue: true,
        discountStartsAt: true,
        discountEndsAt: true,
        tenant: {
          select: {
            defaultCurrency: true,
          },
        },
        brand: {
          select: {
            id: true,
            isActive: true,
          },
        },
        variants: {
          where: {
            isActive: true,
          },
          select: {
            id: true,
            price: true,
            isActive: true,
            isDefault: true,
            discountType: true,
            discountValue: true,
            discountStartsAt: true,
            discountEndsAt: true,
          },
        },
      },
    });
  }

  /**
   * Validates the direct category and every ancestor up to the root in a single
   * bounded recursive query. Rejects inactive categories/ancestors, cycles,
   * cross-tenant parent references, dangling parents, and excessive depth.
   */
  async validateCategoryHierarchy(
    tenantId: string,
    categoryId: string,
  ): Promise<CategoryHierarchyValidationResult> {
    const rows = await this.prisma.$queryRaw<CategoryChainRow[]>(Prisma.sql`
      WITH RECURSIVE chain AS (
        SELECT
          c."id",
          c."parentId",
          c."isActive",
          c."tenantId",
          0 AS depth,
          ARRAY[c."id"]::text[] AS visited,
          false AS has_cycle
        FROM "Category" c
        WHERE c."id" = ${categoryId}
          AND c."tenantId" = ${tenantId}

        UNION ALL

        SELECT
          p."id",
          p."parentId",
          p."isActive",
          p."tenantId",
          ch.depth + 1,
          ch.visited || p."id",
          (p."id" = ANY(ch.visited)) AS has_cycle
        FROM chain ch
        INNER JOIN "Category" p
          ON p."id" = ch."parentId"
        WHERE ch."parentId" IS NOT NULL
          AND NOT ch.has_cycle
          AND ch.depth < ${RECOMMENDATION_CATEGORY_MAX_DEPTH}
      )
      SELECT "id", "parentId", "isActive", "tenantId", depth, has_cycle
      FROM chain
      ORDER BY depth ASC
    `);

    if (rows.length === 0) {
      return { isEligible: false, parentId: null };
    }

    for (const row of rows) {
      if (row.has_cycle || row.tenantId !== tenantId || !row.isActive) {
        return { isEligible: false, parentId: null };
      }
    }

    const tail = rows[rows.length - 1];
    // A valid chain must terminate at a root category (parentId === null).
    // Non-null tail.parentId means a dangling reference or depth cap exceeded.
    if (!tail || tail.parentId !== null) {
      return { isEligible: false, parentId: null };
    }

    return {
      isEligible: true,
      parentId: rows[0]?.parentId ?? null,
    };
  }

  /**
   * Batched validation of multiple category ancestor chains in a single bounded
   * recursive query. Enforces identical invariants to validateCategoryHierarchy:
   * active categories/ancestors, same tenant, no cycles, root termination, and
   * bounded depth.
   */
  async validateCategoryHierarchiesBatch(
    tenantId: string,
    categoryIds: string[],
  ): Promise<Map<string, CategoryHierarchyValidationResult>> {
    const uniqueIds = Array.from(new Set(categoryIds));
    const results = new Map<string, CategoryHierarchyValidationResult>();

    if (uniqueIds.length === 0) {
      return results;
    }

    const idList = Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}`));

    const rows = await this.prisma.$queryRaw<
      Array<CategoryChainRow & { rootId: string }>
    >(Prisma.sql`
      WITH RECURSIVE chain AS (
        SELECT
          c."id" AS "rootId",
          c."id",
          c."parentId",
          c."isActive",
          c."tenantId",
          0 AS depth,
          ARRAY[c."id"]::text[] AS visited,
          false AS has_cycle
        FROM "Category" c
        WHERE c."id" IN (${idList})
          AND c."tenantId" = ${tenantId}

        UNION ALL

        SELECT
          ch."rootId",
          p."id",
          p."parentId",
          p."isActive",
          p."tenantId",
          ch.depth + 1,
          ch.visited || p."id",
          (p."id" = ANY(ch.visited)) AS has_cycle
        FROM chain ch
        INNER JOIN "Category" p
          ON p."id" = ch."parentId"
        WHERE ch."parentId" IS NOT NULL
          AND NOT ch.has_cycle
          AND ch.depth < ${RECOMMENDATION_CATEGORY_MAX_DEPTH}
      )
      SELECT "rootId", "id", "parentId", "isActive", "tenantId", depth, has_cycle
      FROM chain
      ORDER BY "rootId" ASC, depth ASC
    `);

    const grouped = new Map<string, Array<CategoryChainRow & { rootId: string }>>();
    for (const row of rows) {
      const list = grouped.get(row.rootId) ?? [];
      list.push(row);
      grouped.set(row.rootId, list);
    }

    for (const id of uniqueIds) {
      const chain = grouped.get(id);
      if (!chain || chain.length === 0) {
        results.set(id, { isEligible: false, parentId: null });
        continue;
      }

      let valid = true;
      for (const row of chain) {
        if (row.has_cycle || row.tenantId !== tenantId || !row.isActive) {
          valid = false;
          break;
        }
      }

      const tail = chain[chain.length - 1];
      if (!valid || !tail || tail.parentId !== null) {
        results.set(id, { isEligible: false, parentId: null });
        continue;
      }

      results.set(id, {
        isEligible: true,
        parentId: chain[0]?.parentId ?? null,
      });
    }

    return results;
  }

  /**
   * Strictly read-only lookup of all distinct products currently present in the
   * authenticated customer's cart for the given tenant. Never creates a cart.
   */
  async findCartSourceProducts(
    tenantId: string,
    userId: string,
  ): Promise<CartSourceProductRow[]> {
    return this.prisma.$queryRaw<CartSourceProductRow[]>(Prisma.sql`
      SELECT DISTINCT
        p."id" AS "productId",
        p."status"::text AS "status",
        p."categoryId" AS "categoryId"
      FROM "Cart" cart
      INNER JOIN "CartItem" ci
        ON ci."cartId" = cart."id"
      INNER JOIN "ProductVariant" pv
        ON pv."id" = ci."variantId"
      INNER JOIN "Product" p
        ON p."id" = pv."productId"
       AND p."tenantId" = ${tenantId}
      WHERE cart."tenantId" = ${tenantId}
        AND cart."userId" = ${userId}
      ORDER BY p."id" ASC
    `);
  }

  async findActiveSiblingCategoryIds(
    tenantId: string,
    parentId: string,
    excludeCategoryId: string,
  ): Promise<string[]> {
    const siblings = await this.prisma.category.findMany({
      where: {
        tenantId,
        parentId,
        isActive: true,
        id: { not: excludeCategoryId },
      },
      select: {
        id: true,
      },
      orderBy: [{ id: 'asc' }],
    });

    return siblings.map((category) => category.id);
  }

  /**
   * Bounded candidate ID selection for a single priority group.
   * Enforces tenant ownership, ACTIVE product status, active category, and at
   * least one active variant with positive available stock (quantity - reservedQuantity > 0)
   * in a single active warehouse belonging to the same tenant.
   */
  async findEligibleCandidateIds(params: {
    tenantId: string;
    excludeProductId: string;
    excludeProductIds?: string[];
    categoryIds: string[];
    brandFilter: CandidateBrandFilter;
    referencePrice: string;
    poolLimit?: number;
  }): Promise<string[]> {
    const {
      tenantId,
      excludeProductId,
      excludeProductIds = [],
      categoryIds,
      brandFilter,
      referencePrice,
      poolLimit = RECOMMENDATION_GROUP_POOL_LIMIT,
    } = params;

    if (categoryIds.length === 0 || poolLimit <= 0) {
      return [];
    }

    const categoryList = Prisma.join(
      categoryIds.map((categoryId) => Prisma.sql`${categoryId}`),
    );

    const extraExcludedIds = Array.from(
      new Set(excludeProductIds.filter((id) => id !== excludeProductId)),
    );
    const excludeExtraClause =
      extraExcludedIds.length > 0
        ? Prisma.sql`AND p."id" NOT IN (${Prisma.join(
            extraExcludedIds.map((id) => Prisma.sql`${id}`),
          )})`
        : Prisma.empty;

    const brandClause =
      brandFilter.mode === 'SAME_BRAND'
        ? Prisma.sql`AND p."brandId" = ${brandFilter.brandId}`
        : brandFilter.mode === 'OTHER_BRANDS'
          ? Prisma.sql`AND (p."brandId" IS NULL OR p."brandId" <> ${brandFilter.excludeBrandId})`
          : Prisma.empty;

    const rows = await this.prisma.$queryRaw<CandidateIdRow[]>(Prisma.sql`
      SELECT p."id"
      FROM "Product" p
      INNER JOIN "Category" c
        ON c."id" = p."categoryId"
       AND c."tenantId" = ${tenantId}
       AND c."isActive" = true
      WHERE p."tenantId" = ${tenantId}
        AND p."id" <> ${excludeProductId}
        ${excludeExtraClause}
        AND p."status" = 'ACTIVE'
        AND p."categoryId" IN (${categoryList})
        ${brandClause}
        AND EXISTS (
          SELECT 1
          FROM "ProductVariant" pv
          INNER JOIN "Inventory" inv
            ON inv."variantId" = pv."id"
           AND inv."tenantId" = ${tenantId}
          INNER JOIN "Warehouse" w
            ON w."id" = inv."warehouseId"
           AND w."tenantId" = ${tenantId}
           AND w."isActive" = true
          WHERE pv."productId" = p."id"
            AND pv."isActive" = true
            AND (inv."quantity" - inv."reservedQuantity") > 0
        )
      ORDER BY
        ABS(p."basePrice" - ${referencePrice}::numeric) ASC,
        p."createdAt" DESC,
        p."id" ASC
      LIMIT ${poolLimit}
    `);

    return rows.map((row) => row.id);
  }

  /**
   * Bounded store-level co-purchase candidate selection using normal commerce
   * Order and OrderItem records only (never SpecialOrder).
   *
   * Counts distinct eligible orders (not quantities or multiple variants),
   * enforces integer basis-point confidence comparison to avoid floating-point
   * boundary drift, excludes unpaid/cancelled/refunded/reconciliation-required
   * orders and future-dated records, and filters candidates to active/purchasable
   * tenant catalog products.
   */
  async findComplementaryCoPurchaseCandidates(params: {
    tenantId: string;
    sourceProductId: string;
    windowStart: Date;
    referenceNow: Date;
    maxSourceOrders: number;
    minSourceOrders: number;
    minCoPurchaseOrders: number;
    minConfidenceBps: number;
    poolLimit?: number;
  }): Promise<ComplementaryCandidateRef[]> {
    const {
      tenantId,
      sourceProductId,
      windowStart,
      referenceNow,
      maxSourceOrders,
      minSourceOrders,
      minCoPurchaseOrders,
      minConfidenceBps,
      poolLimit = COMPLEMENTARY_CANDIDATE_POOL_LIMIT,
    } = params;

    if (poolLimit <= 0 || maxSourceOrders <= 0) {
      return [];
    }

    return this.prisma.$queryRaw<ComplementaryCandidateRef[]>(Prisma.sql`
      WITH source_orders AS (
        SELECT
          o."id",
          o."createdAt"
        FROM "Order" o
        WHERE o."tenantId" = ${tenantId}
          AND o."status" IN ('DELIVERED', 'COMPLETED')
          AND o."paymentStatus" = 'PAID'
          AND o."createdAt" >= ${windowStart}
          AND o."createdAt" <= ${referenceNow}
          AND EXISTS (
            SELECT 1
            FROM "OrderItem" oi_src
            WHERE oi_src."orderId" = o."id"
              AND oi_src."productId" = ${sourceProductId}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "Payment" pay
            WHERE pay."orderId" = o."id"
              AND (
                pay."reconciliationRequired" = true
                OR pay."status" <> 'PAID'
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "PaymentRefund" pr
            WHERE pr."tenantId" = ${tenantId}
              AND pr."orderId" = o."id"
              AND pr."status" IN (
                'REQUESTED',
                'SUBMITTED',
                'PENDING',
                'SUCCEEDED',
                'RECONCILIATION_REQUIRED'
              )
          )
        ORDER BY o."createdAt" DESC, o."id" DESC
        LIMIT ${maxSourceOrders}
      ),
      source_stats AS (
        SELECT COUNT(*)::bigint AS source_order_count
        FROM source_orders
      ),
      co_purchases AS (
        SELECT
          oi."productId" AS product_id,
          COUNT(DISTINCT oi."orderId")::bigint AS co_order_count,
          MAX(so."createdAt") AS last_co_purchased_at
        FROM source_orders so
        CROSS JOIN source_stats ss
        INNER JOIN "OrderItem" oi
          ON oi."orderId" = so."id"
         AND oi."productId" <> ${sourceProductId}
        WHERE ss.source_order_count >= ${minSourceOrders}
        GROUP BY oi."productId", ss.source_order_count
        HAVING COUNT(DISTINCT oi."orderId") >= ${minCoPurchaseOrders}
           AND (COUNT(DISTINCT oi."orderId") * 10000) >= (ss.source_order_count * ${minConfidenceBps})
      )
      SELECT
        p."id" AS "id",
        p."categoryId" AS "categoryId"
      FROM co_purchases cp
      INNER JOIN "Product" p
        ON p."id" = cp.product_id
       AND p."tenantId" = ${tenantId}
       AND p."status" = 'ACTIVE'
      INNER JOIN "Category" c
        ON c."id" = p."categoryId"
       AND c."tenantId" = ${tenantId}
       AND c."isActive" = true
      WHERE EXISTS (
        SELECT 1
        FROM "ProductVariant" pv
        INNER JOIN "Inventory" inv
          ON inv."variantId" = pv."id"
         AND inv."tenantId" = ${tenantId}
        INNER JOIN "Warehouse" w
          ON w."id" = inv."warehouseId"
         AND w."tenantId" = ${tenantId}
         AND w."isActive" = true
        WHERE pv."productId" = p."id"
          AND pv."isActive" = true
          AND (inv."quantity" - inv."reservedQuantity") > 0
      )
      ORDER BY
        cp.co_order_count DESC,
        cp.last_co_purchased_at DESC,
        p."createdAt" DESC,
        p."id" ASC
      LIMIT ${poolLimit}
    `);
  }

  /**
   * Returns active explicitly configured directional target category IDs for a
   * direct source category, in deterministic merchant-defined order.
   */
  async findActiveComplementaryTargetCategoryIds(
    tenantId: string,
    sourceCategoryId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.categoryComplementaryRelation.findMany({
      where: {
        tenantId,
        sourceCategoryId,
        targetCategory: {
          tenantId,
          isActive: true,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { targetCategoryId: 'asc' }],
      select: {
        targetCategoryId: true,
      },
    });

    return rows.map((row) => row.targetCategoryId);
  }

  /**
   * Batched store-level co-purchase candidate selection across all eligible
   * cart source products in a single query.
   *
   * - Applies the per-source 2,000-order cap independently per source product.
   * - Evaluates minimum source orders, minimum co-purchase orders, and integer
   *   basis-point confidence independently per (source, candidate) relationship
   *   before aggregating candidates across the cart.
   * - Counts each qualifying historical order once globally across overlapping
   *   cart sources via COUNT(DISTINCT order_id).
   * - Excludes every product already in the cart before final limits.
   * - Ranks deterministically by:
   *   1. matched unique eligible source products DESC
   *   2. distinct qualifying co-purchase orders DESC
   *   3. most recent qualifying co-purchase timestamp DESC
   *   4. product createdAt DESC
   *   5. product id ASC
   */
  async findCartComplementaryCoPurchaseCandidates(params: {
    tenantId: string;
    sourceProductIds: string[];
    excludedProductIds: string[];
    windowStart: Date;
    referenceNow: Date;
    maxSourceOrders: number;
    minSourceOrders: number;
    minCoPurchaseOrders: number;
    minConfidenceBps: number;
    poolLimit?: number;
  }): Promise<ComplementaryCandidateRef[]> {
    const {
      tenantId,
      sourceProductIds,
      excludedProductIds,
      windowStart,
      referenceNow,
      maxSourceOrders,
      minSourceOrders,
      minCoPurchaseOrders,
      minConfidenceBps,
      poolLimit = CART_COMPLEMENTARY_CANDIDATE_POOL_LIMIT,
    } = params;

    const uniqueSourceIds = Array.from(new Set(sourceProductIds));
    const uniqueExcludedIds = Array.from(
      new Set([...uniqueSourceIds, ...excludedProductIds]),
    );

    if (uniqueSourceIds.length === 0 || poolLimit <= 0 || maxSourceOrders <= 0) {
      return [];
    }

    const sourceList = Prisma.join(
      uniqueSourceIds.map((id) => Prisma.sql`${id}`),
    );
    const excludedList = Prisma.join(
      uniqueExcludedIds.map((id) => Prisma.sql`${id}`),
    );

    return this.prisma.$queryRaw<ComplementaryCandidateRef[]>(Prisma.sql`
      WITH src_order_items AS (
        SELECT DISTINCT
          oi_src."productId" AS source_product_id,
          oi_src."orderId" AS order_id
        FROM "OrderItem" oi_src
        WHERE oi_src."productId" IN (${sourceList})
      ),
      ranked_source_orders AS (
        SELECT
          soi.source_product_id,
          o."id" AS order_id,
          o."createdAt" AS order_created_at,
          ROW_NUMBER() OVER (
            PARTITION BY soi.source_product_id
            ORDER BY o."createdAt" DESC, o."id" DESC
          ) AS rn
        FROM src_order_items soi
        INNER JOIN "Order" o
          ON o."id" = soi.order_id
         AND o."tenantId" = ${tenantId}
         AND o."status" IN ('DELIVERED', 'COMPLETED')
         AND o."paymentStatus" = 'PAID'
         AND o."createdAt" >= ${windowStart}
         AND o."createdAt" <= ${referenceNow}
        WHERE NOT EXISTS (
          SELECT 1
          FROM "Payment" pay
          WHERE pay."orderId" = o."id"
            AND (
              pay."reconciliationRequired" = true
              OR pay."status" <> 'PAID'
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "PaymentRefund" pr
          WHERE pr."tenantId" = ${tenantId}
            AND pr."orderId" = o."id"
            AND pr."status" IN (
              'REQUESTED',
              'SUBMITTED',
              'PENDING',
              'SUCCEEDED',
              'RECONCILIATION_REQUIRED'
            )
        )
      ),
      capped_source_orders AS (
        SELECT source_product_id, order_id, order_created_at
        FROM ranked_source_orders
        WHERE rn <= ${maxSourceOrders}
      ),
      source_stats AS (
        SELECT
          source_product_id,
          COUNT(*)::bigint AS source_order_count
        FROM capped_source_orders
        GROUP BY source_product_id
        HAVING COUNT(*) >= ${minSourceOrders}
      ),
      qualifying_source_orders AS (
        SELECT
          cso.source_product_id,
          ss.source_order_count,
          cso.order_id,
          cso.order_created_at
        FROM capped_source_orders cso
        INNER JOIN source_stats ss
          ON ss.source_product_id = cso.source_product_id
      ),
      candidate_order_links AS (
        SELECT DISTINCT
          qso.source_product_id,
          qso.source_order_count,
          qso.order_id,
          qso.order_created_at,
          oi."productId" AS candidate_product_id
        FROM qualifying_source_orders qso
        INNER JOIN "OrderItem" oi
          ON oi."orderId" = qso.order_id
         AND oi."productId" NOT IN (${excludedList})
      ),
      qualifying_pairs AS (
        SELECT
          source_product_id,
          candidate_product_id
        FROM candidate_order_links
        GROUP BY source_product_id, candidate_product_id, source_order_count
        HAVING COUNT(DISTINCT order_id) >= ${minCoPurchaseOrders}
           AND (COUNT(DISTINCT order_id) * 10000) >= (source_order_count * ${minConfidenceBps})
      ),
      aggregated_candidates AS (
        SELECT
          col.candidate_product_id AS product_id,
          COUNT(DISTINCT col.source_product_id)::bigint AS matched_source_count,
          COUNT(DISTINCT col.order_id)::bigint AS distinct_co_order_count,
          MAX(col.order_created_at) AS last_co_purchased_at
        FROM candidate_order_links col
        INNER JOIN qualifying_pairs qp
          ON qp.source_product_id = col.source_product_id
         AND qp.candidate_product_id = col.candidate_product_id
        GROUP BY col.candidate_product_id
      )
      SELECT
        p."id" AS "id",
        p."categoryId" AS "categoryId"
      FROM aggregated_candidates ac
      INNER JOIN "Product" p
        ON p."id" = ac.product_id
       AND p."tenantId" = ${tenantId}
       AND p."status" = 'ACTIVE'
      INNER JOIN "Category" c
        ON c."id" = p."categoryId"
       AND c."tenantId" = ${tenantId}
       AND c."isActive" = true
      WHERE EXISTS (
        SELECT 1
        FROM "ProductVariant" pv
        INNER JOIN "Inventory" inv
          ON inv."variantId" = pv."id"
         AND inv."tenantId" = ${tenantId}
        INNER JOIN "Warehouse" w
          ON w."id" = inv."warehouseId"
         AND w."tenantId" = ${tenantId}
         AND w."isActive" = true
        WHERE pv."productId" = p."id"
          AND pv."isActive" = true
          AND (inv."quantity" - inv."reservedQuantity") > 0
      )
      ORDER BY
        ac.matched_source_count DESC,
        ac.distinct_co_order_count DESC,
        ac.last_co_purchased_at DESC,
        p."createdAt" DESC,
        p."id" ASC
      LIMIT ${poolLimit}
    `);
  }

  /**
   * Batched lookup of active directional complementary target category relations
   * across multiple source categories in a single query.
   */
  async findActiveComplementaryTargetRelationsForSources(
    tenantId: string,
    sourceCategoryIds: string[],
  ): Promise<ComplementaryTargetRelationRow[]> {
    const uniqueIds = Array.from(new Set(sourceCategoryIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    return this.prisma.categoryComplementaryRelation.findMany({
      where: {
        tenantId,
        sourceCategoryId: { in: uniqueIds },
        targetCategory: {
          tenantId,
          isActive: true,
        },
      },
      orderBy: [
        { sourceCategoryId: 'asc' },
        { sortOrder: 'asc' },
        { targetCategoryId: 'asc' },
      ],
      select: {
        sourceCategoryId: true,
        targetCategoryId: true,
        sortOrder: true,
      },
    });
  }

  /**
   * Single batched bounded query retrieving top eligible products per target
   * category ordered by createdAt DESC, id ASC for deterministic Round Robin.
   */
  async findCategoryFallbackCandidates(params: {
    tenantId: string;
    targetCategoryIds: string[];
    excludeProductIds: string[];
    perCategoryLimit: number;
  }): Promise<ComplementaryCandidateRef[]> {
    const {
      tenantId,
      targetCategoryIds,
      excludeProductIds,
      perCategoryLimit,
    } = params;

    if (targetCategoryIds.length === 0 || perCategoryLimit <= 0) {
      return [];
    }

    const targetList = Prisma.join(
      targetCategoryIds.map((categoryId) => Prisma.sql`${categoryId}`),
    );
    const excludeClause =
      excludeProductIds.length > 0
        ? Prisma.sql`AND p."id" NOT IN (${Prisma.join(
            excludeProductIds.map((id) => Prisma.sql`${id}`),
          )})`
        : Prisma.empty;

    return this.prisma.$queryRaw<ComplementaryCandidateRef[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          p."id" AS "id",
          p."categoryId" AS "categoryId",
          ROW_NUMBER() OVER (
            PARTITION BY p."categoryId"
            ORDER BY p."createdAt" DESC, p."id" ASC
          ) AS rn
        FROM "Product" p
        INNER JOIN "Category" c
          ON c."id" = p."categoryId"
         AND c."tenantId" = ${tenantId}
         AND c."isActive" = true
        WHERE p."tenantId" = ${tenantId}
          AND p."status" = 'ACTIVE'
          AND p."categoryId" IN (${targetList})
          ${excludeClause}
          AND EXISTS (
            SELECT 1
            FROM "ProductVariant" pv
            INNER JOIN "Inventory" inv
              ON inv."variantId" = pv."id"
             AND inv."tenantId" = ${tenantId}
            INNER JOIN "Warehouse" w
              ON w."id" = inv."warehouseId"
             AND w."tenantId" = ${tenantId}
             AND w."isActive" = true
            WHERE pv."productId" = p."id"
              AND pv."isActive" = true
              AND (inv."quantity" - inv."reservedQuantity") > 0
          )
      )
      SELECT "id", "categoryId"
      FROM ranked
      WHERE rn <= ${perCategoryLimit}
      ORDER BY "categoryId" ASC, rn ASC
    `);
  }

  async hydrateCandidatesByIds(tenantId: string, candidateIds: string[]) {
    if (candidateIds.length === 0) {
      return [];
    }

    return this.prisma.product.findMany({
      where: {
        tenantId,
        id: { in: candidateIds },
        status: 'ACTIVE',
        category: {
          tenantId,
          isActive: true,
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        basePrice: true,
        discountType: true,
        discountValue: true,
        discountStartsAt: true,
        discountEndsAt: true,
        createdAt: true,
        categoryId: true,
        brandId: true,
        tenant: {
          select: {
            defaultCurrency: true,
          },
        },
        images: {
          orderBy: [
            { isPrimary: 'desc' },
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
          take: 1,
          select: {
            url: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            attributes: true,
          },
        },
        variants: {
          where: {
            isActive: true,
          },
          orderBy: [{ price: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            price: true,
            isActive: true,
            isDefault: true,
            discountType: true,
            discountValue: true,
            discountStartsAt: true,
            discountEndsAt: true,
            inventory: {
              where: {
                tenantId,
                warehouse: {
                  tenantId,
                  isActive: true,
                },
              },
              select: {
                quantity: true,
                reservedQuantity: true,
              },
            },
          },
        },
      },
    });
  }
}

export const productRecommendationRepository =
  new ProductRecommendationRepository(defaultPrisma);
