import { AppError } from '../../common/errors/app-error.js';
import { tenantCurrency } from '../../common/pricing/money.repository.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { PromotionPublication } from '../../generated/prisma/enums.js';
import {
  type CampaignDraft,
  type PromotionDraft,
  selectorColumns,
} from './promotion.schemas.js';

export const promotionRelations = { selectors: true, customers: true } as const;
type PromotionRecord = Prisma.PromotionGetPayload<{
  include: typeof promotionRelations;
}>;

function presentation(input: CampaignDraft) {
  return {
    titleAr: input.titleAr,
    titleEn: input.titleEn,
    descriptionAr: input.descriptionAr ?? null,
    descriptionEn: input.descriptionEn ?? null,
    imageUrl: input.imageUrl ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  };
}

function invalidReference() {
  return new AppError(
    'Invalid promotion reference for this tenant',
    400,
    'INVALID_PROMOTION_REFERENCE',
  );
}

export class PromotionRepository {
  constructor(private readonly db: PrismaClient) {}

  currency(tenantId: string) {
    return tenantCurrency(tenantId, this.db);
  }

  findPromotion(tenantId: string, id: string) {
    return this.db.promotion.findUnique({
      where: { tenantId_id: { tenantId, id } },
      include: promotionRelations,
    });
  }

  findCampaign(tenantId: string, id: string) {
    return this.db.promotionCampaign.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
  }

  createCampaign(tenantId: string, input: CampaignDraft) {
    return this.db.promotionCampaign.create({
      data: { tenantId, ...presentation(input) },
    });
  }

  async createPromotion(
    tenantId: string,
    input: PromotionDraft,
    currency: string,
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        const customers =
          input.audience.kind === 'SELECTED' ? input.audience.customerIds : [];
        await this.validateCustomerMembers(tx, tenantId, customers);
        return tx.promotion.create({
          data: {
            tenantId,
            ...presentation(input),
            campaignId: input.campaignId ?? null,
            template: input.configuration.template,
            configuration: input.configuration,
            currency,
            audience: input.audience.kind,
            priority: input.priority,
            perOrderLimit: input.perOrderLimit,
            perCustomerLimit: input.perCustomerLimit ?? null,
            globalLimit: input.globalLimit ?? null,
            selectors: {
              createMany: {
                data: input.selectors.map((entry) => ({
                  key: entry.key,
                  ...selectorColumns(entry),
                })),
              },
            },
            customers: {
              createMany: { data: customers.map((userId) => ({ userId })) },
            },
          },
          include: promotionRelations,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw invalidReference();
      throw error;
    }
  }

  private async validateCustomerMembers(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: string[],
  ) {
    if (ids.length === 0) return;
    const count = await tx.tenantMember.count({
      where: {
        tenantId,
        userId: { in: ids },
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });
    if (count !== ids.length) throw invalidReference();
  }

  async changePromotionPublication(
    tenantId: string,
    record: PromotionRecord,
    publication: PromotionPublication,
    now: Date,
  ) {
    return this.db.$transaction(async (tx) => {
      // Lock before checking target rows. Target writes take the same lock in SQL.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Promotion" WHERE "tenantId" = ${tenantId} AND "id" = ${record.id}
          AND "publication" = ${record.publication}::"PromotionPublication"
          AND "updatedAt" = ${record.updatedAt}::timestamp
        FOR UPDATE
      `;
      if (!locked.length) return false;
      if (record.publication === 'DRAFT' || publication === 'PUBLISHED') {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { defaultCurrency: true },
        });
        if (tenant?.defaultCurrency !== record.currency) {
          throw new AppError(
            'Promotion currency differs from tenant currency',
            409,
            'PROMOTION_CURRENCY_CHANGED',
          );
        }
        const customers = await tx.promotionCustomer.findMany({
          where: { tenantId, promotionId: record.id },
          select: { userId: true },
        });
        await this.validateCustomerMembers(
          tx,
          tenantId,
          customers.map(({ userId }) => userId),
        );
        const selectors = await tx.promotionSelector.findMany({
          where: { tenantId, promotionId: record.id, productId: { not: null } },
          select: { productId: true, variantId: true },
        });
        if (selectors.length) {
          const variants = await tx.productVariant.findMany({
            where: {
              isActive: true,
              product: { tenantId, status: 'ACTIVE' },
              OR: selectors.map(({ productId, variantId }) => ({
                productId: productId!,
                ...(variantId ? { id: variantId } : { isDefault: true }),
              })),
            },
            select: { id: true, productId: true, isDefault: true },
          });
          if (
            selectors.some(
              ({ productId, variantId }) =>
                !variants.some(
                  (variant) =>
                    variant.productId === productId &&
                    (variantId ? variant.id === variantId : variant.isDefault),
                ),
            )
          )
            throw invalidReference();
        }
      }
      await tx.promotion.update({
        where: { tenantId_id: { tenantId, id: record.id } },
        data: { publication, publishedAt: record.publishedAt ?? now },
      });
      return true;
    });
  }

  async changeCampaignPublication(
    tenantId: string,
    record: {
      id: string;
      publication: PromotionPublication;
      publishedAt: Date | null;
      updatedAt: Date;
    },
    publication: PromotionPublication,
    now: Date,
  ) {
    const result = await this.db.promotionCampaign.updateMany({
      where: {
        tenantId,
        id: record.id,
        publication: record.publication,
        updatedAt: record.updatedAt,
      },
      data: { publication, publishedAt: record.publishedAt ?? now },
    });
    return result.count === 1;
  }
}
