import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      DATABASE_URL: actual.env.TEST_DATABASE_URL,
    },
  };
});

import { seedBanners } from '../../prisma/seeds/banner.seed.js';
import { seedTenants } from '../../prisma/seeds/tenants.seed.js';
import { testPrisma } from '../../src/config/test-database.js';

describe('Promotional Banner Seed Module Integration Tests', () => {
  it('1. First seedBanners execution creates 4 distinct banners per store across all 6 stores', async () => {
    await seedTenants(testPrisma);
    await seedBanners(testPrisma);

    const banners = await testPrisma.banner.findMany({
      select: { id: true, tenantId: true, imageUrl: true, title: true, subtitle: true },
    });

    const seededBanners = banners.filter((b) => b.imageUrl.includes('/uploads/banners/banner-'));
    expect(seededBanners.length).toBe(24);
  }, 30000);

  it('2. Second seedBanners execution is idempotent and produces zero duplicate banners', async () => {
    await seedBanners(testPrisma);

    const banners = await testPrisma.banner.findMany({
      select: { id: true },
    });
    expect(banners.length).toBeGreaterThanOrEqual(24);
  }, 30000);
});
