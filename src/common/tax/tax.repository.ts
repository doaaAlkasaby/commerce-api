import { AppError } from '../errors/app-error.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';

import type { TaxRuleResolutionInput } from './tax.types.js';

export class TaxRepository {
  constructor(
    private readonly client: Prisma.TransactionClient | PrismaClient = prisma,
  ) {}

  async findTaxProfile(
    tenantId: string,
    countryCode: string,
    regionCode?: string | null,
  ) {
    const profiles = await this.client.taxProfile.findMany({
      where: { tenantId, countryCode, isActive: true },
      include: {
        country: { select: { code: true, name: true, currencyCode: true } },
        defaultTaxCategory: {
          select: {
            id: true,
            tenantId: true,
            code: true,
            treatment: true,
            isActive: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    const normalizedRegion = regionCode?.trim().toUpperCase() || null;
    const regional = normalizedRegion
      ? profiles.filter(
          (p) => p.regionCode?.trim().toUpperCase() === normalizedRegion,
        )
      : [];
    const matching = regional.length
      ? regional
      : profiles.filter((p) => !p.regionCode?.trim());
    if (matching.length > 1)
      throw new AppError(
        'Multiple active tax profiles match this destination',
        500,
        'TAX_PROFILE_AMBIGUOUS',
      );
    const profile = matching[0] ?? null;
    if (
      profile?.defaultTaxCategory &&
      profile.defaultTaxCategory.tenantId !== tenantId
    ) {
      return { ...profile, defaultTaxCategory: null };
    }
    return profile;
  }

  async findTaxRule(tenantId: string, input: TaxRuleResolutionInput) {
    const now = input.now ?? new Date();

    const rules = await this.client.taxRule.findMany({
      where: {
        taxCategoryId: input.taxCategoryId,

        taxCategory: { tenantId },

        countryCode: input.countryCode,

        isActive: true,

        AND: [
          {
            OR: [
              {
                effectiveFrom: null,
              },
              {
                effectiveFrom: {
                  lte: now,
                },
              },
            ],
          },
          {
            OR: [
              {
                effectiveTo: null,
              },
              {
                effectiveTo: {
                  gt: now,
                },
              },
            ],
          },
        ],
      },

      include: {
        taxCategory: {
          select: {
            id: true,
            code: true,
            treatment: true,
            isActive: true,
          },
        },
      },

      orderBy: [
        {
          priority: 'desc',
        },
        {
          effectiveFrom: { sort: 'desc', nulls: 'last' },
        },
        { id: 'asc' },
      ],
    });

    const regionMatch = input.regionCode?.trim()
      ? rules.find(
          (rule) =>
            rule.regionCode?.trim().toUpperCase() ===
            input.regionCode?.trim().toUpperCase(),
        )
      : undefined;

    if (regionMatch) {
      return regionMatch;
    }

    return rules.find((rule) => !rule.regionCode?.trim()) ?? null;
  }
}
