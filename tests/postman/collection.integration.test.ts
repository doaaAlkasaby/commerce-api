import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect as chaiExpect } from 'chai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import app from '../../src/app.js';
import { hashPassword } from '../../src/common/security/password.js';
import { env } from '../../src/config/env.js';
import { discoverRoutes } from '../../scripts/postman/routes.js';
import { testPrisma as db } from '../../src/config/test-database.js';
import {
  developmentId,
  developmentStores,
  seedDevelopment,
} from '../../prisma/development/seed.js';
import {
  readCollection,
  resolveVariables,
  verify,
} from '../../scripts/postman/verify.js';

const artifactDirectory = process.env.POSTMAN_TEST_ARTIFACT_DIR ?? 'postman';
const collection = readCollection(artifactDirectory),
  items = collection.item.flatMap((folder) => folder.item);
const variables = Object.fromEntries(
  collection.variable.map((item) => [item.key, item.value]),
);
let countriesBefore: string[] = [];
const tenantIds = developmentStores.map(({ key }) =>
  developmentId(`tenant:${key}`),
);
const accounts = [
  'admin@example.com',
  'manager@example.com',
  'customer1@example.com',
  'customer2@example.com',
].map((key) => developmentId(`user:${key}`));
describe('canonical Postman contracts and safe HTTP smoke', () => {
  beforeAll(async () => {
    countriesBefore = (
      await db.country.findMany({ select: { code: true } })
    ).map((row) => row.code);
    await seedDevelopment(db, `Postman!${randomUUID()}Aa1`);
  });
  afterAll(async () => {
    await db.inventory.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.warehouse.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.taxRule.deleteMany({
      where: { taxCategory: { tenantId: { in: tenantIds } } },
    });
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.user.deleteMany({ where: { id: { in: accounts } } });
    await db.country.deleteMany({
      where: {
        code: {
          in: ['KW', 'SA', 'EG'].filter(
            (code) => !countriesBefore.includes(code),
          ),
        },
      },
    });
    await db.$disconnect();
  });
  it('validates official schema, full route parity, Zod bodies/queries/params and secrets', async () => {
    expect(await verify(artifactDirectory)).toEqual({
      routes: discoverRoutes().length,
      requests: discoverRoutes().length + 54 + 2,
    });
  });
  it('independently checks the runtime Express tree includes every inventoried route', () => {
    function count(handle: unknown): number {
      if (
        (typeof handle !== 'function' && typeof handle !== 'object') ||
        handle === null
      )
        return 0;
      const stack: unknown = Reflect.get(handle, 'stack');
      if (!Array.isArray(stack)) return 0;
      return stack.reduce((sum: number, layer: unknown) => {
        if (!layer || typeof layer !== 'object') return sum;
        const route: unknown = Reflect.get(layer, 'route');
        if (route && typeof route === 'object')
          return (
            sum +
            Object.keys(
              z
                .record(z.string(), z.boolean())
                .parse(Reflect.get(route, 'methods')),
            ).length
          );
        return sum + count(Reflect.get(layer, 'handle'));
      }, 0);
    }
    const mockRoutes = new Set([
      'GET /{{apiPrefix}}/payments/mock/checkout/:id',
      'POST /{{apiPrefix}}/payments/mock/checkout/:id/scenario',
    ]);
    const runtimeRoutes = discoverRoutes().filter(
      ({ method, path }) =>
        !mockRoutes.has(`${method} ${path}`) ||
        (env.PAYMENT_PROVIDER === 'MOCK' &&
          process.env.NODE_ENV !== 'production'),
    );
    // The explicit docs.json route is outside discoverRoutes; static mounts
    // are middleware and do not add runtime route methods.
    expect(count(Reflect.get(app, 'router'))).toBe(runtimeRoutes.length + 1);
    expect(
      runtimeRoutes.map(({ method, path }) => `${method} ${path}`),
    ).toEqual(
      expect.arrayContaining([
        'GET /{{apiPrefix}}/storefront/tenants',
        'GET /{{apiPrefix}}/merchant/products',
        'GET /{{apiPrefix}}/merchant/products/:id',
        'POST /{{apiPrefix}}/product-variants/default',
        'POST /{{apiPrefix}}/orders/:id/cod/confirm-payment',
        'POST /{{apiPrefix}}/orders/:id/cod/mark-refused',
        'POST /{{apiPrefix}}/orders/:id/cod/confirm-return',
      ]),
    );
  });
  it('guards every mutation and the side-effecting cart/verification GETs by default', () => {
    const stopped = Symbol('skip');
    for (const item of items.filter(
      (item) =>
        item.request.method !== 'GET' ||
        item.name.includes('/cart') ||
        item.name.includes('/auth/verify-email'),
    )) {
      const script = item.event
        .find((event) => event.listen === 'prerequest')
        ?.script.exec.join('\n');
      expect(script, item.name).toBeTruthy();
      expect(() =>
        new vm.Script(script!).runInNewContext({
          pm: {
            variables: { get: (key: string) => variables[key] },
            execution: {
              skipRequest: () => {
                throw stopped;
              },
            },
          },
        }),
      ).toThrow(stopped);
    }
  });
  it('keeps customer and merchant token pairs separate and rotates only the selected profile', () => {
    const data: Record<string, string> = {
      authProfile: 'customer',
      ownerAccessToken: 'synthetic-owner',
      ownerRefreshToken: 'synthetic-owner-refresh',
    };
    for (const endpoint of ['POST /auth/login', 'POST /auth/refresh']) {
      const script = items
        .find((item) => item.name === endpoint)!
        .event.find((event) => event.listen === 'test')!
        .script.exec.join('\n');
      const payload = {
        success: true,
        message: null,
        data: {
          accessToken: 'synthetic-customer-rotated',
          refreshToken: 'synthetic-customer-refresh-rotated',
        },
      };
      new vm.Script(script).runInNewContext({
        pm: {
          test: (_name: string, fn: () => void) => fn(),
          expect: chaiExpect,
          response: { code: 200, json: () => payload },
          variables: { get: (key: string) => data[key] },
          environment: {
            set: (key: string, value: string) => {
              data[key] = value;
            },
          },
        },
      });
      expect(data.customerRefreshToken).toBe(
        'synthetic-customer-refresh-rotated',
      );
      expect(data.ownerAccessToken).toBe('synthetic-owner');
      expect(data.ownerRefreshToken).toBe('synthetic-owner-refresh');
    }
  });
  it('uses candidate bearer metadata for protected catalog reads with an independent account', async () => {
    const id = developmentId('test:postman:catalog-manager');
    const email = 'catalog-manager@automated-postman.example.test';
    const password = `PostmanTest!${randomUUID()}Aa1`;
    await db.user.create({
      data: {
        id,
        email,
        passwordHash: await hashPassword(password),
        firstName: 'Postman',
        lastName: 'Fixture',
        emailVerifiedAt: new Date(),
        tenantMemberships: {
          create: { tenantId: tenantIds[0]!, role: 'MANAGER' },
        },
      },
    });
    try {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      const token = z.string().parse(login.body.data.accessToken);
      for (const name of [
        'GET /product-images/:id',
        'GET /merchant/products',
        'GET /merchant/products/:id',
      ]) {
        const item = items.find((item) => item.name === name);
        expect(item?.request.auth.type).toBe('bearer');
        expect(item?.request.header).toContainEqual({
          key: 'X-Tenant-Slug',
          value: '{{tenantSlug}}',
        });
        const url = resolveVariables(
          item!.request.url.raw.replace('{{baseUrl}}', ''),
          variables,
        );
        const call = (tenantSlug = variables.tenantSlug!) =>
          request(app).get(url).set('X-Tenant-Slug', tenantSlug);
        await call().expect(401);
        await call().auth(token, { type: 'bearer' }).expect(200);
        if (name === 'GET /merchant/products/:id') {
          await call()
            .query({ unexpected: 'value' })
            .auth(token, { type: 'bearer' })
            .expect(400);
          await call(variables.secondTenantSlug)
            .auth(token, { type: 'bearer' })
            .expect(401);
        }
      }
    } finally {
      await db.user.delete({ where: { id } });
    }
  });

  for (const environment of ['local', 'independent'])
    it(`executes public read-only ${environment} requests and their assertions over actual HTTP`, async () => {
      const env = z
        .object({
          values: z.array(z.object({ key: z.string(), value: z.string() })),
        })
        .parse(
          JSON.parse(
            await readFile(
              join(
                artifactDirectory,
                `commerce-api.${environment}.postman_environment.json`,
              ),
              'utf8',
            ),
          ),
        );
      const vars = Object.fromEntries(
        env.values.map((item) => [item.key, item.value]),
      );
      const mockCheckout = 'GET /payments/mock/checkout/:id';
      const publicGetCandidates = items.filter(
        (item) =>
          item.request.method === 'GET' &&
          item.request.auth.type === 'noauth' &&
          !item.name.includes('/auth/verify-email') &&
          !item.name.includes('/cart'),
      );
      const publicDiscovery = 'GET /storefront/tenants';
      expect(publicGetCandidates.map(({ name }) => name)).toEqual(
        expect.arrayContaining([mockCheckout, publicDiscovery]),
      );
      const safe = publicGetCandidates.filter(
        ({ name }) => name !== mockCheckout,
      );
      expect(
        safe.filter(({ name }) =>
          name.startsWith('GET /uploads/development-v82/'),
        ),
      ).toHaveLength(54);
      expect(safe.some(({ name }) => name === 'GET /product-images/:id')).toBe(
        false,
      );
      for (const item of safe) {
        const url = resolveVariables(
          item.request.url.raw.replace('{{baseUrl}}', ''),
          vars,
        );
        let pending = request(app).get(url);
        for (const header of item.request.header)
          pending = pending.set(
            header.key,
            resolveVariables(header.value, vars),
          );
        const response = await pending;
        expect(response.status, item.name).toBe(200);
        for (const event of item.event.filter(
          (event) => event.listen === 'test',
        ))
          new vm.Script(event.script.exec.join('\n')).runInNewContext({
            pm: {
              test: (_name: string, fn: () => void) => fn(),
              expect: chaiExpect,
              response: {
                code: response.status,
                json: () => response.body,
                headers: {
                  get: (name: string) => response.headers[name.toLowerCase()],
                },
                to: {
                  have: {
                    status: (expected: number) =>
                      expect(response.status).toBe(expected),
                  },
                },
              },
              variables: { get: (key: string) => vars[key] },
              environment: {
                set: (key: string, value: string) => {
                  vars[key] = value;
                },
              },
            },
          });
      }
      expect(
        await db.order.count({ where: { tenantId: { in: tenantIds } } }),
      ).toBe(0);
      expect(
        await db.cart.count({ where: { tenantId: { in: tenantIds } } }),
      ).toBe(0);
    });
});
