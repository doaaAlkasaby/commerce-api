import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll } from 'vitest';
import { seedTenants, tenantFixtures, developmentId } from '../../prisma/seeds/tenants.seed.js';
import { testPrisma } from '../../src/config/test-database.js';
import { deleteFixtureTenants } from '../helpers/warehouse.js';
import { DevelopmentSeedError } from '../../src/config/development-seed-options.js';

describe('Dedicated Tenants Seed Module Unit & Integration Tests', () => {
  const seededTenantIds: string[] = [];

  afterAll(async () => {
    const ids = seededTenantIds.filter(Boolean);
    if (ids.length > 0) {
      await deleteFixtureTenants({
        where: { id: { in: ids } },
      });
    }
  });

  it('1. First seedTenants execution creates all 6 expected tenant fixtures with correct metadata', async () => {
    await seedTenants(testPrisma);

    const publicStores = await testPrisma.tenant.findMany({
      where: {
        slug: { in: tenantFixtures.map((t) => t.slug) },
      },
    });

    expect(publicStores.length).toBe(6);

    for (const fixture of tenantFixtures) {
      const store = publicStores.find((s) => s.slug === fixture.slug);
      expect(store).toBeDefined();
      expect(store!.name).toBe(fixture.name);
      expect(store!.defaultCurrency).toBe(fixture.currency);
      expect(store!.defaultCountryCode).toBe(fixture.country);
      expect(store!.timezone).toBe(fixture.timezone);
      expect(store!.isPubliclyListed).toBe(fixture.isPubliclyListed);
      expect(store!.logoUrl).toBe(fixture.logoUrl);

      if (store) seededTenantIds.push(store.id);
    }
  });

  it('2. Second seedTenants execution is idempotent and produces zero duplicate tenants', async () => {
    await seedTenants(testPrisma);

    const count = await testPrisma.tenant.count({
      where: {
        slug: { in: tenantFixtures.map((t) => t.slug) },
      },
    });

    expect(count).toBe(6);
  });

  it('3. Exactly 4 stores are publicly listed and 2 stores are private white-label stores', async () => {
    const publicStores = await testPrisma.tenant.findMany({
      where: {
        slug: { in: tenantFixtures.map((t) => t.slug) },
        isPubliclyListed: true,
      },
    });

    const privateStores = await testPrisma.tenant.findMany({
      where: {
        slug: { in: tenantFixtures.map((t) => t.slug) },
        isPubliclyListed: false,
      },
    });

    expect(publicStores.length).toBe(4);
    expect(privateStores.length).toBe(2);

    expect(publicStores.map((s) => s.slug)).toEqual(
      expect.arrayContaining(['dev81-kuwait-fashion', 'dev81-independent', 'toota-kids', 'dar-home']),
    );

    expect(privateStores.map((s) => s.slug)).toEqual(
      expect.arrayContaining(['velo-sports', 'sera-beauty']),
    );
  });

  it('4. Real slug collision on a target store throws DevelopmentSeedError and rolls back atomic transaction', async () => {
    const targetSlug = 'toota-kids';
    const collidingId = randomUUID();
    const collidingCode = `COLLISION_${randomUUID()}`;

    // Clean up any existing store with slug toota-kids first
    await deleteFixtureTenants({ where: { slug: targetSlug } });

    const collidingTenant = await testPrisma.tenant.create({
      data: {
        id: collidingId,
        slug: targetSlug,
        code: collidingCode,
        name: 'Unrelated Store',
      },
    });

    try {
      let error: any = null;
      try {
        await testPrisma.$transaction(async (tx) => {
          await seedTenants(tx);
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DevelopmentSeedError);
      expect(error.message).contains('Collision');
      expect(error.message).contains(targetSlug);

      // Verify atomic rollback: no new store with expected ID was created
      const tootaByCorrectId = await testPrisma.tenant.findUnique({
        where: { id: developmentId('tenant:toota') },
      });
      expect(tootaByCorrectId).toBeNull();
    } finally {
      await testPrisma.tenant.deleteMany({ where: { id: collidingTenant.id } });
    }
  });

  it('5. Real code collision on a target store throws DevelopmentSeedError and rolls back atomic transaction', async () => {
    const targetCode = 'DAR_HOME';
    const targetSlug = 'dar-home';
    const collidingId = randomUUID();
    const collidingSlug = `unrelated-${randomUUID()}`;

    // Clean up any existing store with code or slug DAR_HOME / dar-home
    await deleteFixtureTenants({
      where: { OR: [{ code: targetCode }, { slug: targetSlug }] },
    });

    const collidingTenant = await testPrisma.tenant.create({
      data: {
        id: collidingId,
        slug: collidingSlug,
        code: targetCode,
        name: 'Unrelated Code Store',
      },
    });

    try {
      let error: any = null;
      try {
        await testPrisma.$transaction(async (tx) => {
          await seedTenants(tx);
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DevelopmentSeedError);
      expect(error.message).contains('Collision');
      expect(error.message).contains(targetCode);

      const darByCorrectId = await testPrisma.tenant.findUnique({
        where: { id: developmentId('tenant:dar') },
      });
      expect(darByCorrectId).toBeNull();
    } finally {
      await testPrisma.tenant.deleteMany({ where: { id: collidingTenant.id } });
    }
  });

  it('6. Re-running seed preserves existing tenant defaultCurrency and defaultCountryCode without overwriting operational settings', async () => {
    const fashionId = developmentId('tenant:fashion');
    const beforeTenant = await testPrisma.tenant.findUniqueOrThrow({ where: { id: fashionId } });

    await seedTenants(testPrisma);

    const afterTenant = await testPrisma.tenant.findUniqueOrThrow({ where: { id: fashionId } });
    expect(afterTenant.id).toBe(beforeTenant.id);
    expect(afterTenant.defaultCurrency).toBe(beforeTenant.defaultCurrency);
    expect(afterTenant.defaultCountryCode).toBe(beforeTenant.defaultCountryCode);
  });
});
