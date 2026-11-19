import { seedTenant } from './helpers.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

export async function seedAppSettings(prisma: PrismaClient, tenantId: string) {
  const tenant = await seedTenant(prisma, tenantId);
  console.log('⚙️ Seeding app settings...');

  const settings = [
    {
      key: 'android_build',
      value: [1, 2, 3, 4, 5],
      description:
        'Supported Android build numbers for mobile application updates',
      isPublic: true,
    },
    {
      key: 'ios_build',
      value: [1, 2, 3, 4, 5],
      description: 'Supported iOS build numbers for mobile application updates',
      isPublic: true,
    },
    {
      key: 'forceUpdate',
      value: true,
      description:
        'Whether the mobile application should force users to update',
      isPublic: true,
    },
    {
      key: 'currency_ar',
      value: tenant.defaultCurrency,
      description: 'Currency display name in Arabic',
      isPublic: true,
    },
    {
      key: 'currency_en',
      value: tenant.defaultCurrency,
      description: 'Currency display name in English',
      isPublic: true,
    },
    {
      key: 'features',
      value: ['aiAssistant', 'offers', 'wishlist'],
      description: 'Features enabled for the mobile application',
      isPublic: true,
    },
  ];

  for (const setting of settings) {
    await prisma.appSetting.upsert({
      where: { tenantId_key: { tenantId, key: setting.key } },
      update: {
        value: setting.value,
        description: setting.description,
        isPublic: setting.isPublic,
      },
      create: {
        tenantId,
        key: setting.key,
        value: setting.value,
        description: setting.description,
        isPublic: setting.isPublic,
      },
    });
  }

  console.log(`   ✓ ${settings.length} app settings seeded`);
}
