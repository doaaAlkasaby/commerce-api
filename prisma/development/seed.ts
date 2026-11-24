import { createHash } from 'node:crypto';
import {
  developmentMedia,
  developmentProducts,
  seedVisuals,
} from './visuals.js';
import type {
  PrismaClient,
  TenantMemberRole,
} from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/common/security/password.js';
import { DevelopmentSeedError } from '../../src/config/development-seed-options.js';
import {
  tenantFixtures as developmentStores,
  seedTenants,
} from '../seeds/tenants.seed.js';

export { tenantFixtures as developmentStores } from '../seeds/tenants.seed.js';

const warehouseCities = {
  KW: 'Kuwait City',
  SA: 'Riyadh',
  EG: 'Cairo',
  AE: 'Dubai',
} as const;

const developmentAccounts: Array<[string, TenantMemberRole]> = [
  ['admin@example.com', 'ADMIN'],
  ['manager@example.com', 'MANAGER'],
  ['customer1@example.com', 'CUSTOMER'],
  ['customer2@example.com', 'CUSTOMER'],
];

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
      const existingAccounts = new Set(
        (
          await tx.user.findMany({
            where: {
              email: { in: developmentAccounts.map(([email]) => email) },
            },
            select: { email: true },
          })
        ).map(({ email }) => email),
      );
      await seedTenants(tx, (store) => {
        const logo = developmentMedia(store, 'identity');
        return {
          logoUrl: logo.url,
          logoStorageKey: logo.storageKey,
          coverImageUrl: developmentMedia(store, 'everyday-edit').url,
        };
      });

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
        const destinations =
          store.key === 'fashion' ? (['KW', 'SA'] as const) : [store.country];
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
                  store.currency !== 'KWD'
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
          store.key === 'fashion' ? (['KW', 'SA'] as const) : [store.country];
        const warehouses = [];
        for (const country of sources) {
          const legacyId = developmentId(`warehouse:${store.key}`);
          const source =
            country === 'KW'
              ? 'kuwait'
              : country === 'SA'
                ? 'saudi'
                : country.toLowerCase();
          const historicalId = developmentId(
            `warehouse:${store.key}:${source}`,
          );
          const existing = await tx.warehouse.findFirst({
            where: {
              tenantId,
              OR: [
                { id: historicalId },
                ...(country === store.country
                  ? [
                      { id: legacyId },
                      { code: 'PRIMARY', countryCode: country },
                    ]
                  : []),
              ],
            },
            orderBy: { id: 'asc' },
          });
          const warehouse =
            existing ??
            (await tx.warehouse.create({
              data: {
                id: historicalId,
                tenantId,
                code: `DEV81_${source.toUpperCase()}`,
                name: `Development ${warehouseCities[country]} warehouse`,
                countryCode: country,
                city: warehouseCities[country],
                address: 'Development showroom',
                latitude:
                  country === 'KW'
                    ? '29.3759'
                    : country === 'SA'
                      ? '24.7136'
                      : null,
                longitude:
                  country === 'KW'
                    ? '47.9774'
                    : country === 'SA'
                      ? '46.6753'
                      : null,
                isDefault: country === store.country,
                priority: country === store.country ? 10 : 20,
                coverage: { create: { countryCode: country } },
              },
            }));
          warehouses.push(warehouse);
        }
        for (const [index, product] of developmentProducts[
          store.key
        ].entries()) {
          const key = ['tee', 'denim', 'shoes'][index]!;
          const productId = developmentId(`product:${store.key}:${key}`);
          const saved = await tx.product.upsert({
            where: { id: productId },
            update: {},
            create: {
              id: productId,
              tenantId,
              categoryId: category.id,
              taxCategoryId: taxCategory.id,
              name: product.name,
              slug: key,
              description: product.description,
              basePrice: product.price,
              status: 'ACTIVE',
            },
            include: { variants: true },
          });
          if (saved.tenantId !== tenantId)
            throw new DevelopmentSeedError(
              'Development product ownership conflict',
            );
          const genericId = developmentId(`variant:${store.key}:${key}`);
          const knownGeneric = saved.variants.find(
            ({ id }) => id === genericId,
          );
          const sized = product.sizes.length > 0 && !knownGeneric;
          if (
            saved.variants.length &&
            !knownGeneric &&
            !saved.variants.some(({ id }) =>
              product.sizes.some(
                (size) =>
                  id === developmentId(`variant:${store.key}:${key}:${size}`),
              ),
            )
          )
            continue;
          const variants = sized ? product.sizes : [''];
          const attribute = sized
            ? await tx.productAttribute.upsert({
                where: { productId_name: { productId, name: 'Size' } },
                update: {},
                create: {
                  id: developmentId(`attribute:${store.key}:${key}`),
                  productId,
                  name: 'Size',
                },
              })
            : null;
          for (const [position, size] of variants.entries()) {
            const value = attribute
              ? await tx.productAttributeValue.upsert({
                  where: {
                    attributeId_value: {
                      attributeId: attribute.id,
                      value: size,
                    },
                  },
                  update: {},
                  create: {
                    id: developmentId(`value:${store.key}:${key}:${size}`),
                    attributeId: attribute.id,
                    value: size,
                  },
                })
              : null;
            const variantId = size
              ? developmentId(`variant:${store.key}:${key}:${size}`)
              : genericId;
            const variant = await tx.productVariant.upsert({
              where: { id: variantId },
              update: {},
              create: {
                id: variantId,
                productId,
                sku: size
                  ? `DEV81-${store.key}-${key}-${size}`
                  : `DEV81-${store.key.toUpperCase()}-${key.toUpperCase()}`,
                combinationKey: value?.id ?? 'DEFAULT',
                taxCategoryId: taxCategory.id,
                isDefault: !size,
                price: product.price,
                ...(value
                  ? { values: { create: { attributeValueId: value.id } } }
                  : {}),
              },
            });
            if (variant.productId !== productId)
              throw new DevelopmentSeedError(
                'Development variant ownership conflict',
              );
            for (const warehouse of warehouses) {
              const source =
                warehouse.countryCode === 'KW'
                  ? 'kuwait'
                  : warehouse.countryCode === 'SA'
                    ? 'saudi'
                    : warehouse.countryCode.toLowerCase();
              const quantity =
                (warehouse.countryCode === 'SA' ? product.sa : product.stock)[
                  position
                ] ?? 0;
              const stock = await tx.inventory.upsert({
                where: {
                  warehouseId_variantId: {
                    warehouseId: warehouse.id,
                    variantId,
                  },
                },
                update: {},
                create: {
                  id: developmentId(
                    `inventory:${store.key}:${source}:${key}:${size || 'default'}`,
                  ),
                  tenantId,
                  warehouseId: warehouse.id,
                  variantId,
                  quantity,
                },
              });
              if (stock.tenantId !== tenantId)
                throw new DevelopmentSeedError(
                  'Development inventory ownership conflict',
                );
            }
          }
        }
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
        for (const [email, role] of developmentAccounts) {
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
          if (existingAccounts.has(email)) continue;
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

        await seedVisuals(tx, store.key);
      }
    },
    { timeout: 30000 },
  );
}
