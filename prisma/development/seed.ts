import { createHash } from 'node:crypto';
import { seedVisuals } from './visuals.js';
import type {
  PrismaClient,
  TenantMemberRole,
} from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/common/security/password.js';
import { DevelopmentSeedError } from '../../src/config/development-seed-options.js';
import { tenantFixtures as developmentStores, seedTenants } from '../seeds/tenants.seed.js';

export { tenantFixtures as developmentStores } from '../seeds/tenants.seed.js';

const warehouseCities = {
  KW: 'Kuwait City',
  SA: 'Riyadh',
  EG: 'Cairo',
  AE: 'Dubai',
} as const;

export function developmentId(name: string) {
  const hex = createHash('sha256')
    .update(`commerce-development-v81:${name}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function seedDevelopment(db: PrismaClient, password: string) {
  const passwordHash = await hashPassword(password);
  return db.$transaction(
    async (tx) => {
      await seedTenants(tx);

      for (const store of developmentStores) {
        const tenantId = developmentId(`tenant:${store.key}`);
        const collision = await tx.tenant.findUnique({
          where: { slug: store.slug },
        });
        if (collision && collision.id !== tenantId)
          throw new DevelopmentSeedError(
            'Development storefront slug is owned by unrelated data',
          );
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
        });
        if (
          tenant.slug !== store.slug ||
          tenant.code !== store.code ||
          tenant.defaultCurrency !== store.currency ||
          tenant.status !== 'ACTIVE'
        )
          throw new DevelopmentSeedError(
            'Existing development tenant configuration changed; inspect it rather than overwriting it',
          );
        await tx.tenantOrderPolicy.upsert({
          where: { tenantId },
          update: {},
          create: {
            tenantId,
            minOrderAmount: store.key === 'fashion' ? '5' : '10',
            maxOrderAmount: store.key === 'fashion' ? '250' : '1000',
            maxOrderItems: 20,
            maxDistinctItems: 5,
            maxQuantityPerItem: 10,
          },
        });
        await tx.appSetting.upsert({
          where: { tenantId_key: { tenantId, key: 'features' } },
          update: {},
          create: {
            id: developmentId(`settings:${store.key}`),
            tenantId,
            key: 'features',
            value: ['warehouse-checkout'],
            isPublic: true,
          },
        });
        const category = await tx.category.upsert({
          where: { id: developmentId(`category:${store.key}`) },
          update: {},
          create: {
            id: developmentId(`category:${store.key}`),
            tenantId,
            name: 'Development collection',
            slug: 'development-collection',
          },
        });
        const taxCategory = await tx.taxCategory.upsert({
          where: { id: developmentId(`tax:${store.key}`) },
          update: {},
          create: {
            id: developmentId(`tax:${store.key}`),
            tenantId,
            code: 'DEV81_STANDARD',
            name: 'Development standard tax',
            treatment: 'STANDARD',
          },
        });
        const destinations = store.key === 'fashion' ? ['KW', 'SA'] : ['SA'];
        for (const countryCode of destinations) {
          await tx.taxRule.upsert({
            where: {
              id: developmentId(`tax-rule:${store.key}:${countryCode}`),
            },
            update: {},
            create: {
              id: developmentId(`tax-rule:${store.key}:${countryCode}`),
              taxCategoryId: taxCategory.id,
              countryCode,
              rate: countryCode === 'SA' ? '15' : '0',
            },
          });
          await tx.taxProfile.upsert({
            where: {
              id: developmentId(`tax-profile:${store.key}:${countryCode}`),
            },
            update: {},
            create: {
              id: developmentId(`tax-profile:${store.key}:${countryCode}`),
              tenantId,
              countryCode,
              currency: store.currency,
              defaultTaxCategoryId: taxCategory.id,
            },
          });
        }
        const shippingProfile = await tx.shippingProfile.upsert({
          where: { id: developmentId(`shipping-profile:${store.key}`) },
          update: {},
          create: {
            id: developmentId(`shipping-profile:${store.key}`),
            tenantId,
            countryCode: store.country,
            currency: store.currency,
            originLatitude: '29.3759',
            originLongitude: '47.9774',
          },
        });
        const shippingZone = await tx.shippingZone.upsert({
          where: { id: developmentId(`shipping-zone:${store.key}`) },
          update: {},
          create: {
            id: developmentId(`shipping-zone:${store.key}`),
            profileId: shippingProfile.id,
            code: 'DEFAULT',
            name: 'Default zone',
            countryCode: store.country,
          },
        });
        const shippingMethod = await tx.shippingMethod.upsert({
          where: { id: developmentId(`shipping-method:${store.key}`) },
          update: {},
          create: {
            id: developmentId(`shipping-method:${store.key}`),
            zoneId: shippingZone.id,
            code: 'STANDARD',
            name: 'Standard delivery',
          },
        });
        await tx.shippingRule.upsert({
          where: { id: developmentId(`shipping-rule:${store.key}`) },
          update: {},
          create: {
            id: developmentId(`shipping-rule:${store.key}`),
            methodId: shippingMethod.id,
            flatRate: store.key === 'fashion' ? '2.500' : '15.000',
          },
        });
        const warehouse = await tx.warehouse.upsert({
          where: { id: developmentId(`warehouse:${store.key}`) },
          update: {},
          create: {
            id: developmentId(`warehouse:${store.key}`),
            tenantId,
            code: 'PRIMARY',
            name: 'Primary Warehouse',
            countryCode: store.country,
            city: warehouseCities[store.country],
            address: 'Development showroom',
          },
        });
        await tx.warehouseCoverage.upsert({
          where: {
            warehouseId_countryCode: {
              warehouseId: warehouse.id,
              countryCode: store.country,
            },
          },
          update: {},
          create: {
            tenantId,
            warehouseId: warehouse.id,
            countryCode: store.country,
          },
        });

        const brand = await tx.brand.upsert({
          where: {
            tenantId_slug: { tenantId, slug: 'dune-81' },
          },
          update: {},
          create: {
            id: developmentId(`brand:${store.key}`),
            tenantId,
            name: 'DUNE / 81',
            slug: 'dune-81',
          },
        });

        for (const [key, name, price] of [
          ['tee', 'Cotton T-Shirt', '12.500'],
          ['denim', 'Straight Denim', '20.000'],
          ['shoes', 'Everyday Sneakers', '35.000'],
        ]) {
          if (!key || !name || !price)
            throw new DevelopmentSeedError('Invalid product fixture');
          const productId = developmentId(`product:${store.key}:${key}`);
          const product = await tx.product.upsert({
            where: { id: productId },
            update: {},
            create: {
              id: productId,
              tenantId,
              categoryId: category.id,
              brandId: brand.id,
              name,
              slug: key,
              basePrice: price,
              status: 'ACTIVE',
            },
          });
          const variantId = developmentId(`variant:${store.key}:${key}`);
          await tx.productVariant.upsert({
            where: { id: variantId },
            update: {},
            create: {
              id: variantId,
              productId: product.id,
              sku: `DEV81-${store.key.toUpperCase()}-${key.toUpperCase()}`,
              combinationKey: 'DEFAULT',
              price,
              isDefault: true,
            },
          });
          await tx.inventory.upsert({
            where: {
              warehouseId_variantId: {
                variantId,
                warehouseId: warehouse.id,
              },
            },
            update: {},
            create: {
              tenantId,
              warehouseId: warehouse.id,
              variantId,
              quantity: 100,
              reservedQuantity: 0,
            },
          });
        }

        const userAccounts: Array<[string, TenantMemberRole]> = [
          ['admin@example.com', 'ADMIN'],
          ['manager@example.com', 'MANAGER'],
          ['customer1@example.com', 'CUSTOMER'],
          ['customer2@example.com', 'CUSTOMER'],
        ];
        for (const [email, role] of userAccounts) {
          const user = await tx.user.upsert({
            where: { email },
            update: {},
            create: {
              id: developmentId(`user:${email}`),
              email,
              passwordHash,
              firstName: email.split('@')[0] ?? 'User',
              lastName: 'Development',
              emailVerifiedAt: new Date(),
            },
          });
          await tx.tenantMember.upsert({
            where: {
              tenantId_userId: {
                tenantId,
                userId: user.id,
              },
            },
            update: {},
            create: {
              tenantId,
              userId: user.id,
              role,
            },
          });
        }

        if (['fashion', 'independent'].includes(store.key)) {
          await seedVisuals(tx, store.key as 'fashion' | 'independent');
        }
      }
    },
    { timeout: 30000 },
  );
}
