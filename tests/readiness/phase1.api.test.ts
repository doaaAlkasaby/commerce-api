import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { testPrisma } from '../../src/config/test-database.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { CommerceContextRepository } from '../../src/common/context/commerce-context.repository.js';
import { CommerceContextService } from '../../src/common/context/commerce-context.service.js';
import { AddressRepository } from '../../src/modules/addresses/address.repository.js';

// Uses the same real PostgreSQL client as the existing API tests.
describe('Phase 1 public API compatibility', () => {
  const marker = randomUUID();
  const countryCode = 'P1';
  let userId: string;
  let token: string;
  let tenantId: string;
  let contextTenantId: string;
  const tenantSlug = `phase1-context-${marker}`;
  let addressId: string;

  beforeAll(async () => {
    await testPrisma.country.create({
      data: {
        code: countryCode,
        name: `Phase 1 ${marker}`,
        currencyCode: 'USD',
      },
    });
    const user = await testPrisma.user.create({
      data: {
        email: `phase1-${marker}@example.com`,
        passwordHash: 'unused',
        firstName: 'Phase',
        lastName: 'One',
        role: 'ADMIN',
      },
    });
    userId = user.id;
    token = await createAccessToken(userId);
    const tenant = await testPrisma.tenant.create({
      data: {
        name: 'Context',
        slug: tenantSlug,
        code: `CTX_${marker.replaceAll('-', '')}`,
      },
    });
    contextTenantId = tenant.id;
  });

  afterAll(async () => {
    if (userId) {
      await testPrisma.address.deleteMany({ where: { userId } });
      await testPrisma.tenantMember.deleteMany({ where: { userId } });
      await testPrisma.user.delete({ where: { id: userId } });
    }
    if (tenantId) await testPrisma.tenant.delete({ where: { id: tenantId } });
    if (contextTenantId)
      await testPrisma.tenant.delete({ where: { id: contextTenantId } });
    await testPrisma.country.deleteMany({
      where: { code: countryCode, name: `Phase 1 ${marker}` },
    });
    await testPrisma.$disconnect();
  });

  it('preserves the supported-country response', async () => {
    const response = await request(app)
      .get('/api/v1/countries')
      .set('X-Tenant-Slug', tenantSlug);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: null });
    expect(response.body.data).toContainEqual({
      code: countryCode,
      name: `Phase 1 ${marker}`,
      currencyCode: 'USD',
    });
  });

  it('returns the established country error envelope and status', async () => {
    for (const [header, code] of [
      ['', 'COUNTRY_REQUIRED'],
      ['!!', 'COUNTRY_NOT_SUPPORTED'],
    ]) {
      const response = await request(app)
        .get('/api/v1/products')
        .set('X-Tenant-Slug', tenantSlug)
        .set('X-Country-Code', header);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ success: false, code });
    }
  });

  it('handles a missing user when resolving a default country', async () => {
    const service = new CommerceContextService(new CommerceContextRepository());
    await expect(
      service.resolve({ userId: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'COUNTRY_REQUIRED' });
    await expect(
      service.resolve({ countryCode: countryCode.toLowerCase() }),
    ).resolves.toMatchObject({ countryCode, currencyCode: 'USD' });
  });

  it('preserves address country on create, read, update and default operations', async () => {
    const input = {
      firstName: 'Phase',
      lastName: 'One',
      addressLine1: '1 Test Street',
      city: 'Test',
      country: countryCode,
    };
    const created = await request(app)
      .post('/api/v1/addresses')
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' })
      .send(input);
    expect(created.status).toBe(201);
    addressId = created.body.data.id;
    expect(created.body).toMatchObject({
      success: true,
      message: 'Address created successfully',
      data: input,
    });
    expect(created.body.data).not.toHaveProperty('countryCode');
    const read = await request(app)
      .get(`/api/v1/addresses/${addressId}`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' });
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual(created.body.data);
    const updated = await request(app)
      .patch(`/api/v1/addresses/${addressId}`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' })
      .send({ country: countryCode, city: 'Updated' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      country: countryCode,
      city: 'Updated',
    });
    for (const kind of ['shipping', 'billing']) {
      const response = await request(app)
        .post(`/api/v1/addresses/${addressId}/default-${kind}`)
        .set('X-Tenant-Slug', tenantSlug)
        .auth(token, { type: 'bearer' });
      expect(response.status).toBe(200);
      expect(response.body.data.country).toBe(countryCode);
    }
    const list = await request(app)
      .get('/api/v1/addresses')
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      country: countryCode,
      isDefaultShipping: true,
      isDefaultBilling: true,
    });
  });

  it('maps the nontransactional repository address writes too', async () => {
    const repository = new AddressRepository(testPrisma);
    const address = await repository.create(userId, {
      firstName: 'Repository',
      lastName: 'Test',
      addressLine1: 'Test',
      city: 'Test',
      country: countryCode,
    });
    expect(address.countryCode).toBe(countryCode);
    const updated = await repository.update(address.id, {
      country: countryCode,
      city: 'Updated',
    });
    expect(updated).toMatchObject({ countryCode, city: 'Updated' });
    await repository.delete(address.id);
  });

  it('preserves tenant creation defaults, reads, nullable updates and membership contracts', async () => {
    const created = await request(app)
      .post('/api/v1/tenants')
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' })
      .send({
        name: 'Phase One',
        slug: `phase1-${marker}`,
        code: `PHASE1_${marker.replaceAll('-', '').toUpperCase()}`,
      });
    expect(created.status).toBe(201);
    tenantId = created.body.data.id;
    expect(created.body).toMatchObject({
      success: true,
      message: 'Tenant created successfully.',
      data: { timezone: 'UTC', legalName: null },
    });
    const read = await request(app)
      .get(`/api/v1/tenants/${tenantId}`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' });
    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      success: true,
      message: null,
      data: created.body.data,
    });
    const updated = await request(app)
      .patch(`/api/v1/tenants/${tenantId}`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' })
      .send({
        legalName: null,
        defaultCountryCode: countryCode,
        defaultCurrency: 'USD',
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      legalName: null,
      defaultCountryCode: countryCode,
      defaultCurrency: 'USD',
    });
    const member = await request(app)
      .post(`/api/v1/tenants/${tenantId}/members`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' })
      .send({ userId });
    expect(member.status).toBe(201);
    expect(member.body.data).toMatchObject({
      tenantId,
      userId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });
    const members = await request(app)
      .get(`/api/v1/tenants/${tenantId}/members`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' });
    expect(members.status).toBe(200);
    expect(members.body.data).toHaveLength(1);
    const changed = await request(app)
      .patch(`/api/v1/tenants/${tenantId}/members/${userId}`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' })
      .send({ role: 'MANAGER' });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({
      role: 'MANAGER',
      status: 'ACTIVE',
    });
  });

  it('keeps authentication and missing-resource error semantics', async () => {
    const unauthenticated = await request(app)
      .get('/api/v1/addresses')
      .set('X-Tenant-Slug', tenantSlug);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body).toMatchObject({
      success: false,
      code: 'AUTHENTICATION_REQUIRED',
    });
    const missing = await request(app)
      .get(`/api/v1/tenants/${randomUUID()}`)
      .set('X-Tenant-Slug', tenantSlug)
      .auth(token, { type: 'bearer' });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({
      success: false,
      code: 'TENANT_NOT_FOUND',
    });
  });
});
