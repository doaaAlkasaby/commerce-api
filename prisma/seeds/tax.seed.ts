import type {
  PrismaClient,
  TaxTreatment,
} from '../../src/generated/prisma/client.js';
import { seedTenant } from './helpers.js';

// These are Egyptian development fixtures, not a source of production tax policy.
export async function seedTax(prisma: PrismaClient, tenantId: string) {
  await seedTenant(prisma, tenantId);
  const country = await prisma.country.findUniqueOrThrow({
    where: { code: 'EG' },
  });
  await prisma.$transaction(async (tx) => {
    for (const [code, name, rate] of [
      ['STANDARD', 'Standard VAT', 14],
      ['ZERO_RATED', 'Zero Rated', 0],
      ['EXEMPT', 'Exempt', 0],
    ] as const) {
      const treatment: TaxTreatment = code;
      const category = await tx.taxCategory.upsert({
        where: { tenantId_code: { tenantId, code } },
        update: { name, treatment, isActive: true },
        create: { tenantId, code, name, treatment, isActive: true },
      });
      // Nullable region fields do not supply a reliable unique key. A stable ID
      // prevents reruns from adding another country-wide rule/profile.
      await tx.taxRule.upsert({
        where: { id: `seed-tax-rule-${tenantId}-${code}` },
        update: { rate, isActive: true },
        create: {
          id: `seed-tax-rule-${tenantId}-${code}`,
          taxCategoryId: category.id,
          countryCode: country.code,
          regionCode: null,
          rate,
          isActive: true,
          priority: 0,
        },
      });
      if (code === 'STANDARD') {
        const existing = await tx.taxProfile.findFirst({
          where: { tenantId, countryCode: country.code, regionCode: null },
        });
        const data = {
          currency: country.currencyCode,
          pricesIncludeTax: false,
          isTaxRegistered: true,
          defaultTaxCategoryId: category.id,
          isActive: true,
        };
        if (existing)
          await tx.taxProfile.update({ where: { id: existing.id }, data });
        else
          await tx.taxProfile.create({
            data: {
              id: `seed-tax-profile-${tenantId}-EG`,
              tenantId,
              countryCode: country.code,
              ...data,
            },
          });
      }
    }
  });
}
