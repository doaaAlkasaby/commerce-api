import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { createHash } from 'node:crypto';
import { bannerDefinitions } from './banner-data.js';

function developmentId(name: string) {
  const hex = createHash('sha256')
    .update(`commerce-development-v81:${name}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function seedBanners(prisma: PrismaClient | Prisma.TransactionClient) {
  console.log('🎨 Seeding 24 promotional banners across 6 stores...');

  for (const bannerDef of bannerDefinitions) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: bannerDef.tenantSlug },
    });

    if (!tenant) {
      console.warn(`   ⚠️ Tenant ${bannerDef.tenantSlug} not found. Skipping banner seed.`);
      continue;
    }

    // Find category target ID if specified
    let targetId: string | null = null;
    if (bannerDef.targetCategorySlug) {
      const cat = await prisma.category.findFirst({
        where: { tenantId: tenant.id, slug: bannerDef.targetCategorySlug },
      });
      if (cat) targetId = cat.id;
    }

    const bannerId = developmentId(`banner:${bannerDef.tenantSlug}:${bannerDef.index}`);
    const imageUrl = `/uploads/banners/banner-${bannerDef.tenantSlug}-${bannerDef.index}.webp`;

    await prisma.banner.upsert({
      where: { id: bannerId },
      update: {
        title: bannerDef.title,
        subtitle: bannerDef.subtitle,
        imageUrl,
        mobileImageUrl: imageUrl,
        targetType: bannerDef.targetType,
        targetId: targetId ?? undefined,
        sortOrder: bannerDef.index - 1,
        isActive: true,
      },
      create: {
        id: bannerId,
        tenantId: tenant.id,
        title: bannerDef.title,
        subtitle: bannerDef.subtitle,
        imageStorageKey: `banners/banner-${bannerDef.tenantSlug}-${bannerDef.index}.webp`,
        imageUrl,
        mobileImageStorageKey: `banners/banner-${bannerDef.tenantSlug}-${bannerDef.index}.webp`,
        mobileImageUrl: imageUrl,
        targetType: bannerDef.targetType,
        targetId: targetId ?? undefined,
        sortOrder: bannerDef.index - 1,
        isActive: true,
      },
    });
  }

  console.log('   ✓ 24 promotional banners seeded successfully');
}
