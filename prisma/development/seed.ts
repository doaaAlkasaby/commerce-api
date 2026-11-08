import { createHash } from 'node:crypto';
import { seedVisuals } from './visuals.js';
import type {
  PrismaClient,
  TenantMemberRole,
} from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/common/security/password.js';
import { DevelopmentSeedError } from '../../src/config/development-seed-options.js';

export function developmentId(name: string) {
  const hex = createHash('sha256')
    .update(`commerce-development-v81:${name}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const developmentStores = [
  {
    key: 'fashion',
    slug: 'dev81-kuwait-fashion',
    code: 'DEV81_FASHION',
    name: 'Development Kuwait Fashion',
    country: 'KW',
    currency: 'KWD',
  },
  {
    key: 'independent',
    slug: 'dev81-independent',
    code: 'DEV81_INDEPENDENT',
    name: 'Development Independent Store',
    country: 'SA',
    currency: 'SAR',
  },
] as const;

export async function seedDevelopment(db: PrismaClient, password: string) {
  const passwordHash = await hashPassword(password);
  return db.$transaction(
    async (tx) => {
      for (const [code, name, currencyCode] of [
        ['KW', 'Kuwait', 'KWD'],
        ['SA', 'Saudi Arabia', 'SAR'],
        ['EG', 'Egypt', 'EGP'],
      ]) {
        if (!code || !name || !currencyCode)
          throw new DevelopmentSeedError('Invalid country fixture');
        const row = await tx.country.upsert({
          where: { code },
          update: {},
          create: {
            id: developmentId(`country:${code}`),
            code,
            name,
            currencyCode,
          },
        });
        if (!row.isActive || row.currencyCode !== currencyCode)
          throw new DevelopmentSeedError(
            'Existing country configuration conflicts with the development fixture; no changes were made',
          );
      }
      for (const store of developmentStores) {
        const tenantId = developmentId(`tenant:${store.key}`);
        const collision = await tx.tenant.findUnique({
          where: { slug: store.slug },
        });
        if (collision && collision.id !== tenantId)
          throw new DevelopmentSeedError(
            'Development storefront slug is owned by unrelated data',
          );
        const tenant = await tx.tenant.upsert({
          where: { id: tenantId },
          update: {},
          create: {
            id: tenantId,
            slug: store.slug,
            code: store.code,
            name: store.name,
            defaultCountryCode: store.country,
            defaultCurrency: store.currency,
            timezone: 'Asia/Kuwait',
          },
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
              pricesIncludeTax: false,
              defaultTaxCategoryId: taxCategory.id,
            },
          });
          const profile = await tx.shippingProfile.upsert({
            where: { tenantId_countryCode: { tenantId, countryCode } },
            update: {},
            create: {
              id: developmentId(`shipping:${store.key}:${countryCode}`),
              tenantId,
              countryCode,
              currency: store.currency,
            },
          });
          const zone = await tx.shippingZone.upsert({
            where: {
              profileId_code: { profileId: profile.id, code: 'DEV81_COUNTRY' },
            },
            update: {},
            create: {
              id: developmentId(`zone:${store.key}:${countryCode}`),
              profileId: profile.id,
              code: 'DEV81_COUNTRY',
              name: 'Development country coverage',
              countryCode,
            },
          });
          for (const methodCode of ['local', 'standard']) {
            const method = await tx.shippingMethod.upsert({
              where: { zoneId_code: { zoneId: zone.id, code: methodCode } },
              update: {},
              create: {
                id: developmentId(
                  `method:${store.key}:${countryCode}:${methodCode}`,
                ),
                zoneId: zone.id,
                code: methodCode,
                name:
                  methodCode === 'local'
                    ? 'Local delivery'
                    : 'Standard delivery',
                sortOrder: methodCode === 'local' ? 0 : 10,
              },
            });
            await tx.shippingRule.upsert({
              where: {
                id: developmentId(
                  `rate:${store.key}:${countryCode}:${methodCode}`,
                ),
              },
              update: {},
              create: {
                id: developmentId(
                  `rate:${store.key}:${countryCode}:${methodCode}`,
                ),
                methodId: method.id,
                maxDistanceKm: methodCode === 'local' ? '80' : '2000',
                flatRate:
                  store.currency === 'SAR'
                    ? methodCode === 'local'
                      ? '15'
                      : '35'
                    : methodCode === 'local'
                      ? '1.250'
                      : '3.750',
              },
            });
          }
        }
        const sources =
          store.key === 'fashion' ? ['kuwait', 'saudi'] : ['saudi'];
        for (const source of sources) {
          const warehouseId = developmentId(`warehouse:${store.key}:${source}`);
          await tx.warehouse.upsert({
            where: { id: warehouseId },
            update: {},
            create: {
              id: warehouseId,
              tenantId,
              code: `DEV81_${source.toUpperCase()}`,
              name: `Development ${source} warehouse`,
              countryCode: source === 'kuwait' ? 'KW' : 'SA',
              region: source === 'kuwait' ? 'Al Asimah' : 'Riyadh',
              city: source === 'kuwait' ? 'Kuwait City' : 'Riyadh',
              address:
                source === 'kuwait'
                  ? 'Development showroom, Al-Shuhada Street'
                  : 'Development showroom, King Fahd Road',
              latitude: source === 'kuwait' ? '29.3759' : '24.7136',
              longitude: source === 'kuwait' ? '47.9774' : '46.6753',
              isDefault: source === sources[0],
              priority: source === 'kuwait' ? 10 : 20,
            },
          });
          await tx.warehouseCoverage.upsert({
            where: {
              warehouseId_countryCode: {
                warehouseId,
                countryCode: source === 'kuwait' ? 'KW' : 'SA',
              },
            },
            update: {},
            create: {
              tenantId,
              warehouseId,
              countryCode: source === 'kuwait' ? 'KW' : 'SA',
            },
          });
        }
        const products = [
          {
            key: 'tee',
            name: 'Cotton T-shirt',
            price: store.currency === 'KWD' ? '12.500' : '125',
            variants: ['small', 'medium'],
            kw: [20, 2],
            sa: [8, 15],
          },
          {
            key: 'denim',
            name: 'Straight denim',
            price: store.currency === 'KWD' ? '20' : '200',
            variants: ['30', '32'],
            kw: [4, 0],
            sa: [0, 12],
          },
          {
            key: 'shoes',
            name: 'Everyday sneakers',
            price: store.currency === 'KWD' ? '35' : '350',
            variants: ['40', '41'],
            kw: [0, 3],
            sa: [0, 0],
          },
        ];
        for (const product of products) {
          const productId = developmentId(
            `product:${store.key}:${product.key}`,
          );
          await tx.product.upsert({
            where: { id: productId },
            update: {},
            create: {
              id: productId,
              tenantId,
              categoryId: category.id,
              name: product.name,
              slug: product.key,
              basePrice: product.price,
              status: 'ACTIVE',
            },
          });
          const attributeId = developmentId(
            `attribute:${store.key}:${product.key}`,
          );
          await tx.productAttribute.upsert({
            where: { id: attributeId },
            update: {},
            create: { id: attributeId, productId, name: 'Size' },
          });
          for (const [index, size] of product.variants.entries()) {
            const valueId = developmentId(
              `value:${store.key}:${product.key}:${size}`,
            );
            await tx.productAttributeValue.upsert({
              where: { id: valueId },
              update: {},
              create: { id: valueId, attributeId, value: size },
            });
            const variantId = developmentId(
              `variant:${store.key}:${product.key}:${size}`,
            );
            await tx.productVariant.upsert({
              where: { id: variantId },
              update: {},
              create: {
                id: variantId,
                productId,
                sku: `DEV81-${store.key}-${product.key}-${size}`,
                combinationKey: valueId,
                taxCategoryId: taxCategory.id,
                values: { create: { attributeValueId: valueId } },
              },
            });
            for (const source of sources) {
              const inventoryId = developmentId(
                `inventory:${store.key}:${source}:${product.key}:${size}`,
              );
              const existingStock = await tx.inventory.findUnique({
                where: { id: inventoryId },
              });
              if (existingStock) {
                if (
                  existingStock.tenantId !== tenantId ||
                  existingStock.variantId !== variantId ||
                  existingStock.warehouseId !==
                    developmentId(`warehouse:${store.key}:${source}`)
                )
                  throw new DevelopmentSeedError(
                    'Development inventory identity conflicts with unrelated data',
                  );
                continue;
              }
              const quantity =
                (source === 'kuwait' ? product.kw : product.sa)[index] ?? 0;
              await tx.inventory.create({
                data: {
                  id: inventoryId,
                  tenantId,
                  warehouseId: developmentId(
                    `warehouse:${store.key}:${source}`,
                  ),
                  variantId,
                  quantity,
                },
              });
              if (quantity > 0)
                await tx.inventoryTransaction.create({
                  data: {
                    id: developmentId(`initial:${inventoryId}`),
                    inventoryId,
                    type: 'STOCK_IN',
                    quantity,
                    referenceId: 'DEV81_INITIAL_STOCK',
                    reason: 'Initial development fixture stock',
                  },
                });
            }
          }
        }
        await seedVisuals(tx, store.key);
        await tx.coupon.upsert({
          where: { tenantId_code: { tenantId, code: 'DEV81SAVE10' } },
          update: {},
          create: {
            id: developmentId(`coupon:${store.key}`),
            tenantId,
            code: 'DEV81SAVE10',
            discountType: 'PERCENTAGE',
            discountValue: '10',
            perUserLimit: 10,
            usageLimit: 1000,
          },
        });
      }
      const accounts: Array<{
        key: string;
        store: 'fashion' | 'independent';
        role: TenantMemberRole;
        verified: boolean;
      }> = [
        {
          key: 'fashion-owner',
          store: 'fashion',
          role: 'OWNER',
          verified: true,
        },
        {
          key: 'fashion-manager',
          store: 'fashion',
          role: 'MANAGER',
          verified: true,
        },
        {
          key: 'fashion-customer',
          store: 'fashion',
          role: 'CUSTOMER',
          verified: true,
        },
        {
          key: 'fashion-unverified',
          store: 'fashion',
          role: 'CUSTOMER',
          verified: false,
        },
        {
          key: 'independent-owner',
          store: 'independent',
          role: 'OWNER',
          verified: true,
        },
        {
          key: 'independent-customer',
          store: 'independent',
          role: 'CUSTOMER',
          verified: true,
        },
      ];
      for (const account of accounts) {
        const userId = developmentId(`user:${account.key}`);
        const email = `${account.key}@dev81.example.test`;
        const collision = await tx.user.findUnique({ where: { email } });
        if (collision && collision.id !== userId)
          throw new DevelopmentSeedError(
            'Development email belongs to an unrelated identity',
          );
        const accountUser = await tx.user.upsert({
          where: { id: userId },
          update: {},
          create: {
            id: userId,
            email,
            passwordHash,
            firstName: 'Development',
            lastName: account.key,
            emailVerifiedAt: account.verified ? new Date() : null,
          },
        });
        if (accountUser.email !== email || accountUser.role !== 'CUSTOMER')
          throw new DevelopmentSeedError(
            'Development account identity changed; inspect rather than overwriting it',
          );
        const tenantId = developmentId(`tenant:${account.store}`);
        await tx.tenantMember.upsert({
          where: { tenantId_userId: { tenantId, userId } },
          update: {},
          create: {
            id: developmentId(`member:${account.key}`),
            tenantId,
            userId,
            role: account.role,
          },
        });
        if (account.role === 'CUSTOMER')
          for (const country of account.store === 'fashion'
            ? ['KW', 'SA']
            : ['SA']) {
            await tx.address.upsert({
              where: { id: developmentId(`address:${account.key}:${country}`) },
              update: {},
              create: {
                id: developmentId(`address:${account.key}:${country}`),
                userId,
                firstName: 'Development',
                lastName: 'Customer',
                addressLine1: 'Development delivery address',
                city: country === 'KW' ? 'Kuwait City' : 'Riyadh',
                countryCode: country,
                latitude: country === 'KW' ? '29.3759' : '24.7136',
                longitude: country === 'KW' ? '47.9774' : '46.6753',
                isDefaultShipping:
                  country === (account.store === 'fashion' ? 'KW' : 'SA'),
              },
            });
          }
      }
      return {
        stores: developmentStores.map((store) => ({
          slug: store.slug,
          currency: store.currency,
        })),
        accounts: accounts.map(
          (account) => `${account.key}@dev81.example.test`,
        ),
      };
    },
    { timeout: 30000 },
  );
}
