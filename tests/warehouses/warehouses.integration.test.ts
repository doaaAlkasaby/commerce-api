import { deleteFixtureTenants } from '../helpers/warehouse.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { testPrisma } from '../../src/config/test-database.js';
import { createAccessToken } from '../../src/common/security/jwt.js';

describe('tenant warehouse management', () => {
  const marker = randomUUID();
  const slug = `warehouse-${marker}`;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let token: string;
  let customerToken: string;
  let customerId: string;
  let firstId: string;
  let countryCreated = false;
  const payload = {
    code: 'main',
    name: 'Main',
    countryCode: 'KW',
    city: 'City',
    address: 'Street',
    isDefault: true,
  };
  const api = () => request(app);
  beforeAll(async () => {
    const country = await testPrisma.country.findUnique({
      where: { code: 'KW' },
    });
    if (!country) {
      await testPrisma.country.create({
        data: { code: 'KW', name: 'Kuwait', currencyCode: 'KWD' },
      });
      countryCreated = true;
    }
    for (const suffix of ['owner', 'customer']) {
      const user = await testPrisma.user.create({
        data: {
          email: `${marker}-${suffix}@example.com`,
          passwordHash: 'unused',
          firstName: 'Test',
          lastName: 'Warehouse',
        },
      });
      if (suffix === 'owner') {
        userId = user.id;
        token = await createAccessToken(user.id);
      } else {
        customerId = user.id;
        customerToken = await createAccessToken(user.id);
      }
    }
    const tenant = await testPrisma.tenant.create({
      data: { name: 'Warehouse', slug, code: marker, defaultCurrency: 'KWD' },
    });
    tenantId = tenant.id;
    otherTenantId = (
      await testPrisma.tenant.create({
        data: { name: 'Other', slug: `${slug}-other`, code: `${marker}-other` },
      })
    ).id;
    await testPrisma.tenantMember.createMany({
      data: [
        { tenantId, userId, role: 'OWNER' },
        { tenantId, userId: customerId, role: 'CUSTOMER' },
        { tenantId: otherTenantId, userId, role: 'OWNER' },
      ],
    });
  });
  afterAll(async () => {
    await testPrisma.warehouse.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.tenantMember.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await deleteFixtureTenants({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: [userId, customerId] } },
    });
    if (countryCreated)
      await testPrisma.country.delete({ where: { code: 'KW' } });
    await testPrisma.$disconnect();
  });
  it('creates a warehouse without exposing it to guests or customers', async () => {
    expect(
      (await api().get('/api/v1/warehouses').set('X-Tenant-Slug', slug)).status,
    ).toBe(401);
    expect(
      (
        await api()
          .post('/api/v1/warehouses')
          .set('X-Tenant-Slug', slug)
          .auth(customerToken, { type: 'bearer' })
          .send(payload)
      ).status,
    ).toBe(403);
    const result = await api()
      .post('/api/v1/warehouses')
      .set('X-Tenant-Slug', slug)
      .auth(token, { type: 'bearer' })
      .send(payload);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      success: true,
      data: { ...payload, tenantId, latitude: null, longitude: null },
    });
    firstId = result.body.data.id;
  });
  it('scopes reads and updates to the resolved tenant', async () => {
    expect(
      (
        await api()
          .get(`/api/v1/warehouses/${firstId}`)
          .set('X-Tenant-Slug', `${slug}-other`)
          .auth(token, { type: 'bearer' })
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .patch(`/api/v1/warehouses/${firstId}`)
          .set('X-Tenant-Slug', `${slug}-other`)
          .auth(token, { type: 'bearer' })
          .send({ name: 'Stolen' })
      ).status,
    ).toBe(404);
    const list = await api()
      .get('/api/v1/warehouses')
      .set('X-Tenant-Slug', `${slug}-other`)
      .auth(token, { type: 'bearer' });
    expect(list.body.data).toEqual([]);
  });
  it('permits multiple warehouses in one country and transfers the default atomically', async () => {
    const result = await api()
      .post('/api/v1/warehouses')
      .set('X-Tenant-Slug', slug)
      .auth(token, { type: 'bearer' })
      .send({ ...payload, code: 'second' });
    expect(result.status).toBe(201);
    expect(
      await testPrisma.warehouse.count({
        where: { tenantId, isDefault: true },
      }),
    ).toBe(1);
    expect(
      (await testPrisma.warehouse.findUniqueOrThrow({ where: { id: firstId } }))
        .isDefault,
    ).toBe(false);
  });
  it('rejects duplicate tenant codes and incomplete coordinates', async () => {
    expect(
      (
        await api()
          .post('/api/v1/warehouses')
          .set('X-Tenant-Slug', slug)
          .auth(token, { type: 'bearer' })
          .send(payload)
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post('/api/v1/warehouses')
          .set('X-Tenant-Slug', slug)
          .auth(token, { type: 'bearer' })
          .send({ ...payload, code: 'coords', latitude: 10 })
      ).status,
    ).toBe(400);
  });
  it('protects coordinates and default activity at the database boundary', async () => {
    await expect(
      testPrisma.warehouse.update({
        where: { id: firstId },
        data: { latitude: 91, longitude: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      testPrisma.warehouse.update({
        where: { id: firstId },
        data: { isDefault: true, isActive: false },
      }),
    ).rejects.toThrow();
  });
  it('preserves the default designation when editing branding and exposes tenant policy safely', async () => {
    const current = await testPrisma.warehouse.findFirstOrThrow({
      where: { tenantId, isDefault: true },
    });
    const updated = await api()
      .patch(`/api/v1/warehouses/${current.id}`)
      .set('X-Tenant-Slug', slug)
      .auth(token, { type: 'bearer' })
      .send({ name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isDefault).toBe(true);
    const denied = await api()
      .patch('/api/v1/order-policy')
      .set('X-Tenant-Slug', slug)
      .auth(customerToken, { type: 'bearer' })
      .send({ maxOrderItems: 5 });
    expect(denied.status).toBe(403);
    const policy = await api()
      .patch('/api/v1/order-policy')
      .set('X-Tenant-Slug', slug)
      .auth(token, { type: 'bearer' })
      .send({ maxOrderItems: 5, maxDistinctItems: 3 });
    expect(policy.status).toBe(200);
    expect(policy.body.data).toMatchObject({
      currency: 'KWD',
      maxOrderItems: 5,
      maxDistinctItems: 3,
    });
    const fetched = await api()
      .get('/api/v1/order-policy')
      .set('X-Tenant-Slug', slug)
      .auth(token, { type: 'bearer' });
    expect(fetched.body.data).toEqual(policy.body.data);
    expect(
      (
        await api()
          .patch('/api/v1/order-policy')
          .set('X-Tenant-Slug', slug)
          .auth(token, { type: 'bearer' })
          .send({ maxOrderItems: 0 })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .patch('/api/v1/order-policy')
          .set('X-Tenant-Slug', slug)
          .auth(token, { type: 'bearer' })
          .send({ currency: 'USD' })
      ).status,
    ).toBe(400);
  });
});
