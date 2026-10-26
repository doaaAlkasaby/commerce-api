import { prisma } from '../../config/prisma.js';

import type {
  TaxRuleResolutionInput,
} from './tax.types.js';

export class TaxRepository {
  async findTaxProfile(
    scopeKey: string,
  ) {
    return prisma.taxProfile.findFirst({
      where: {
        scopeKey,
        isActive: true,
      },
      include: {
        country: {
          select: {
            code: true,
            name: true,
            currencyCode: true,
          },
        },
        defaultTaxCategory: {
          select: {
            id: true,
            code: true,
            treatment: true,
            isActive: true,
          },
        },
      },
    });
  }

async findTaxRule(
  input: TaxRuleResolutionInput,
) {
  const now =
    input.now ?? new Date();

  const rules =
    await prisma.taxRule.findMany({
      where: {
        taxCategoryId:
          input.taxCategoryId,

        countryCode:
          input.countryCode,

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
          effectiveFrom: 'desc',
        },
      ],
    });

  const regionMatch =
    input.regionCode
      ? rules.find(
          (rule) =>
            rule.regionCode ===
            input.regionCode,
        )
      : undefined;

  if (regionMatch) {
    return regionMatch;
  }

  return (
    rules.find(
      (rule) =>
        rule.regionCode == null,
    ) ?? null
  );
}
}