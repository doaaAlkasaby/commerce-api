import { emailVerificationService } from '../../src/modules/auth/email-verification.service.instance.js';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ipKeyGenerator } from 'express-rate-limit';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { testPrisma } from '../../src/config/test-database.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { hashPassword } from '../../src/common/security/password.js';
import {
  generateSecureToken,
  hashToken,
} from '../../src/common/security/token.js';
import { authService } from '../../src/modules/auth/auth.service.instance.js';
import { passwordResetService } from '../../src/modules/auth/password-reset.service.instance.js';
import { PostgresRateStore } from '../../src/common/rate-limit/postgres-rate-store.js';
import {
  globalRateLimiter,
  authRateLimiter,
} from '../../src/config/rate-limit.js';
import { createLocalStorageService } from '../../src/common/storage/local-storage.service.js';
import { logger } from '../../src/common/logger/logger.js';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';
import { validateImageBuffer } from '../../src/common/storage/image-validation.js';
import { securityConfigurationSchema } from '../../src/config/security-options.js';

const marker = `security-${randomUUID()}`;
const countryCode = `S${randomUUID().slice(0, 7)}`.toUpperCase();
const prefix = `security-${randomUUID()}`;
const password = 'SecurityPassword123!';
let owner: string,
  customer: string,
  administrator: string,
  outsider: string,
  tenantId: string,
  otherTenantId: string,
  productId: string,
  foreignProductId: string,
  ownerPayment: string,
  foreignPayment: string,
  token: string,
  customerToken: string,
  adminToken: string,
  outsiderToken: string;

const auth = (endpoint: string) =>
  request(app)
    .get(endpoint)
    .auth(token, { type: 'bearer' })
    .set('X-Tenant-Slug', marker)
    .set('X-Country-Code', countryCode);
async function clearRateMemory() {
  for (const address of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
    const ip = ipKeyGenerator(address);
    globalRateLimiter.resetKey(ip);
    for (const endpoint of [
      '/login',
      '/forgot-password',
      '/register',
      '/verify-email',
      '/refresh',
    ])
      authRateLimiter.resetKey(`${endpoint}:${ip}`);
  }
}

describe('security boundaries against PostgreSQL', () => {
  beforeAll(async () => {
    const hash = await hashPassword(password);
    for (const kind of ['owner', 'customer', 'administrator', 'outsider']) {
      const user = await testPrisma.user.create({
        data: {
          email: `${marker}-${kind}@example.test`,
          passwordHash: hash,
          firstName: 'Security',
          lastName: kind,
          emailVerifiedAt: new Date(),
          role: kind === 'administrator' ? 'ADMIN' : 'CUSTOMER',
        },
      });
      if (kind === 'owner') owner = user.id;
      if (kind === 'customer') customer = user.id;
      if (kind === 'administrator') administrator = user.id;
      if (kind === 'outsider') outsider = user.id;
    }
    token = await createAccessToken(owner);
    customerToken = await createAccessToken(customer);
    adminToken = await createAccessToken(administrator);
    outsiderToken = await createAccessToken(outsider);
    await testPrisma.country.create({
      data: { code: countryCode, name: marker, currencyCode: 'USD' },
    });
    for (const suffix of ['', '-other']) {
      const tenant = await testPrisma.tenant.create({
        data: {
          name: marker + suffix,
          slug: marker + suffix,
          code: marker + suffix,
          defaultCountryCode: countryCode,
          defaultCurrency: 'USD',
        },
      });
      if (suffix) otherTenantId = tenant.id;
      else tenantId = tenant.id;
      const category = await testPrisma.category.create({
        data: { tenantId: tenant.id, name: marker, slug: marker },
      });
      const product = await testPrisma.product.create({
        data: {
          tenantId: tenant.id,
          categoryId: category.id,
          name: 'Security product',
          slug: marker,
          basePrice: '12.34',
          status: 'ACTIVE',
        },
      });
      if (suffix) foreignProductId = product.id;
      else productId = product.id;
    }
    for (const foreign of [false, true]) {
      const order = await testPrisma.order.create({
        data: {
          tenantId: foreign ? otherTenantId : tenantId,
          userId: foreign ? outsider : owner,
          orderNumber: randomUUID(),
          currency: 'USD',
          subtotal: '12.34',
          discountAmount: 0,
          shippingAmount: 0,
          taxAmount: 0,
          totalAmount: '12.34',
          shippingAddress: {},
          billingAddress: {},
        },
      });
      const payment = await testPrisma.payment.create({
        data: {
          orderId: order.id,
          provider: 'NONE',
          method: 'CARD',
          amount: '12.34',
          currency: 'USD',
          initiationState: 'NOT_STARTED',
        },
      });
      if (foreign) foreignPayment = payment.id;
      else ownerPayment = payment.id;
    }
    await testPrisma.tenantMember.createMany({
      data: [
        { tenantId, userId: owner, role: 'OWNER' },
        { tenantId, userId: customer, role: 'CUSTOMER' },
        { tenantId: otherTenantId, userId: outsider, role: 'OWNER' },
      ],
    });
  });
  beforeEach(clearRateMemory);
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await testPrisma.rateLimitBucket.deleteMany({
      where: { key: { startsWith: prefix } },
    });
    await testPrisma.emailVerificationToken.deleteMany({
      where: { userId: { in: [owner, customer, administrator, outsider] } },
    });
    await testPrisma.passwordResetToken.deleteMany({
      where: { userId: { in: [owner, customer, administrator, outsider] } },
    });
    await testPrisma.refreshToken.deleteMany({
      where: { userId: { in: [owner, customer, administrator, outsider] } },
    });
    await testPrisma.payment.deleteMany({
      where: { order: { tenantId: { in: [tenantId, otherTenantId] } } },
    });
    await testPrisma.order.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.product.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.category.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.tenantMember.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: [owner, customer, administrator, outsider] } },
    });
    await testPrisma.country.delete({ where: { code: countryCode } });
    await testPrisma.$disconnect();
  });
  it.each(['signature', 'expired', 'algorithm', 'no-expiry'])(
    'rejects invalid JWT %s',
    async (kind) => {
      const jwt = new SignJWT({ type: 'access' })
        .setSubject(owner)
        .setIssuedAt()
        .setProtectedHeader({ alg: kind === 'algorithm' ? 'HS384' : 'HS256' });
      if (kind !== 'no-expiry')
        jwt.setExpirationTime(kind === 'expired' ? '0s' : '5m');
      const value = await jwt.sign(
        new TextEncoder().encode(
          kind === 'signature'
            ? 'wrong-signing-key-with-thirty-two-characters'
            : env.JWT_ACCESS_SECRET,
        ),
      );
      expect(
        (
          await request(app)
            .get('/api/v1/users/me')
            .auth(value, { type: 'bearer' })
        ).status,
      ).toBe(401);
    },
  );
  it('preserves valid Flutter Bearer authentication and response fields', async () => {
    const response = await auth('/api/v1/users/me');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: owner,
      email: `${marker}-owner@example.test`,
    });
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('rejects missing authentication', async () =>
    expect((await request(app).get('/api/v1/users/me')).status).toBe(401));
  it('rejects extra Bearer header components', async () =>
    expect(
      (
        await request(app)
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${token} extra`)
      ).status,
    ).toBe(401));
  it('rejects a disabled account with a previously issued token', async () => {
    await testPrisma.user.update({
      where: { id: customer },
      data: { isActive: false },
    });
    try {
      expect(
        (
          await request(app)
            .get('/api/v1/users/me')
            .auth(customerToken, { type: 'bearer' })
        ).status,
      ).toBe(403);
    } finally {
      await testPrisma.user.update({
        where: { id: customer },
        data: { isActive: true },
      });
    }
  });
  it.each(['PATCH', 'POST'])(
    'rejects anonymous tenant-management %s',
    async (method) => {
      const response =
        method === 'PATCH'
          ? await request(app)
              .patch(`/api/v1/tenants/${tenantId}`)
              .send({ name: 'stolen' })
          : await request(app)
              .post(`/api/v1/tenants/${tenantId}/members`)
              .send({ userId: outsider, role: 'OWNER' });
      expect(response.status).toBe(401);
      expect(
        (await testPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }))
          .name,
      ).toBe(marker);
    },
  );
  it('prevents customers and foreign owners from editing tenant settings', async () => {
    expect(
      (
        await request(app)
          .get(`/api/v1/tenants/${tenantId}/members`)
          .auth(customerToken, { type: 'bearer' })
      ).status,
    ).toBe(403);
    for (const value of [customerToken, outsiderToken])
      expect(
        (
          await request(app)
            .patch(`/api/v1/tenants/${tenantId}`)
            .auth(value, { type: 'bearer' })
            .send({ name: 'stolen' })
        ).status,
      ).toBe(403);
  });
  it('allows an owner to update its tenant with unchanged response shape', async () => {
    const response = await request(app)
      .patch(`/api/v1/tenants/${tenantId}`)
      .auth(token, { type: 'bearer' })
      .send({ legalName: 'Security legal name' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Tenant updated successfully.',
      data: { id: tenantId, legalName: 'Security legal name' },
    });
  });
  it('requires global administrator permissions for tenant provisioning', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/tenants')
          .auth(token, { type: 'bearer' })
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/tenants')
          .auth(adminToken, { type: 'bearer' })
          .send({})
      ).status,
    ).toBe(400);
  });
  it('returns own tenant memberships at the existing /me path', async () => {
    const response = await request(app)
      .get('/api/v1/tenants/me')
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.any(Array));
  });
  it('blocks cross-tenant reads', async () =>
    expect((await auth(`/api/v1/products/${foreignProductId}`)).status).toBe(
      404,
    ));
  it('blocks cross-tenant writes', async () =>
    expect(
      (
        await request(app)
          .patch(`/api/v1/products/${foreignProductId}`)
          .auth(token, { type: 'bearer' })
          .set('X-Tenant-Slug', marker)
          .set('X-Country-Code', countryCode)
          .send({ name: 'stolen' })
      ).status,
    ).toBe(404));
  it('blocks insufficient tenant roles on catalog writes', async () =>
    expect(
      (
        await request(app)
          .patch(`/api/v1/products/${productId}`)
          .auth(customerToken, { type: 'bearer' })
          .set('X-Tenant-Slug', marker)
          .set('X-Country-Code', countryCode)
          .send({ name: 'stolen' })
      ).status,
    ).toBe(403));
  it('blocks customer access to global administrative operations', async () =>
    expect(
      (
        await request(app)
          .patch(`/api/v1/users/${outsider}/status`)
          .auth(token, { type: 'bearer' })
          .send({ isActive: false })
      ).status,
    ).toBe(403));
  it('blocks cross-tenant and foreign-customer payment reads', async () => {
    expect((await auth(`/api/v1/payments/${foreignPayment}`)).status).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/payments/${ownerPayment}`)
          .auth(customerToken, { type: 'bearer' })
          .set('X-Tenant-Slug', marker)
      ).status,
    ).toBe(404);
    expect((await auth(`/api/v1/payments/${ownerPayment}`)).status).toBe(200);
  });
  it('rejects forged client payment success and amount fields', async () => {
    const response = await request(app)
      .post(`/api/v1/payments/${ownerPayment}/initiate`)
      .auth(token, { type: 'bearer' })
      .set('X-Tenant-Slug', marker)
      .send({ status: 'PAID', amount: '0.01' });
    expect(response.status).toBe(400);
    expect(
      (
        await testPrisma.payment.findUniqueOrThrow({
          where: { id: ownerPayment },
        })
      ).status,
    ).toBe('PENDING');
  });
  it('prevents tenant administrators from granting or modifying ownership', async () => {
    await testPrisma.tenantMember.update({
      where: { tenantId_userId: { tenantId, userId: customer } },
      data: { role: 'ADMIN' },
    });
    try {
      expect(
        (
          await request(app)
            .post(`/api/v1/tenants/${tenantId}/members`)
            .auth(customerToken, { type: 'bearer' })
            .send({ userId: outsider, role: 'OWNER' })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(`/api/v1/tenants/${tenantId}/members/${owner}`)
            .auth(customerToken, { type: 'bearer' })
            .send({ status: 'REMOVED' })
        ).status,
      ).toBe(403);
    } finally {
      await testPrisma.tenantMember.update({
        where: { tenantId_userId: { tenantId, userId: customer } },
        data: { role: 'CUSTOMER' },
      });
    }
  });
  it('strips server-owned profile fields before controllers use the body', async () => {
    const response = await request(app)
      .patch('/api/v1/users/me')
      .auth(token, { type: 'bearer' })
      .send({ firstName: '  Safe  ', role: 'ADMIN', isActive: false });
    expect(response.status).toBe(200);
    const user = await testPrisma.user.findUniqueOrThrow({
      where: { id: owner },
    });
    expect(user.role).toBe('CUSTOMER');
    expect(user.isActive).toBe(true);
    expect(user.firstName).toBe('Safe');
  });
  it.each(['0', '101', '-1', 'nope'])(
    'rejects invalid pagination limit %s',
    async (limit) =>
      expect((await auth(`/api/v1/products?limit=${limit}`)).status).toBe(400),
  );
  it('rejects pagination offsets that exceed database integer bounds', async () => {
    expect(
      (await auth('/api/v1/products?page=9007199254740991&limit=100')).status,
    ).toBe(400);
  });
  it('returns a controlled oversized JSON error', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ password: 'x'.repeat(1100000) });
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      success: false,
      code: 'REQUEST_BODY_TOO_LARGE',
      data: null,
    });
  });
  it('returns a controlled unsupported-charset error', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json; charset=unsupported')
      .send('{}');
    expect(response.status).toBe(415);
    expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
  it('returns controlled malformed JSON without logging its raw body', async () => {
    const logs = vi.spyOn(logger, 'error');
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"private-canary"');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('MALFORMED_JSON');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private-canary');
  });
  it('rejects prototype-pollution properties', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"admin":true}}');
    expect(response.status).toBe(400);
    expect(Object.prototype).not.toHaveProperty('admin');
  });
  it('rejects excessively nested JSON deterministically', async () => {
    let value: unknown = 'end';
    for (let i = 0; i < 66; i++) value = { value };
    expect(
      (await request(app).post('/api/v1/auth/login').send({ value })).status,
    ).toBe(400);
  });
  it('limits login abuse before expensive password work', async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (await request(app).post('/api/v1/auth/login').send({})).status,
      ).toBe(400);
    const response = await request(app).post('/api/v1/auth/login').send({});
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('AUTH_RATE_LIMIT_EXCEEDED');
  });
  it('limits password-reset abuse independently of login', async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (await request(app).post('/api/v1/auth/forgot-password').send({}))
          .status,
      ).toBe(400);
    expect(
      (await request(app).post('/api/v1/auth/forgot-password').send({})).status,
    ).toBe(429);
    expect(
      (await request(app).post('/api/v1/auth/login').send({})).status,
    ).toBe(400);
  });
  it('keeps password-reset account existence responses identical', async () => {
    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `${marker}-owner@example.test` });
    const missing = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `absent-${marker}@example.test` });
    expect(missing.status).toBe(known.status);
    expect(missing.body).toEqual(known.body);
  });
  it('keeps invalid-login responses generic', async () => {
    const known = await authService
      .login({
        email: `${marker}-customer@example.test`,
        password: 'incorrect',
      })
      .catch((error) => error);
    const missing = await authService
      .login({ email: `absent-${marker}@example.test`, password: 'incorrect' })
      .catch((error) => error);
    expect(missing).toMatchObject({
      code: known.code,
      message: known.message,
      statusCode: 401,
    });
  });
  it('serializes concurrent refresh rotation and revokes replayed families', async () => {
    const login = await authService.login({
      email: `${marker}-customer@example.test`,
      password,
    });
    const results = await Promise.allSettled([
      authService.refresh(login.refreshToken),
      authService.refresh(login.refreshToken),
    ]);
    expect(
      results.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await testPrisma.refreshToken.count({
        where: { userId: customer, revokedAt: null },
      }),
    ).toBe(0);
  });
  it('consumes verification tokens once even for already verified users', async () => {
    const raw = generateSecureToken();
    await testPrisma.emailVerificationToken.create({
      data: {
        userId: owner,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const results = await Promise.allSettled([
      emailVerificationService.verifyEmail(raw),
      emailVerificationService.verifyEmail(raw),
    ]);
    expect(
      results.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(1);
  });
  it('consumes password-reset tokens once under concurrent use', async () => {
    const raw = generateSecureToken();
    await testPrisma.passwordResetToken.create({
      data: {
        userId: outsider,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const results = await Promise.allSettled([
      passwordResetService.resetPassword(raw, 'NewSecurityPassword123!'),
      passwordResetService.resetPassword(raw, 'OtherSecurityPassword123!'),
    ]);
    expect(
      results.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(1);
  });
  it('shares atomic request budgets across PostgreSQL store instances', async () => {
    const a = new PostgresRateStore(prefix, testPrisma),
      b = new PostgresRateStore(prefix, testPrisma);
    const values = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? a : b).increment('private-client-address'),
      ),
    );
    expect(
      values.map((value) => value.totalHits).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const rows = await testPrisma.rateLimitBucket.findMany({
      where: { key: { startsWith: prefix } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).not.toContain('private-client-address');
  });
  it('expires shared budgets using database time', async () => {
    const store = new PostgresRateStore(`${prefix}-expiry`, testPrisma);
    await store.increment('client');
    await testPrisma.$executeRaw`UPDATE "RateLimitBucket" SET "resetAt"=clock_timestamp()-interval '1 second' WHERE "key" LIKE ${`${prefix}-expiry:%`}`;
    expect((await store.increment('client')).totalHits).toBe(1);
  });
  it('does not trust arbitrary forwarded IP headers on a direct listener', async () => {
    const fixture = express();
    fixture.set('trust proxy', false);
    fixture.get('/', (req, res) => res.json({ ip: req.ip }));
    const original = await request(fixture).get('/');
    const forged = await request(fixture)
      .get('/')
      .set('X-Forwarded-For', '1.2.3.4');
    expect(forged.body.ip).toBe(original.body.ip);
  });
  it('does not grant browser CORS access to disallowed origins', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://attacker.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('preserves allowed CORS and security headers for valid clients', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', env.CORS_ORIGINS[0]!);
    expect(response.headers['access-control-allow-origin']).toBe(
      env.CORS_ORIGINS[0],
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('sanitizes unexpected exception details in responses and logs', async () => {
    const logs = vi.spyOn(logger, 'error');
    const fixture = express();
    fixture.get('/', () => {
      throw new Error('private-secret-canary');
    });
    fixture.use(errorMiddleware);
    const response = await request(fixture).get('/');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain(
      'private-secret-canary',
    );
    expect(JSON.stringify(logs.mock.calls)).not.toContain(
      'private-secret-canary',
    );
  });
  it('does not log query tokens even when a route is missing', async () => {
    const info = vi.spyOn(logger, 'info'),
      warn = vi.spyOn(logger, 'warn');
    await request(app).get('/not-found?token=private-secret-canary');
    expect(
      JSON.stringify([...info.mock.calls, ...warn.mock.calls]),
    ).not.toContain('private-secret-canary');
  });
  it('rejects invalid image MIME types before storing data', async () => {
    const response = await request(app)
      .post('/api/v1/product-images/upload')
      .auth(token, { type: 'bearer' })
      .set('X-Tenant-Slug', marker)
      .field('productId', productId)
      .attach('image', Buffer.from('<script/>'), {
        filename: 'payload.svg',
        contentType: 'image/svg+xml',
      });
    expect(response.status).toBe(400);
  });
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
    'rejects forged %s image signatures',
    (mime) =>
      expect(() =>
        validateImageBuffer(Buffer.from('not an image'), mime),
      ).toThrow(),
  );
  it.each([
    '../outside',
    '/tmp/outside',
    'products/../../outside',
    'products\\..\\outside',
    'products/%2e%2e/outside',
  ])('rejects unsafe storage path %s', async (key) => {
    await expect(createLocalStorageService().delete(key)).rejects.toMatchObject(
      { code: 'INVALID_STORAGE_KEY' },
    );
  });
  it('prevents deletion through a symlink escaping the upload root', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'commerce-security-'));
    const original = env.UPLOAD_DIR;
    try {
      const root = path.join(temp, 'root'),
        outside = path.join(temp, 'outside');
      await mkdir(root);
      await mkdir(outside);
      await writeFile(path.join(outside, 'private.jpg'), 'preserved');
      await symlink(outside, path.join(root, 'products'), 'dir');
      env.UPLOAD_DIR = root;
      await expect(
        createLocalStorageService().delete('products/private.jpg'),
      ).rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });
      expect(await readFile(path.join(outside, 'private.jpg'), 'utf8')).toBe(
        'preserved',
      );
    } finally {
      env.UPLOAD_DIR = original;
      await rm(temp, { recursive: true, force: true });
    }
  });
  it('rejects script asset URLs and traversal metadata', async () => {
    const response = await request(app)
      .post('/api/v1/product-images')
      .auth(token, { type: 'bearer' })
      .set('X-Tenant-Slug', marker)
      .send({
        productId,
        storageKey: '../outside',
        url: 'javascript:alert(1)',
      });
    expect(response.status).toBe(400);
  });
  it('validates literal trusted proxy networks', () => {
    expect(
      securityConfigurationSchema.safeParse({
        TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128',
      }).success,
    ).toBe(true);
    expect(
      securityConfigurationSchema.safeParse({
        TRUST_PROXY_CIDRS: '0.0.0.0/999',
      }).success,
    ).toBe(false);
    expect(
      securityConfigurationSchema.safeParse({ BODY_LIMIT: 'unlimited' })
        .success,
    ).toBe(false);
    expect(
      securityConfigurationSchema.safeParse({ BODY_LIMIT: '1mb' }).success,
    ).toBe(true);
  });
});
