import type { PrismaClient } from '@prisma/client';

const GLOBAL_SCOPE = 'GLOBAL';

export async function seedShipping(
  prisma: PrismaClient,
) {
  console.log(
    '🌱 Seeding shipping configuration...',
  );

  const profile =
    await prisma.shippingProfile.upsert({
      where: {
        scopeKey: GLOBAL_SCOPE,
      },

      update: {
        name: 'Egypt Shipping',
        currency: 'EGP',
        isActive: true,
      },

      create: {
        scopeKey: GLOBAL_SCOPE,
        name: 'Egypt Shipping',
        currency: 'EGP',
        isActive: true,
      },
    });

  const zones = [
    {
      name: 'Cairo',
      countryCode: 'EG',
      regionCode: 'C',
      city: null,
    },
    {
      name: 'Dakahlia',
      countryCode: 'EG',
      regionCode: 'DK',
      city: null,
    },
    {
      name: 'Other Egypt',
      countryCode: 'EG',
      regionCode: null,
      city: null,
    },
  ];

  for (const zoneData of zones) {
    const existingZone =
      await prisma.shippingZone.findFirst({
        where: {
          shippingProfileId: profile.id,
          countryCode:
            zoneData.countryCode,
          regionCode:
            zoneData.regionCode,
          city: zoneData.city,
        },
      });

    const zone =
      existingZone ??
      (await prisma.shippingZone.create({
        data: {
          shippingProfileId:
            profile.id,
          name: zoneData.name,
          countryCode:
            zoneData.countryCode,
          regionCode:
            zoneData.regionCode,
          city: zoneData.city,
          isActive: true,
        },
      }));

    const standard =
      await prisma.shippingMethod.upsert({
        where: {
          shippingZoneId_code: {
            shippingZoneId: zone.id,
            code: 'STANDARD',
          },
        },

        update: {
          name: 'Standard Delivery',
          description:
            'Standard delivery service',
          rateType: 'FLAT',
          isActive: true,
          sortOrder: 1,
        },

        create: {
          shippingZoneId: zone.id,
          code: 'STANDARD',
          name: 'Standard Delivery',
          description:
            'Standard delivery service',
          rateType: 'FLAT',
          isActive: true,
          sortOrder: 1,
        },
      });

    const express =
      await prisma.shippingMethod.upsert({
        where: {
          shippingZoneId_code: {
            shippingZoneId: zone.id,
            code: 'EXPRESS',
          },
        },

        update: {
          name: 'Express Delivery',
          description:
            'Fast delivery service',
          rateType: 'FLAT',
          isActive: true,
          sortOrder: 2,
        },

        create: {
          shippingZoneId: zone.id,
          code: 'EXPRESS',
          name: 'Express Delivery',
          description:
            'Fast delivery service',
          rateType: 'FLAT',
          isActive: true,
          sortOrder: 2,
        },
      });

    await seedShippingRules(
      prisma,
      standard.id,
      zoneData.name,
    );

    await seedExpressShippingRules(
      prisma,
      express.id,
      zoneData.name,
    );
  }

  console.log(
    '✅ Shipping configuration seeded.',
  );
}

async function seedShippingRules(
  prisma: PrismaClient,
  shippingMethodId: string,
  zoneName: string,
) {
  const standardAmount =
    zoneName === 'Cairo'
      ? '60.00'
      : zoneName === 'Dakahlia'
        ? '70.00'
        : '100.00';

  await prisma.shippingRule.deleteMany({
    where: {
      shippingMethodId,
    },
  });

  await prisma.shippingRule.createMany({
    data: [
      {
        shippingMethodId,
        minOrderAmount: null,
        maxOrderAmount: '1999.99',
        shippingAmount:
          standardAmount,
        priority: 1,
        isActive: true,
      },
      {
        shippingMethodId,
        minOrderAmount: '2000.00',
        maxOrderAmount: null,
        shippingAmount: '0.00',
        priority: 2,
        isActive: true,
      },
    ],
  });
}

async function seedExpressShippingRules(
  prisma: PrismaClient,
  shippingMethodId: string,
  zoneName: string,
) {
  const expressAmount =
    zoneName === 'Cairo'
      ? '100.00'
      : zoneName === 'Dakahlia'
        ? '120.00'
        : '150.00';

  await prisma.shippingRule.deleteMany({
    where: {
      shippingMethodId,
    },
  });

  await prisma.shippingRule.create({
    data: {
      shippingMethodId,
      minOrderAmount: null,
      maxOrderAmount: null,
      shippingAmount:
        expressAmount,
      priority: 1,
      isActive: true,
    },
  });
}