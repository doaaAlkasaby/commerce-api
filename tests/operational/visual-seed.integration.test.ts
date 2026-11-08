import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import app from '../../src/app.js';
import { createLocalStorageService } from '../../src/common/storage/local-storage.service.js';
import { testPrisma as db } from '../../src/config/test-database.js';
import {
  developmentId as id,
  developmentStores,
  seedDevelopment,
} from '../../prisma/development/seed.js';
import { developmentMedia } from '../../prisma/development/visuals.js';

const imageSchema = z.object({
  id: z.string(),
  url: z.string().startsWith('/uploads/development-v82/'),
  altText: z.string().nullable(),
  sortOrder: z.number(),
  isPrimary: z.boolean(),
});
const productSchema = z.object({
  id: z.string(),
  images: z.array(imageSchema),
  variants: z.array(z.object({ images: z.array(imageSchema) })),
});
const cardSchema = z.object({
  id: z.string(),
  primaryImage: z
    .object({ url: z.string().startsWith('/uploads/development-v82/') })
    .nullable(),
});
const homeSchema = z.object({
  banners: z.array(
    z.object({
      imageUrl: z.string().startsWith('/uploads/development-v82/'),
      mobileImageUrl: z.string().startsWith('/uploads/development-v82/'),
      targetId: z.string(),
    }),
  ),
  categories: z.array(
    z.object({ id: z.string(), imageUrl: z.string().nullable() }),
  ),
  brands: z.array(
    z.object({ id: z.string(), imageUrl: z.string().nullable() }),
  ),
  sections: z.array(
    z.object({
      type: z.string(),
      products: z.array(
        z.object({ id: z.string(), image: z.string().nullable() }),
      ),
    }),
  ),
});
const get = (path: string, store = 'fashion') =>
  request(app)
    .get(`/api/v1${path}`)
    .set(
      'X-Tenant-Slug',
      store === 'fashion' ? 'dev81-kuwait-fashion' : 'dev81-independent',
    );
const password = `Visual!${randomUUID()}Aa1`;
const tenantIds = developmentStores.map((store) => id(`tenant:${store.key}`));
let oldCountries: string[];

describe('guarded development visual fixtures through public HTTP contracts', () => {
  beforeAll(async () => {
    oldCountries = (await db.country.findMany({ select: { code: true } })).map(
      (row) => row.code,
    );
    await seedDevelopment(db, password);
  });
  afterAll(async () => {
    await db.inventory.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.warehouse.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.taxRule.deleteMany({
      where: { taxCategory: { tenantId: { in: tenantIds } } },
    });
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.user.deleteMany({
      where: { email: { endsWith: '@dev81.example.test' } },
    });
    await db.country.deleteMany({
      where: {
        code: {
          in: ['KW', 'SA', 'EG'].filter((code) => !oldCountries.includes(code)),
        },
      },
    });
    await db.$disconnect();
  });

  for (const store of developmentStores) {
    it(`${store.key}: serializes three primaries, ordered galleries and size images`, async () => {
      const response = await get('/products', store.key);
      expect(response.status).toBe(200);
      const cards = z
        .object({ items: z.array(cardSchema) })
        .parse(response.body.data).items;
      expect(cards).toHaveLength(3);
      for (const card of cards) {
        expect(card.primaryImage?.url).toContain(
          `/development-v82/${store.key}/`,
        );
        const detail = await get(`/products/${card.id}`, store.key);
        expect(detail.status).toBe(200);
        const product = productSchema.parse(detail.body.data);
        expect(product.images.map((image) => image.sortOrder)).toEqual([0, 1]);
        expect(product.images.filter((image) => image.isPrimary)).toHaveLength(
          1,
        );
        expect(product.images[0]?.url).toBe(card.primaryImage?.url);
        expect(
          product.images.every((image) =>
            image.altText?.includes('development illustration'),
          ),
        ).toBe(true);
        expect(product.variants).toHaveLength(2);
        for (const variant of product.variants)
          expect(variant.images[0]?.url).toBe(card.primaryImage?.url);
      }
    });
    it(`${store.key}: serves public store/category/brand branding and hierarchy`, async () => {
      const storefront = await get('/storefront', store.key);
      expect(storefront.status).toBe(200);
      expect(storefront.body.data.logoUrl).toBe(
        developmentMedia(store.key, 'identity').url,
      );
      expect(storefront.body.data.settings).not.toHaveProperty('theme');
      const categories = await get('/categories', store.key);
      expect(categories.status).toBe(200);
      const rows = z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            parentId: z.string().nullable(),
            imageUrl: z.string().startsWith('/uploads/development-v82/'),
          }),
        )
        .parse(categories.body.data);
      expect(rows).toHaveLength(5);
      expect(rows.find((row) => row.name === 'T-shirts')?.parentId).toBe(
        id(`visual-category:${store.key}:clothing`),
      );
      const brands = await get('/brands/active', store.key);
      expect(brands.status).toBe(200);
      expect(
        z
          .array(
            z.object({
              imageUrl: z.string().startsWith('/uploads/development-v82/'),
            }),
          )
          .parse(brands.body.data),
      ).toHaveLength(1);
      for (const key of ['tee', 'denim', 'shoes']) {
        const product = await db.product.findUniqueOrThrow({
          where: { id: id(`product:${store.key}:${key}`) },
        });
        expect(product.categoryId).toBe(
          id(`visual-category:${store.key}:${key}`),
        );
        expect(product.brandId).toBe(id(`visual-brand:${store.key}`));
      }
    });
    it(`${store.key}: supplies mobile banner, featured and new-arrival sections`, async () => {
      const response = await get('/home?platform=mobile', store.key);
      expect(response.status).toBe(200);
      const home = homeSchema.parse(response.body.data);
      expect(home.banners).toHaveLength(1);
      expect(home.banners[0]?.targetId).toBe(
        id(`visual-featured:${store.key}`),
      );
      expect(home.banners[0]?.mobileImageUrl).toBe(
        developmentMedia(store.key, 'everyday-edit-mobile').url,
      );
      for (const type of ['FEATURED_PRODUCTS', 'NEW_ARRIVALS']) {
        const products = home.sections.find(
          (section) => section.type === type,
        )?.products;
        expect(products).toHaveLength(3);
        expect(
          products?.every((product) =>
            product.image?.includes(`/development-v82/${store.key}/`),
          ),
        ).toBe(true);
      }
    });
  }

  it('serves every checked-in WebP through the existing static route', async () => {
    for (const store of developmentStores)
      for (const file of [
        'tee-front',
        'tee-detail',
        'denim-front',
        'denim-detail',
        'shoes-front',
        'shoes-detail',
        'identity',
        'everyday-edit',
        'everyday-edit-mobile',
      ]) {
        const path = `/uploads/development-v82/${store.key}/${file}.webp`;
        const asset = await request(app).get(path);
        expect(asset.status, path).toBe(200);
        expect(asset.headers['content-type']).toBe('image/webp');
        const bytes = await readFile(
          `public/seed-media/${store.key}/${file}.webp`,
        );
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
        expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
        expect(bytes.byteLength).toBeLessThan(100_000);
      }
  });

  it('resolves every API media reference locally with outbound fetch unavailable', async () => {
    const outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Internet unavailable'));
    try {
      const references = new Set<string>();
      function collect(value: unknown) {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          for (const item of value) collect(item);
          return;
        }
        for (const [key, item] of Object.entries(value)) {
          if (
            ['url', 'imageUrl', 'mobileImageUrl', 'logoUrl', 'image'].includes(
              key,
            ) &&
            typeof item === 'string'
          ) {
            expect(item).toMatch(
              /^\/uploads\/development-v82\/(fashion|independent)\/[a-z0-9-]+\.webp$/,
            );
            references.add(item);
          } else collect(item);
        }
      }
      for (const store of developmentStores) {
        for (const route of [
          '/storefront',
          '/home?platform=mobile',
          '/products',
          '/categories',
          '/brands',
        ]) {
          const response = await get(route, store.key);
          expect(response.status).toBe(200);
          collect(response.body.data);
        }
        for (const key of ['tee', 'denim', 'shoes'])
          collect(
            (
              await get(
                `/products/${id(`product:${store.key}:${key}`)}`,
                store.key,
              )
            ).body.data,
          );
      }
      expect(references.size).toBe(18);
      for (const reference of references) {
        const response = await request(app).get(reference);
        expect(response.status, reference).toBe(200);
        expect(response.headers['content-type']).toBe('image/webp');
        expect(
          await readFile(
            `public/seed-media/${reference.replace('/uploads/development-v82/', '')}`,
          ),
        ).toEqual(response.body);
        for (const origin of [
          'http://10.0.2.2:3000',
          'http://localhost:3000',
          'http://device-accessible-backend.test:3000',
        ]) {
          const resolved = new URL(reference, origin);
          expect(resolved.origin).toBe(origin);
          expect(resolved.pathname).toBe(reference);
        }
      }
      expect(outbound).not.toHaveBeenCalled();
    } finally {
      outbound.mockRestore();
    }
  });

  it('rejects traversal and serves only public WebP artwork', async () => {
    for (const path of [
      '/uploads/development-v82/%2e%2e/%2e%2e/.env',
      '/uploads/development-v82/fashion/../../../package.json',
      '/uploads/development-v82/README.md',
      '/uploads/development-v82/fashion/tee-front.svg',
      '/uploads/development-v82/fashion/missing.webp',
    ]) {
      const response = await request(app).get(path);
      expect(response.status, path).toBe(404);
      expect(response.body).toMatchObject({
        success: false,
        code: 'ROUTE_NOT_FOUND',
        data: null,
      });
    }
  });

  it('serves bundled media after two backend process starts with an unrelated upload directory', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
        import app from './src/app.ts';
        const server = app.listen(0, '127.0.0.1', () => process.send({port: server.address().port}));
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `,
        ],
        {
          env: {
            ...process.env,
            UPLOAD_DIR: `/tmp/unused-seed-upload-${randomUUID()}`,
          },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      try {
        const [message] = await once(child, 'message');
        const { port } = z.object({ port: z.number() }).parse(message);
        for (const store of developmentStores)
          for (const file of [
            'tee-front',
            'tee-detail',
            'denim-front',
            'denim-detail',
            'shoes-front',
            'shoes-detail',
            'identity',
            'everyday-edit',
            'everyday-edit-mobile',
          ]) {
            const response = await request(`http://127.0.0.1:${port}`).get(
              developmentMedia(store.key, file).url,
            );
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toBe('image/webp');
          }
      } finally {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
    }
  }, 15000);

  it('keeps bundled shared artwork intact when a merchant removes its media reference', async () => {
    const key = 'development-v82/fashion/tee-front.webp';
    const before = await readFile(
      `public/seed-media/${key.replace('development-v82/', '')}`,
    );
    await createLocalStorageService().delete(key);
    expect(
      await readFile(
        `public/seed-media/${key.replace('development-v82/', '')}`,
      ),
    ).toEqual(before);
    expect((await request(app).get(`/uploads/${key}`)).status).toBe(200);
  });

  it('keeps product, category, brand and Home references in the selected tenant', async () => {
    for (const route of ['products', 'categories', 'brands']) {
      const foreign = id(
        route === 'products'
          ? 'product:independent:tee'
          : route === 'categories'
            ? 'visual-category:independent:tee'
            : 'visual-brand:independent',
      );
      expect((await get(`/${route}/${foreign}`)).status).toBe(404);
    }
    const home = homeSchema.parse(
      (await get('/home?platform=mobile')).body.data,
    );
    const allowed = new Set(
      ['tee', 'denim', 'shoes'].map((key) => id(`product:fashion:${key}`)),
    );
    expect(
      home.sections
        .flatMap((section) => section.products)
        .every((product) => allowed.has(product.id)),
    ).toBe(true);
    expect(home.brands.map((brand) => brand.id)).toEqual([
      id('visual-brand:fashion'),
    ]);
    expect(
      home.categories.every((category) =>
        category.imageUrl?.includes('/fashion/'),
      ),
    ).toBe(true);
  });

  it('repeats without duplicates or resetting warehouse stock, reservations and policies', async () => {
    const snapshot = async () => ({
      images: await db.productImage.findMany({ orderBy: { id: 'asc' } }),
      variants: await db.productVariantImage.findMany({
        orderBy: { id: 'asc' },
      }),
      stock: await db.inventory.findMany({
        where: { tenantId: { in: tenantIds } },
        orderBy: { id: 'asc' },
      }),
      policy: await db.tenantOrderPolicy.findMany({
        where: { tenantId: { in: tenantIds } },
        orderBy: { tenantId: 'asc' },
      }),
      banners: await db.banner.findMany({
        where: { tenantId: { in: tenantIds } },
        orderBy: { id: 'asc' },
      }),
    });
    const before = await snapshot();
    expect(before.images).toHaveLength(12);
    expect(before.variants).toHaveLength(12);
    expect(before.stock).toHaveLength(18);
    await seedDevelopment(db, password);
    expect(await snapshot()).toEqual(before);
  });

  it('converts known legacy fixture origins to relative paths without changing relationships', async () => {
    const imageId = id('visual-product:fashion:tee:front');
    const original = await db.productImage.findUniqueOrThrow({
      where: { id: imageId },
    });
    await db.productImage.update({
      where: { id: imageId },
      data: { url: `http://old-development-host.test${original.url}` },
    });
    const variantId = id('visual-variant:' + id('variant:fashion:tee:small'));
    const variant = await db.productVariantImage.findUniqueOrThrow({
      where: { id: variantId },
    });
    await db.productVariantImage.update({
      where: { id: variantId },
      data: { url: `http://old-development-host.test${variant.url}` },
    });
    await db.tenant.update({
      where: { id: tenantIds[0] },
      data: {
        logoUrl:
          'http://old-development-host.test' +
          developmentMedia('fashion', 'identity').url,
      },
    });
    await seedDevelopment(db, password);
    expect(
      (await db.productImage.findUniqueOrThrow({ where: { id: imageId } })).url,
    ).toBe(original.url);
    expect(
      (
        await db.productVariantImage.findUniqueOrThrow({
          where: { id: variantId },
        })
      ).url,
    ).toBe(variant.url);
    expect((await get('/storefront')).body.data.logoUrl).toBe(
      developmentMedia('fashion', 'identity').url,
    );
    expect(
      (await db.productImage.findUniqueOrThrow({ where: { id: imageId } }))
        .productId,
    ).toBe(original.productId);
  });

  it('restores a missing fixture gallery without replacing an edited primary', async () => {
    const primary = id('visual-product:fashion:tee:front');
    const detail = id('visual-product:fashion:tee:detail');
    await db.productImage.update({
      where: { id: primary },
      data: {
        url: 'https://merchant.example.test/custom.webp',
        altText: 'Merchant edit',
        sortOrder: 7,
      },
    });
    const before = await db.productImage.findUniqueOrThrow({
      where: { id: primary },
    });
    await db.productImage.delete({ where: { id: detail } });
    await seedDevelopment(db, password);
    expect(
      await db.productImage.findUnique({ where: { id: primary } }),
    ).toEqual(before);
    expect(
      await db.productImage.count({
        where: { productId: id('product:fashion:tee') },
      }),
    ).toBe(2);
    expect((await get('/products')).body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: id('product:fashion:tee'),
          primaryImage: expect.objectContaining({ url: before.url }),
        }),
      ]),
    );
  });

  it('preserves merchant replacements, store/category/brand/banner edits and custom settings', async () => {
    const productId = id('product:fashion:denim');
    await db.productImage.deleteMany({ where: { productId } });
    await db.productImage.create({
      data: {
        productId,
        storageKey: 'merchant/custom.webp',
        url: 'https://merchant.example.test/denim.webp',
        isPrimary: true,
      },
    });
    await db.tenant.update({
      where: { id: tenantIds[0] },
      data: {
        name: 'Merchant name',
        logoUrl: 'https://merchant.example.test/logo.webp',
      },
    });
    await db.category.update({
      where: { id: id('visual-category:fashion:tee') },
      data: { imageUrl: 'https://merchant.example.test/category.webp' },
    });
    await db.brand.update({
      where: { id: id('visual-brand:fashion') },
      data: { imageUrl: 'https://merchant.example.test/brand.webp' },
    });
    await db.banner.update({
      where: { id: id('visual-banner:fashion') },
      data: { isActive: false, title: 'Merchant title' },
    });
    await db.appSetting.create({
      data: {
        tenantId: tenantIds[0]!,
        key: 'private-visual-setting',
        value: { secret: 'private' },
        isPublic: false,
      },
    });
    await seedDevelopment(db, password);
    expect(await db.productImage.count({ where: { productId } })).toBe(1);
    expect(
      (await db.productImage.findFirstOrThrow({ where: { productId } })).url,
    ).toBe('https://merchant.example.test/denim.webp');
    const storefront = await get('/storefront');
    expect(storefront.body.data.name).toBe('Merchant name');
    expect(storefront.body.data.logoUrl).toBe(
      'https://merchant.example.test/logo.webp',
    );
    expect(JSON.stringify(storefront.body.data.settings)).not.toContain(
      'private',
    );
    expect(
      (await get('/categories/' + id('visual-category:fashion:tee'))).body.data
        .imageUrl,
    ).toBe('https://merchant.example.test/category.webp');
    expect(
      (await get('/brands/' + id('visual-brand:fashion'))).body.data.imageUrl,
    ).toBe('https://merchant.example.test/brand.webp');
    expect((await get('/home?platform=mobile')).body.data.banners).toEqual([]);
  });

  it('retains nullable image contracts for products without media', async () => {
    const productId = id('product:independent:shoes');
    await db.productImage.deleteMany({ where: { productId } });
    const cards = z
      .object({ items: z.array(cardSchema) })
      .parse((await get('/products', 'independent')).body.data).items;
    expect(
      cards.find((card) => card.id === productId)?.primaryImage,
    ).toBeNull();
    expect(
      productSchema.parse(
        (await get(`/products/${productId}`, 'independent')).body.data,
      ).images,
    ).toEqual([]);
  });
});
