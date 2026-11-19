import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { seedTenant } from './helpers.js';

// Egyptian development fixture amounts are denominated in the configured EGP.
export async function seedShipping(prisma: PrismaClient, tenantId: string) {
  await seedTenant(prisma, tenantId);
  const country = await prisma.country.findUniqueOrThrow({
    where: { code: 'EG' },
  });
  await prisma.$transaction(async (tx) => {
    const profile = await tx.shippingProfile.upsert({
      where: { tenantId_countryCode: { tenantId, countryCode: country.code } },
      update: { currency: country.currencyCode, isActive: true },
      create: {
        tenantId,
        countryCode: country.code,
        currency: country.currencyCode,
        isActive: true,
      },
    });
    for (const [code, name, regionCode, standardAmount, expressAmount] of [
      ['CAIRO', 'Cairo', 'C', '60.00', '100.00'],
      ['DAKAHLIA', 'Dakahlia', 'DK', '70.00', '120.00'],
      ['OTHER_EGYPT', 'Other Egypt', null, '100.00', '150.00'],
    ] as const) {
      const zoneData = {
        name,
        countryCode: country.code,
        regionCode,
        city: null,
        isActive: true,
      };
      const zone = await tx.shippingZone.upsert({
        where: { profileId_code: { profileId: profile.id, code } },
        update: zoneData,
        create: { profileId: profile.id, code, ...zoneData },
      });
      for (const [methodCode, name, sortOrder, amount] of [
        ['STANDARD', 'Standard Delivery', 1, standardAmount],
        ['EXPRESS', 'Express Delivery', 2, expressAmount],
      ] as const) {
        const method = await tx.shippingMethod.upsert({
          where: { zoneId_code: { zoneId: zone.id, code: methodCode } },
          update: { name, sortOrder, isActive: true },
          create: {
            zoneId: zone.id,
            code: methodCode,
            name,
            sortOrder,
            isActive: true,
          },
        });
        const rules =
          methodCode === 'STANDARD'
            ? [
                {
                  suffix: 'paid',
                  minOrderAmount: null,
                  maxOrderAmount: '1999.99',
                  flatRate: amount,
                  priority: 1,
                },
                {
                  suffix: 'free',
                  minOrderAmount: '2000.00',
                  maxOrderAmount: null,
                  flatRate: '0.00',
                  priority: 2,
                },
              ]
            : [
                {
                  suffix: 'paid',
                  minOrderAmount: null,
                  maxOrderAmount: null,
                  flatRate: amount,
                  priority: 1,
                },
              ];
        for (const { suffix, ...data } of rules) {
          await tx.shippingRule.upsert({
            where: { id: `seed-shipping-rule-${method.id}-${suffix}` },
            update: { ...data, rateType: 'FLAT', isActive: true },
            create: {
              id: `seed-shipping-rule-${method.id}-${suffix}`,
              methodId: method.id,
              ...data,
              rateType: 'FLAT',
              isActive: true,
            },
          });
        }
      }
    }
  });
}
