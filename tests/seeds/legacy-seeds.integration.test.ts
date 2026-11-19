import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma as db } from '../../src/config/test-database.js';
import { seedCountries } from '../../prisma/seeds/country.seed.js';
import {
  seedCategories,
  seedBrands,
} from '../../prisma/seeds/categories.seed.js';
import { seedUsers, seedAddresses } from '../../prisma/seeds/users.seed.js';
import {
  seedProducts,
  seedProductAttributesAndVariants,
  seedDefaultVariants,
  seedCollections,
  seedBanners,
  seedHomeProductDiscounts,
  seedCarts,
  seedWishlists,
  seedHomeBestSellerOrders,
} from '../../prisma/seeds/products.seed.js';
import { seedInventory } from '../../prisma/seeds/inventory.seed.js';
import { seedCoupons } from '../../prisma/seeds/coupons.seed.js';
import { seedAppSettings } from '../../prisma/seeds/settings.seed.js';
import { seedTax } from '../../prisma/seeds/tax.seed.js';
import { seedShipping } from '../../prisma/seeds/shipping.seed.js';

// Run only in the disposable PostgreSQL runner, never against the development DB.
describe.runIf(process.env.RUN_TENANT_INTEGRATION === '1')(
  'legacy seed modules with the current schema',
  () => {
    const ids = ['legacy-seed-test-a', 'legacy-seed-test-b'];
    async function seed(tenantId: string) {
      const users = await seedUsers(db, tenantId);
      await seedAddresses(users.customers, db);
      const categories = await seedCategories(db, tenantId);
      const brands = await seedBrands(db, tenantId);
      const products = await seedProducts(categories, brands, db, tenantId);
      await seedProductAttributesAndVariants(products, db, tenantId);
      await seedDefaultVariants(products, db, tenantId);
      await seedCollections(products, db, tenantId);
      await seedBanners(db, tenantId);
      await seedHomeProductDiscounts(db, tenantId);
      await seedCarts(users.customers, db, tenantId);
      await seedWishlists(users.customers, db, tenantId);
      await seedHomeBestSellerOrders(users.customers, db, tenantId);
      await seedInventory(db, tenantId, `warehouse-${tenantId}`);
      await seedCoupons(db, tenantId);
      await seedAppSettings(db, tenantId);
      await seedTax(db, tenantId);
      await seedShipping(db, tenantId);
    }
    async function counts(tenantId: string) {
      return Promise.all([
        db.category.count({ where: { tenantId } }),
        db.product.count({ where: { tenantId } }),
        db.productVariant.count({ where: { product: { tenantId } } }),
        db.banner.count({ where: { tenantId } }),
        db.order.count({ where: { tenantId } }),
        db.inventory.count({ where: { tenantId } }),
        db.taxProfile.count({ where: { tenantId } }),
        db.taxRule.count({ where: { taxCategory: { tenantId } } }),
        db.shippingRule.count({
          where: { method: { zone: { profile: { tenantId } } } },
        }),
        db.cart.count({ where: { tenantId } }),
        db.cartItem.count({ where: { cart: { tenantId } } }),
        db.wishlist.count({ where: { tenantId } }),
        db.wishlistItem.count({ where: { wishlist: { tenantId } } }),
      ]);
    }
    beforeAll(async () => {
      await seedCountries(db);
      for (const id of ids) {
        await db.tenant.create({
          data: {
            id,
            name: id,
            slug: id,
            code: id,
            defaultCurrency: 'KWD',
            defaultCountryCode: 'EG',
          },
        });
        await db.warehouse.create({
          data: {
            id: `warehouse-${id}`,
            tenantId: id,
            code: 'MAIN',
            name: 'Main warehouse',
            countryCode: 'EG',
            city: 'Cairo',
            address: '10 Example Street',
            latitude: 30,
            longitude: 31,
          },
        });
        await seed(id);
      }
    }, 120_000);

    it('creates independent tenant fixtures and currency-aware order snapshots', async () => {
      for (const id of ids) {
        expect(await counts(id)).toEqual([
          34, 20, 95, 5, 10, 95, 1, 3, 9, 2, 6, 3, 9,
        ]);
        const orders = await db.order.findMany({
          where: { tenantId: id },
          include: { items: true },
        });
        for (const order of orders) {
          expect(order.currency).toBe('KWD');
          for (const item of order.items) {
            const product = await db.product.findUniqueOrThrow({
              where: { id: item.productId! },
            });
            expect(product.tenantId).toBe(id);
            expect(item.taxableAmount.toString()).toBe(
              item.totalPrice.toString(),
            );
            expect(item.taxAmount.toString()).toBe('0');
          }
        }
      }
    });

    it('is repeatable without duplicate nullable profiles/rules or losing stock reservations', async () => {
      for (const id of ids) {
        const before = await counts(id);
        const stock = await db.inventory.findFirstOrThrow({
          where: { tenantId: id },
        });
        await db.inventory.update({
          where: { id: stock.id },
          data: { quantity: 90, reservedQuantity: 5 },
        });
        await seed(id);
        expect(await counts(id)).toEqual(before);
        expect(
          await db.inventory.findUniqueOrThrow({ where: { id: stock.id } }),
        ).toMatchObject({ quantity: 90, reservedQuantity: 5 });
      }
    }, 120_000);

    it('rejects products, categories, and warehouses from another tenant', async () => {
      const a = ids[0]!;
      const b = ids[1]!;
      const products = await db.product.findMany({ where: { tenantId: a } });
      await expect(seedCollections(products, db, b)).rejects.toThrow(
        'selected tenant',
      );
      await expect(seedDefaultVariants(products, db, b)).rejects.toThrow(
        'selected tenant',
      );
      await expect(
        seedProductAttributesAndVariants(products, db, b),
      ).rejects.toThrow('selected tenant');
      await expect(
        seedProducts(
          await db.category.findMany({ where: { tenantId: a } }),
          await db.brand.findMany({ where: { tenantId: a } }),
          db,
          b,
        ),
      ).rejects.toThrow('selected tenant');
      await expect(seedInventory(db, a, `warehouse-${b}`)).rejects.toThrow();
      const customer = await db.user.findUniqueOrThrow({
        where: { email: 'customer1@example.com' },
      });
      await db.tenantMember.update({
        where: { tenantId_userId: { tenantId: b, userId: customer.id } },
        data: { status: 'SUSPENDED' },
      });
      await expect(seedCarts([customer], db, b)).rejects.toThrow(
        'active membership',
      );
      await expect(seedWishlists([customer], db, b)).rejects.toThrow(
        'active membership',
      );
      await expect(seedHomeBestSellerOrders([customer], db, b)).rejects.toThrow(
        'active membership',
      );
    });

    afterAll(async () => {
      const tenantId = { in: ids };
      await db.order.deleteMany({ where: { tenantId } });
      await db.inventory.deleteMany({ where: { tenantId } });
      await db.warehouse.deleteMany({ where: { tenantId } });
      await db.cart.deleteMany({ where: { tenantId } });
      await db.product.deleteMany({ where: { tenantId } });
      await db.taxProfile.deleteMany({ where: { tenantId } });
      await db.taxRule.deleteMany({ where: { taxCategory: { tenantId } } });
      await db.tenant.deleteMany({ where: { id: tenantId } });
      await db.user.deleteMany({
        where: {
          email: {
            in: [
              'admin@example.com',
              'manager@example.com',
              ...Array.from(
                { length: 5 },
                (_, i) => `customer${i + 1}@example.com`,
              ),
            ],
          },
        },
      });
    });
  },
);
