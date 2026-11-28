import type { Prisma } from '../../generated/prisma/client.js';
import { promotionRelations } from './promotion.repository.js';
import type { PromotionDefinition } from './promotion.types.js';

const MAX_DEFINITIONS = 50;

export class PromotionCommerceRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  definitions(tenantId: string, currency: string, now: Date) {
    return this.db.promotion.findMany({
      where: {
        tenantId,
        currency,
        publication: 'PUBLISHED',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      include: promotionRelations,
      take: MAX_DEFINITIONS + 1,
    });
  }

  async customer(tenantId: string, userId: string, needsHistory: boolean) {
    const member = await this.db.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { status: true },
    });
    if (member?.status !== 'ACTIVE') return null;
    const order = needsHistory
      ? await this.db.order.findFirst({
          where: {
            tenantId,
            userId,
            status: 'COMPLETED',
            paymentStatus: 'PAID',
          },
          select: { id: true },
        })
      : undefined;
    return {
      id: userId,
      tenantId,
      ...(needsHistory && { hasQualifyingCompletedOrder: order !== null }),
    };
  }

  async usage(
    tenantId: string,
    userId: string,
    definitions: readonly PromotionDefinition[],
  ) {
    const limited = definitions.filter(
      ({ perCustomerLimit, globalLimit }) =>
        perCustomerLimit !== undefined || globalLimit !== undefined,
    );
    if (!limited.length) return new Map();
    const promotionIds = limited.map(({ id }) => id);
    const rows = await this.db.$queryRaw<
      { promotionId: string; global: bigint; customer: bigint }[]
    >`
      SELECT "promotionId", SUM("applications") AS "global",
        COALESCE(SUM("applications") FILTER (WHERE "userId" = ${userId}), 0) AS "customer"
      FROM "PromotionRedemption"
      WHERE "tenantId" = ${tenantId} AND "promotionId" IN (
        SELECT unnest(${promotionIds}::text[])
      ) AND "releasedAt" IS NULL
      GROUP BY "promotionId"
    `;
    const usage = new Map(rows.map((row) => [row.promotionId, row]));
    function remaining(limit: number, consumed: bigint) {
      return consumed >= BigInt(limit) ? 0 : limit - Number(consumed);
    }
    return new Map(
      limited.map(({ id, perCustomerLimit, globalLimit }) => {
        const count = usage.get(id);
        return [
          id,
          {
            ...(globalLimit === undefined
              ? {}
              : {
                  globalRemaining: remaining(globalLimit, count?.global ?? 0n),
                }),
            ...(perCustomerLimit === undefined
              ? {}
              : {
                  customerRemaining: remaining(
                    perCustomerLimit,
                    count?.customer ?? 0n,
                  ),
                }),
          },
        ];
      }),
    );
  }

  sellables(tenantId: string, definitions: readonly PromotionDefinition[]) {
    const explicit = new Set<string>();
    const defaults = new Set<string>();
    for (const definition of definitions) {
      const { reward } = definition.configuration;
      const keys =
        reward.kind === 'FREE_PRODUCT'
          ? [reward.selector]
          : reward.kind === 'SELECTED_GIFT'
            ? reward.options
            : reward.kind === 'PRODUCT_REWARDS'
              ? reward.items.map(({ selector }) => selector)
              : [];
      const targets = new Set(keys);
      for (const selector of definition.selectors) {
        if (!targets.has(selector.key)) continue;
        if (selector.kind === 'VARIANT') explicit.add(selector.variantId);
        if (selector.kind === 'PRODUCT') defaults.add(selector.productId);
      }
    }
    if (!explicit.size && !defaults.size) return [];
    return this.db.productVariant.findMany({
      where: {
        product: { tenantId, status: 'ACTIVE' },
        isActive: true,
        OR: [
          { id: { in: [...explicit] } },
          { isDefault: true, productId: { in: [...defaults] } },
        ],
      },
      include: { product: true },
    });
  }
}

export { MAX_DEFINITIONS };
