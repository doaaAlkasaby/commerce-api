import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { createHash } from 'node:crypto';
import { DevelopmentSeedError } from '../../src/config/development-seed-options.js';

export function developmentId(name: string) {
  const hex = createHash('sha256')
    .update(`commerce-development-v81:${name}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const tenantFixtures = [
  {
    key: 'fashion',
    slug: 'dev81-kuwait-fashion',
    code: 'DEV81_FASHION',
    name: 'Luma | لوما',
    country: 'KW',
    currency: 'KWD',
    timezone: 'Asia/Kuwait',
    isPubliclyListed: true,
    logoUrl: '/uploads/logos/luma.svg',
    coverImageUrl: '/uploads/covers/luma.webp',
  },
  {
    key: 'independent',
    slug: 'dev81-independent',
    code: 'DEV81_INDEPENDENT',
    name: 'Noura | نورة',
    country: 'SA',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    isPubliclyListed: true,
    logoUrl: '/uploads/logos/noura.svg',
    coverImageUrl: '/uploads/covers/noura.webp',
  },
  {
    key: 'toota',
    slug: 'toota-kids',
    code: 'TOOTA_KIDS',
    name: 'Toota | توتة',
    country: 'EG',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
    isPubliclyListed: true,
    logoUrl: '/uploads/logos/toota.svg',
    coverImageUrl: '/uploads/covers/toota.webp',
  },
  {
    key: 'dar',
    slug: 'dar-home',
    code: 'DAR_HOME',
    name: 'Dar | دار',
    country: 'AE',
    currency: 'AED',
    timezone: 'Asia/Dubai',
    isPubliclyListed: true,
    logoUrl: '/uploads/logos/dar.svg',
    coverImageUrl: '/uploads/covers/dar.webp',
  },
  {
    key: 'velo',
    slug: 'velo-sports',
    code: 'VELO_SPORTS',
    name: 'Velo | فيلو',
    country: 'KW',
    currency: 'KWD',
    timezone: 'Asia/Kuwait',
    isPubliclyListed: false,
    logoUrl: '/uploads/logos/velo.svg',
    coverImageUrl: '/uploads/covers/velo.webp',
  },
  {
    key: 'sera',
    slug: 'sera-beauty',
    code: 'SERA_BEAUTY',
    name: 'Sera | سيرا',
    country: 'SA',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    isPubliclyListed: false,
    logoUrl: '/uploads/logos/sera.svg',
    coverImageUrl: '/uploads/covers/sera.webp',
  },
] as const;

export async function seedTenants(prisma: PrismaClient | Prisma.TransactionClient) {
  console.log('🏪 Seeding 6 branded tenant fixtures...');

  for (const [code, name, currencyCode] of [
    ['KW', 'Kuwait', 'KWD'],
    ['SA', 'Saudi Arabia', 'SAR'],
    ['EG', 'Egypt', 'EGP'],
    ['AE', 'United Arab Emirates', 'AED'],
  ] as const) {
    const existingCountry = await prisma.country.findUnique({ where: { code } });
    if (!existingCountry) {
      await prisma.country.create({
        data: {
          id: developmentId(`country:${code}`),
          code,
          name,
          currencyCode,
        },
      });
    }
  }

  for (const store of tenantFixtures) {
    const tenantId = developmentId(`tenant:${store.key}`);

    const collisionBySlug = await prisma.tenant.findUnique({
      where: { slug: store.slug },
    });
    if (collisionBySlug && collisionBySlug.id !== tenantId) {
      throw new DevelopmentSeedError(
        `Collision: Tenant slug "${store.slug}" is owned by unrelated tenant ID ${collisionBySlug.id}`,
      );
    }

    const collisionByCode = await prisma.tenant.findUnique({
      where: { code: store.code },
    });
    if (collisionByCode && collisionByCode.id !== tenantId) {
      throw new DevelopmentSeedError(
        `Collision: Tenant code "${store.code}" is owned by unrelated tenant ID ${collisionByCode.id}`,
      );
    }

    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {
        name: store.name,
        isPubliclyListed: store.isPubliclyListed,
        logoUrl: store.logoUrl,
        coverImageUrl: store.coverImageUrl,
        timezone: store.timezone,
      },
      create: {
        id: tenantId,
        slug: store.slug,
        code: store.code,
        name: store.name,
        status: 'ACTIVE',
        isPubliclyListed: store.isPubliclyListed,
        defaultCountryCode: store.country,
        defaultCurrency: store.currency,
        timezone: store.timezone,
        logoUrl: store.logoUrl,
        coverImageUrl: store.coverImageUrl,
      },
    });
  }

  console.log('   ✓ 6 branded tenant fixtures seeded successfully');
}
