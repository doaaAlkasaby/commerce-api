import { PrismaClient } from '../../src/generated/prisma/client.js';

export async function seedCountries(prisma: PrismaClient) {
  const countries = [
    {
      code: 'EG',
      name: 'Egypt',
      currencyCode: 'EGP',
    },
    {
      code: 'SA',
      name: 'Saudi Arabia',
      currencyCode: 'SAR',
    },
    {
      code: 'AE',
      name: 'United Arab Emirates',
      currencyCode: 'AED',
    },
    {
      code: 'US',
      name: 'United States',
      currencyCode: 'USD',
    },
  ];

  for (const country of countries) {
    await prisma.country.upsert({
      where: {
        code: country.code,
      },
      update: {
        name: country.name,
        currencyCode: country.currencyCode,
        isActive: true,
      },
      create: country,
    });
  }
}