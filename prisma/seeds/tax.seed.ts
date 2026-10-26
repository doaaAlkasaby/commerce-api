import type { PrismaClient } from '../../src/generated/prisma/client.js';

export async function seedTax(
  prisma: PrismaClient,
) {
  const standard =
    await prisma.taxCategory.upsert({
      where: {
        scopeKey_code: {
          scopeKey: 'EG',
          code: 'STANDARD',
        },
      },
      update: {
        name: 'Standard VAT',
        treatment: 'STANDARD',
        isActive: true,
      },
      create: {
        scopeKey: 'EG',
        code: 'STANDARD',
        name: 'Standard VAT',
        treatment: 'STANDARD',
        isActive: true,
      },
    });

  const zeroRated =
    await prisma.taxCategory.upsert({
      where: {
        scopeKey_code: {
          scopeKey: 'EG',
          code: 'ZERO_RATED',
        },
      },
      update: {
        name: 'Zero Rated',
        treatment: 'ZERO_RATED',
        isActive: true,
      },
      create: {
        scopeKey: 'EG',
        code: 'ZERO_RATED',
        name: 'Zero Rated',
        treatment: 'ZERO_RATED',
        isActive: true,
      },
    });

  const exempt =
    await prisma.taxCategory.upsert({
      where: {
        scopeKey_code: {
          scopeKey: 'EG',
          code: 'EXEMPT',
        },
      },
      update: {
        name: 'Exempt',
        treatment: 'EXEMPT',
        isActive: true,
      },
      create: {
        scopeKey: 'EG',
        code: 'EXEMPT',
        name: 'Exempt',
        treatment: 'EXEMPT',
        isActive: true,
      },
    });

  await prisma.taxProfile.upsert({
    where: {
      scopeKey: 'EG',
    },
    update: {
      countryCode: 'EG',
      currency: 'EGP',
      pricesIncludeTax: false,
      isTaxRegistered: true,
      defaultTaxCategoryId: standard.id,
      isActive: true,
    },
    create: {
      scopeKey: 'EG',
      countryCode: 'EG',
      currency: 'EGP',
      pricesIncludeTax: false,
      isTaxRegistered: true,
      defaultTaxCategoryId: standard.id,
      isActive: true,
    },
  });

  await prisma.taxRule.createMany({
    data: [
      {
        taxCategoryId: standard.id,
        countryCode: 'EG',
        regionCode: null,
        rate: 14,
        isActive: true,
        priority: 0,
      },
      {
        taxCategoryId: zeroRated.id,
        countryCode: 'EG',
        regionCode: null,
        rate: 0,
        isActive: true,
        priority: 0,
      },
      {
        taxCategoryId: exempt.id,
        countryCode: 'EG',
        regionCode: null,
        rate: 0,
        isActive: true,
        priority: 0,
      },
    ],
    skipDuplicates: true,
  });
}