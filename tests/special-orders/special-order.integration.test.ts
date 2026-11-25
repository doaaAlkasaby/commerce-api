import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { testPrisma as db } from '../../src/config/test-database.js';

const base = '/api/v1/special-orders';
const users = {
  owner: randomUUID(),
  customer: randomUUID(),
  other: randomUUID(),
  foreign: randomUUID(),
  outsider: randomUUID(),
};
const tokens = new Map<string, string>();
let createdQuoteCountry = false;
const tenant = { id: randomUUID(), slug: `special-${randomUUID()}` };
const otherTenant = { id: randomUUID(), slug: `special-${randomUUID()}` };
const payload = {
  contactPhone: '+965 5555-1234',
  notes: 'Please match these details',
  items: [{ name: 'Custom item', quantity: 2, specifications: '250 ml' }],
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRfkAAAAASUVORK5CYII=',
  'base64',
);
function pdf() {
  const body = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';
  return Buffer.from(
    `${body}xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Root 1 0 R /Size 2 >>\nstartxref\n${body.length}\n%%EOF\n`,
  );
}
const scoped = (req: request.Test, user = users.customer, store = tenant) =>
  req
    .set('X-Tenant-Slug', store.slug)
    .auth(tokens.get(user)!, { type: 'bearer' });
const submit = (value: object = payload, key = randomUUID()) =>
  scoped(request(app).post(`${base}/my`))
    .set('Idempotency-Key', key)
    .send(value);
const setEnabled = (enabled: boolean) =>
  db.appSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: 'special_orders' } },
    create: {
      tenantId: tenant.id,
      key: 'special_orders',
      isPublic: true,
      value: {
        enabled,
        instructionsAr: 'أضف المواصفات',
        instructionsEn: 'Add brand, size and concentration.',
      },
    },
    update: { value: { enabled } },
  });
let productId: string,
  variantId: string,
  otherProductId: string,
  unrelatedVariantId: string;

beforeAll(async () => {
  for (const store of [tenant, otherTenant])
    await db.tenant.create({
      data: {
        ...store,
        name: store.slug,
        code: store.slug,
        defaultCurrency: 'USD',
      },
    });
  for (const [role, id] of Object.entries(users)) {
    await db.user.create({
      data: {
        id,
        email: `${id}@test.example`,
        firstName: role,
        lastName: 'Fixture',
        passwordHash: 'fixture-only',
      },
    });
    tokens.set(id, await createAccessToken(id));
    if (role !== 'outsider')
      await db.tenantMember.create({
        data: {
          userId: id,
          tenantId: role === 'foreign' ? otherTenant.id : tenant.id,
          role: role === 'owner' || role === 'foreign' ? 'OWNER' : 'CUSTOMER',
        },
      });
  }
  async function catalog(tenantId: string, slug: string) {
    const category = await db.category.create({
      data: { tenantId, slug, name: slug },
    });
    return db.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        slug,
        name: slug,
        basePrice: '5.0000',
        variants: { create: { sku: randomUUID(), combinationKey: 'DEFAULT' } },
      },
      include: { variants: true },
    });
  }
  const own = await catalog(tenant.id, 'own');
  productId = own.id;
  variantId = own.variants[0]!.id;
  unrelatedVariantId = (await catalog(tenant.id, 'second')).variants[0]!.id;
  otherProductId = (await catalog(otherTenant.id, 'foreign')).id;
});

afterAll(async () => {
  const ids = [tenant.id, otherTenant.id];
  await db.specialOrderPayment.deleteMany({ where: { tenantId: { in: ids } } });
  await db.specialOrderItem.deleteMany({
    where: { order: { tenantId: { in: ids } } },
  });
  await db.specialOrder.deleteMany({ where: { tenantId: { in: ids } } });
  await db.specialOrderRequest.deleteMany({ where: { tenantId: { in: ids } } });
  await db.product.deleteMany({ where: { tenantId: { in: ids } } });
  await db.taxRule.deleteMany({
    where: { taxCategory: { tenantId: tenant.id } },
  });
  await db.taxProfile.deleteMany({ where: { tenantId: tenant.id } });
  await db.tenant.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  if (createdQuoteCountry) await db.country.delete({ where: { code: 'US' } });
});

describe('Special Orders customer requests', () => {
  it('exposes safe settings, defaults off, and requires membership', async () => {
    const storefront = await request(app)
      .get('/api/v1/storefront')
      .set('X-Tenant-Slug', tenant.slug)
      .expect(200);
    expect(storefront.body.data.settings.specialOrders).toEqual({
      enabled: false,
      instructionsAr: null,
      instructionsEn: null,
    });
    expect((await submit().expect(403)).body.code).toBe(
      'SPECIAL_ORDERS_DISABLED',
    );
    await scoped(request(app).get(`${base}/my`), users.outsider).expect(401);
    await setEnabled(true);
    const enabled = await request(app)
      .get('/api/v1/storefront')
      .set('X-Tenant-Slug', tenant.slug)
      .expect(200);
    expect(enabled.body.data.settings.specialOrders).toEqual({
      enabled: true,
      instructionsAr: 'أضف المواصفات',
      instructionsEn: 'Add brand, size and concentration.',
    });
  });

  it('creates mixed catalog requests without regular commerce writes and replays safely under concurrency', async () => {
    const before = await Promise.all([
      db.order.count(),
      db.cartItem.count(),
      db.payment.count(),
      db.inventoryTransaction.count(),
      db.inventory.count(),
    ]);
    const value = {
      ...payload,
      items: [
        ...payload.items,
        { name: 'Catalog variant', quantity: 3, variantId },
      ],
    };
    const key = randomUUID();
    const results = await Promise.all([submit(value, key), submit(value, key)]);
    expect(results.map(({ status }) => status).sort()).toEqual([200, 201]);
    const body = results[0]!.body.data;
    expect(results[1]!.body.data.id).toBe(body.id);
    expect(body).toMatchObject({
      requestNumber: 'SR-1001',
      contactPhone: '+96555551234',
      status: 'NEW',
    });
    expect(body.items).toMatchObject([
      { name: 'Custom item', quantity: 2, productId: null },
      { productId, variantId, quantity: 3 },
    ]);
    await submit(payload, key).expect(409);
    expect(
      await db.notification.count({
        where: {
          userId: users.owner,
          eventKey: `SPECIAL_REQUEST_CREATED:${body.id}:${users.owner}`,
        },
      }),
    ).toBe(1);
    expect(
      await Promise.all([
        db.order.count(),
        db.cartItem.count(),
        db.payment.count(),
        db.inventoryTransaction.count(),
        db.inventory.count(),
      ]),
    ).toEqual(before);
    const later = await Promise.all([submit(), submit()]);
    expect(later.map(({ body }) => body.data.requestNumber).sort()).toEqual([
      'SR-1002',
      'SR-1003',
    ]);
  });

  it('rejects empty and invalid inputs, foreign catalog IDs, and inconsistent references', async () => {
    for (const items of [
      [],
      [{ name: '   ', quantity: 1 }],
      [{ name: 'Item', quantity: 0 }],
      [{ name: 'Item', quantity: 1.5 }],
      [{ name: 'Item', quantity: 1, productId: otherProductId }],
      [{ name: 'Item', quantity: 1, productId, variantId: unrelatedVariantId }],
    ])
      await submit({ ...payload, items }).expect(400);
    await submit({ ...payload, contactPhone: 'abc' }).expect(400);
    await submit({ items: payload.items }).expect(400);
    await submit({ ...payload, tenantId: otherTenant.id }).expect(400);
    await scoped(request(app).post(`${base}/my`))
      .send(payload)
      .expect(400);
  });

  it('uses a saved customer phone when a contact number is omitted', async () => {
    const countryCode = `S-${randomUUID()}`;
    await db.country.create({
      data: { code: countryCode, name: 'Fixture', currencyCode: 'USD' },
    });
    try {
      await db.address.create({
        data: {
          userId: users.customer,
          countryCode,
          firstName: 'Customer',
          lastName: 'Fixture',
          addressLine1: 'Fixture address',
          city: 'Fixture city',
          phone: '+965 5555 7788',
          isDefaultShipping: true,
        },
      });
      const response = await submit({ items: payload.items }).expect(201);
      expect(response.body.data.contactPhone).toBe('+96555557788');
    } finally {
      await db.address.deleteMany({
        where: { userId: users.customer, countryCode },
      });
      await db.country.delete({ where: { code: countryCode } });
    }
  });

  it('paginates owned requests, isolates customers and tenants, and preserves history when disabled', async () => {
    const {
      body: { data },
    } = await submit().expect(201);
    const list = await scoped(request(app).get(`${base}/my?limit=1`)).expect(
      200,
    );
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.pagination.limit).toBe(1);
    await scoped(request(app).get(`${base}/my/${data.id}`), users.other).expect(
      404,
    );
    await scoped(
      request(app).get(`${base}/${data.id}`),
      users.foreign,
      otherTenant,
    ).expect(404);
    await scoped(request(app).get(`${base}/${data.id}`), users.customer).expect(
      403,
    );
    const search = await scoped(
      request(app)
        .get(base)
        .query({ status: 'NEW', search: data.requestNumber }),
      users.owner,
    ).expect(200);
    expect(search.body.data.items).toMatchObject([
      { id: data.id, contactPhone: data.contactPhone },
    ]);
    await setEnabled(false);
    await submit().expect(403);
    await scoped(request(app).get(`${base}/my/${data.id}`)).expect(200);
    await scoped(request(app).get(`${base}/my`)).expect(200);
    await setEnabled(true);
  });

  it('retains only the latest request and enforces customer cancellation and merchant rejection transitions', async () => {
    const {
      body: { data },
    } = await submit().expect(201);
    const changes = {
      items: [{ ...payload.items[0], id: data.items[0].id, name: 'Edited' }],
    };
    await scoped(request(app).patch(`${base}/my/${data.id}`), users.owner)
      .send(changes)
      .expect(403);
    const edit = await scoped(request(app).patch(`${base}/my/${data.id}`))
      .send(changes)
      .expect(200);
    expect(edit.body.data).toMatchObject({
      id: data.id,
      requestNumber: data.requestNumber,
      items: [{ id: data.items[0].id, name: 'Edited' }],
    });
    expect(edit.body.data.history[1]).toEqual({
      action: 'EDITED',
      actorId: users.customer,
      at: expect.any(String),
    });
    const persisted = await db.specialOrderRequest.findUniqueOrThrow({
      where: { id: data.id },
      select: { history: true },
    });
    expect(persisted.history).toEqual(edit.body.data.history);
    await scoped(
      request(app).post(`${base}/${data.id}/review`),
      users.customer,
    ).expect(403);
    await scoped(
      request(app).post(`${base}/${data.id}/review`),
      users.owner,
    ).expect(200);
    await scoped(request(app).patch(`${base}/my/${data.id}`))
      .send(changes)
      .expect(409);
    const rejected = await scoped(
      request(app).post(`${base}/${data.id}/reject`),
      users.owner,
    )
      .send({ reason: 'Unavailable' })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      rejectionReason: 'Unavailable',
      status: 'REJECTED',
      items: [{ name: 'Edited' }],
    });
    expect(
      await db.notification.count({
        where: {
          userId: users.customer,
          eventKey: `SPECIAL_REQUEST_REJECTED:${data.id}:${users.customer}`,
        },
      }),
    ).toBe(1);
    await scoped(request(app).post(`${base}/my/${data.id}/cancel`)).expect(409);
    const cancellable = await submit().expect(201);
    await scoped(
      request(app).post(`${base}/my/${cancellable.body.data.id}/cancel`),
    ).expect(200);
    await scoped(
      request(app).post(`${base}/${cancellable.body.data.id}/review`),
      users.owner,
    ).expect(409);
  });

  it('serializes customer edits against merchant review', async () => {
    const {
      body: { data },
    } = await submit().expect(201);
    const [edit, review] = await Promise.all([
      scoped(request(app).patch(`${base}/my/${data.id}`)).send({
        items: [{ name: 'Concurrent edit', quantity: 1 }],
      }),
      scoped(request(app).post(`${base}/${data.id}/review`), users.owner),
    ]);
    expect(review.status).toBe(200);
    expect([200, 409]).toContain(edit.status);
    const final = await scoped(
      request(app).get(`${base}/my/${data.id}`),
    ).expect(200);
    expect(final.body.data.status).toBe('UNDER_REVIEW');
    expect(final.body.data.items[0].name).toBe(
      edit.status === 200 ? 'Concurrent edit' : 'Custom item',
    );
    expect(final.body.data.history.at(-1).action).toBe('UNDER_REVIEW');
  });

  it('validates and stores attachments atomically and authorizes private downloads', async () => {
    const multipart = (key: string) =>
      scoped(request(app).post(`${base}/my`))
        .set('Idempotency-Key', key)
        .field('request', JSON.stringify(payload));
    const before = await db.specialOrderRequest.count({
      where: { tenantId: tenant.id },
    });
    await multipart(randomUUID())
      .attach('itemImage-0', Buffer.from('invalid'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    await multipart(randomUUID())
      .attach('itemImage-0', pdf(), {
        filename: 'document.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(
      await db.specialOrderRequest.count({ where: { tenantId: tenant.id } }),
    ).toBe(before);
    const key = randomUUID();
    const withFiles = () =>
      multipart(key)
        .attach('itemImage-0', png, {
          filename: 'product.png',
          contentType: 'image/png',
        })
        .attach('attachment', pdf(), {
          filename: 'private.pdf',
          contentType: 'application/pdf',
        });
    const {
      body: { data },
    } = await withFiles().expect(201);
    await withFiles().expect(200);
    expect(data.attachments).toHaveLength(2);
    expect(
      data.attachments.find(
        (file: { contentType: string }) => file.contentType === 'image/png',
      ).itemId,
    ).toBe(data.items[0].id);
    const file = data.attachments.find(
      (attachment: { contentType: string }) =>
        attachment.contentType === 'application/pdf',
    );
    expect(file).not.toHaveProperty('content');
    const customerUrl = `${base}/my/${data.id}/attachments/${file.id}`;
    const merchantUrl = `${base}/${data.id}/attachments/${file.id}`;
    await request(app)
      .get(customerUrl)
      .set('X-Tenant-Slug', tenant.slug)
      .expect(401);
    await scoped(request(app).get(customerUrl), users.other).expect(404);
    await scoped(
      request(app).get(merchantUrl),
      users.foreign,
      otherTenant,
    ).expect(404);
    await scoped(request(app).get(customerUrl))
      .expect('Cache-Control', 'private, no-store')
      .expect('Content-Disposition', /attachment/)
      .expect(200);
    await scoped(request(app).get(merchantUrl), users.owner).expect(200);
    const another = await submit().expect(201);
    await scoped(
      request(app).get(
        `${base}/my/${another.body.data.id}/attachments/${file.id}`,
      ),
    ).expect(404);
    await scoped(
      request(app).post(`${base}/my/${another.body.data.id}/attachments`),
    )
      .field('itemId', data.items[0].id)
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(400);
    const image = data.attachments.find(
      (attachment: { contentType: string }) =>
        attachment.contentType === 'image/png',
    );
    await scoped(request(app).patch(`${base}/my/${data.id}`))
      .send({ items: [{ name: 'Replacement', quantity: 1 }] })
      .expect(200);
    expect(
      await db.specialOrderAttachment.findUnique({ where: { id: image.id } }),
    ).toBeNull();
    await scoped(request(app).get(customerUrl)).expect(200);

    await scoped(
      request(app).post(`${base}/my/${another.body.data.id}/attachments`),
    )
      .attach('file', pdf(), {
        filename: 'document.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    await scoped(
      request(app).post(`${base}/my/${another.body.data.id}/attachments`),
    )
      .attach('file', Buffer.alloc(3 * 1024 * 1024 + 1), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);
  });
});

describe('Special Orders merchant quotations', () => {
  let zeroCategoryId: string;
  let exemptCategoryId: string;

  const available = {
    type: 'AVAILABLE',
    name: '200 ml',
    unitPrice: '50.00',
    pricesIncludeTax: false,
    offeredQuantity: 5,
  };
  const suggested = {
    type: 'SUGGESTED',
    name: 'Alternative',
    unitPrice: '50.00',
    pricesIncludeTax: true,
    offeredQuantity: 4,
  };
  const merchant = (req: request.Test) => scoped(req, users.owner);
  const quotePath = (id: string) => `${base}/${id}/quotation`;
  const customerPath = (id: string) => `${base}/my/${id}/quotation`;
  async function underReview() {
    const {
      body: { data },
    } = await submit().expect(201);
    await merchant(request(app).post(`${base}/${data.id}/review`)).expect(200);
    return data;
  }
  const save = (id: string, value: object = { items: [available] }) =>
    merchant(request(app).put(`${quotePath(id)}/draft`)).send({
      sourcingDays: 3,
      ...value,
    });
  const publish = (id: string, value: object) =>
    merchant(request(app).post(`${quotePath(id)}/publish`)).send(value);
  const versionOf = (quote: { quotationId: string; version: number }) => ({
    quotationId: quote.quotationId,
    version: quote.version,
  });
  const select = (
    quote: { quotationId: string; version: number },
    itemId: string,
    quantity = 1,
  ) => ({ ...versionOf(quote), items: [{ itemId, quantity }] });
  const accept = (id: string, selection: object) =>
    scoped(request(app).post(`${customerPath(id)}/accept`)).send(selection);

  beforeAll(async () => {
    await setEnabled(true);
    createdQuoteCountry = !(await db.country.findUnique({
      where: { code: 'US' },
    }));
    if (createdQuoteCountry)
      await db.country.create({
        data: { code: 'US', name: 'United States', currencyCode: 'USD' },
      });
    await db.tenant.update({
      where: { id: tenant.id },
      data: { defaultCountryCode: 'US' },
    });
    for (const treatment of ['STANDARD', 'ZERO_RATED', 'EXEMPT'] as const) {
      const category = await db.taxCategory.create({
        data: {
          tenantId: tenant.id,
          code: treatment,
          name: treatment,
          treatment,
        },
      });
      await db.taxRule.create({
        data: {
          taxCategoryId: category.id,
          countryCode: 'US',
          rate: treatment === 'STANDARD' ? '14' : '0',
        },
      });
      if (treatment === 'STANDARD') {
        await db.taxProfile.create({
          data: {
            tenantId: tenant.id,
            countryCode: 'US',
            currency: 'USD',
            defaultTaxCategoryId: category.id,
          },
        });
      } else if (treatment === 'ZERO_RATED') zeroCategoryId = category.id;
      else exemptCategoryId = category.id;
    }
  });

  it('publishes both lists and snapshots an idempotent mixed selection and taxed fee', async () => {
    const original = await underReview();
    const id = original.id as string;
    const requestedItemId = original.items[0].id as string;
    const countCommerce = () =>
      Promise.all([
        db.cart.count({ where: { tenantId: tenant.id } }),
        db.order.count({ where: { tenantId: tenant.id } }),
        db.payment.count({ where: { order: { tenantId: tenant.id } } }),
        db.inventory.count({ where: { tenantId: tenant.id } }),
      ]);
    const counts = await countCommerce();
    const input = {
      sourcingDays: 3,
      sourcingFee: '10.00',
      sourcingFeeDescription: 'Manual sourcing',
      items: [
        { ...available, productId, variantId, requestedItemId },
        { ...available, name: '500 ml', requestedItemId, unitPrice: '0.05' },
        { ...suggested, requestedItemId },
        {
          ...suggested,
          name: 'Zero rated',
          taxCategoryId: zeroCategoryId,
          unitPrice: '1.00',
        },
        {
          ...suggested,
          name: 'Exempt',
          taxCategoryId: exemptCategoryId,
          unitPrice: '1.00',
        },
      ],
    };
    await save(id, { ...input, sourcingFee: '-1' }).expect(400);
    await save(id, {
      ...input,
      items: [{ ...available, productId: otherProductId }],
    }).expect(400);
    await scoped(request(app).put(`${quotePath(id)}/draft`))
      .send(input)
      .expect(403);
    const created = await merchant(request(app).put(`${quotePath(id)}/draft`))
      .field('request', JSON.stringify(input))
      .attach('itemImage-0', png, {
        filename: 'offer.png',
        contentType: 'image/png',
      })
      .expect(200);
    const draft = created.body.data;
    const imagePath = `/${draft.quotationId}/items/${draft.availableProducts[0].id}/image`;
    await scoped(request(app).get(customerPath(id))).expect(404);
    await scoped(request(app).get(customerPath(id) + imagePath)).expect(404);
    await merchant(request(app).get(quotePath(id) + imagePath)).expect(200);
    const {
      body: { data: quote },
    } = await publish(id, versionOf(draft)).expect(200);
    expect(quote).toMatchObject({
      status: 'PUBLISHED',
      validityHours: 48,
      sourcingFee: '10.00',
    });
    expect(quote.availableProducts).toHaveLength(2);
    expect(quote.suggestedProducts).toHaveLength(3);
    await scoped(request(app).get(customerPath(id) + imagePath)).expect(200);
    await scoped(request(app).get(customerPath(id)), users.other).expect(404);
    await scoped(
      request(app).get(quotePath(id)),
      users.foreign,
      otherTenant,
    ).expect(404);
    expect(
      (await scoped(request(app).get(`${base}/my/${id}`)).expect(200)).body.data
        .items,
    ).toEqual(original.items);

    const items = [
      ...quote.availableProducts.map((item: { id: string }, index: number) => ({
        itemId: item.id,
        quantity: index ? 1 : 2,
      })),
      ...quote.suggestedProducts.map((item: { id: string }, index: number) => ({
        itemId: item.id,
        quantity: index ? 1 : 2,
      })),
    ];
    const selection = { ...versionOf(quote), items };
    const calculate = (body: object) =>
      scoped(request(app).post(`${customerPath(id)}/calculate`)).send(body);
    await calculate(select(quote, quote.availableProducts[0].id, 6)).expect(
      400,
    );
    await calculate(select(quote, randomUUID())).expect(400);
    await calculate({ ...selection, items: [items[0], items[0]] }).expect(400);
    await calculate({ ...selection, items: [] }).expect(400);
    const reduced = (
      await calculate(select(quote, quote.availableProducts[0].id)).expect(200)
    ).body.data;
    expect(reduced).toMatchObject({
      sourcingFee: '10.00',
      totalBeforeShipping: '68.40',
    });
    await scoped(request(app).post(`${customerPath(id)}/accept`), users.other)
      .send(selection)
      .expect(404);
    const breakdown = (await calculate(selection).expect(200)).body.data;
    expect(breakdown.items).toMatchObject([
      {
        selectedQuantity: 2,
        subtotalBeforeTax: '100.00',
        taxAmount: '14.00',
        totalIncludingTax: '114.00',
      },
      { subtotalBeforeTax: '0.05', taxAmount: '0.01' },
      {
        selectedQuantity: 2,
        subtotalBeforeTax: '87.72',
        taxAmount: '12.28',
        totalIncludingTax: '100.00',
      },
      { tax: { treatment: 'ZERO_RATED' }, taxAmount: '0.00' },
      { tax: { treatment: 'EXEMPT' }, taxAmount: '0.00' },
    ]);
    expect(breakdown).toMatchObject({
      productsSubtotalBeforeTax: '189.77',
      productsTax: '26.29',
      productsTotalIncludingTax: '216.06',
      sourcingFee: '10.00',
      sourcingFeeTax: '1.40',
      sourcingFeeTotalIncludingTax: '11.40',
      totalBeforeShipping: '227.46',
    });
    const [first, retry] = await Promise.all([
      accept(id, selection),
      accept(id, { ...selection, items: [...items].reverse() }),
    ]);
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(first.body.data.id).toBe(retry.body.data.id);
    expect(first.body.data.snapshot.totalBeforeShipping).toBe('227.46');
    await accept(id, select(quote, quote.availableProducts[0].id)).expect(409);
    await save(id).expect(409);
    expect(await countCommerce()).toEqual(counts);
    expect(
      await db.notification.count({
        where: {
          tenantId: tenant.id,
          eventKey: `SPECIAL_QUOTATION_ACCEPTED:${quote.quotationId}:${users.owner}`,
        },
      }),
    ).toBe(1);
    await scoped(request(app).patch(`${base}/my/${id}`))
      .send({ ...payload, resubmit: { ...versionOf(quote), status: 'QUOTED' } })
      .expect(409);
    const edited = await scoped(request(app).patch(`${base}/my/${id}`))
      .field(
        'request',
        JSON.stringify({
          ...payload,
          items: [{ name: 'Updated item', quantity: 7 }],
          resubmit: { ...versionOf(quote), status: 'ACCEPTED' },
        }),
      )
      .attach('itemImage-0', png, {
        filename: 'request.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      id,
      status: 'NEW',
      requestNumber: original.requestNumber,
      items: [{ name: 'Updated item', quantity: 7 }],
    });
    expect(edited.body.data.attachments).toHaveLength(1);
    expect(
      await db.specialOrderAcceptance.count({
        where: { id: first.body.data.id },
      }),
    ).toBe(0);
    await scoped(request(app).get(customerPath(id))).expect(404);
  });

  it('replaces an expired offer, fences stale acceptance, and records customer rejection', async () => {
    const { id } = await underReview();
    const empty = (await save(id, { items: [] }).expect(200)).body.data;
    await publish(id, versionOf(empty)).expect(400);
    const draft = (
      await save(id, { draft: versionOf(empty), items: [available] }).expect(
        200,
      )
    ).body.data;
    await publish(id, versionOf(empty)).expect(409);
    const first = (await publish(id, versionOf(draft)).expect(200)).body.data;
    expect(first.suggestedProducts).toEqual([]);
    const selection = select(first, first.availableProducts[0].id);
    await db.specialOrderQuotation.update({
      where: { id: first.quotationId },
      data: {
        publishedAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      },
    });
    expect(
      (await scoped(request(app).get(customerPath(id))).expect(200)).body.data
        .status,
    ).toBe('EXPIRED');
    await accept(id, selection).expect(409);
    const replacement = (
      await save(id, { items: [suggested], validityHours: 24 }).expect(200)
    ).body.data;
    const current = (await publish(id, versionOf(replacement)).expect(200)).body
      .data;
    expect(current).toMatchObject({
      availableProducts: [],
      validityHours: 24,
      sourcingFee: '0.00',
    });
    expect(
      await db.specialOrderQuotationItem.count({
        where: { quotationId: first.quotationId },
      }),
    ).toBe(0);
    await accept(id, selection).expect(409);
    await scoped(request(app).post(`${customerPath(id)}/reject`))
      .send({ ...versionOf(current), reason: 'Too expensive' })
      .expect(200);
    const detail = (
      await scoped(request(app).get(`${base}/my/${id}`)).expect(200)
    ).body.data;
    expect(detail).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Too expensive',
    });
    expect(detail.history.at(-1).action).toBe('CUSTOMER_REJECTED_QUOTATION');
    await scoped(request(app).get(customerPath(id))).expect(404);
  });

  it('serializes acceptance against replacement and explicit resubmission and invalidates a cancelled offer', async () => {
    const { id } = await underReview();
    const draft = (await save(id).expect(200)).body.data;
    const first = (await publish(id, versionOf(draft)).expect(200)).body.data;
    const replacement = (await save(id, { items: [suggested] }).expect(200))
      .body.data;
    const [accepted, published] = await Promise.all([
      accept(id, select(first, first.availableProducts[0].id)),
      publish(id, versionOf(replacement)),
    ]);
    expect([accepted.status, published.status].sort()).toEqual([200, 409]);

    const second = await underReview();
    const secondDraft = (await save(second.id).expect(200)).body.data;
    const current = (
      await publish(second.id, versionOf(secondDraft)).expect(200)
    ).body.data;
    const [acceptance, resubmit] = await Promise.all([
      accept(second.id, select(current, current.availableProducts[0].id)),
      scoped(request(app).patch(`${base}/my/${second.id}`)).send({
        ...payload,
        resubmit: { ...versionOf(current), status: 'QUOTED' },
      }),
    ]);
    expect([acceptance.status, resubmit.status].sort()).toEqual([200, 409]);

    const third = await underReview();
    const thirdDraft = (await save(third.id).expect(200)).body.data;
    const live = (await publish(third.id, versionOf(thirdDraft)).expect(200))
      .body.data;
    await scoped(request(app).post(`${base}/my/${third.id}/cancel`))
      .send({ ...versionOf(live), status: 'QUOTED' })
      .expect(200);
    await accept(third.id, select(live, live.availableProducts[0].id)).expect(
      409,
    );
    expect(
      await db.specialOrderQuotation.count({ where: { requestId: third.id } }),
    ).toBe(0);
  });

  it('serializes concurrent quotation acceptance and customer cancellation', async () => {
    const { id } = await underReview();
    const draft = (await save(id).expect(200)).body.data;
    const quote = (await publish(id, versionOf(draft)).expect(200)).body.data;
    const selection = select(quote, quote.availableProducts[0].id);
    const [acceptance, cancellation] = await Promise.all([
      accept(id, selection),
      scoped(request(app).post(`${base}/my/${id}/cancel`)).send({
        ...versionOf(quote),
        status: 'QUOTED',
      }),
    ]);
    expect([acceptance.status, cancellation.status].sort()).toEqual([200, 409]);

    const detail = (
      await scoped(request(app).get(`${base}/my/${id}`)).expect(200)
    ).body.data;
    const snapshots = await db.specialOrderAcceptance.findMany({
      where: { quotationId: quote.quotationId },
    });
    if (cancellation.status === 200) {
      expect(detail.status).toBe('CANCELLED');
      expect(detail.history.at(-1)).toMatchObject({
        action: 'CANCELLED',
        from: 'QUOTED',
      });
      expect(snapshots).toHaveLength(0);
      await accept(id, selection).expect(409);
    } else {
      expect(detail.status).toBe('ACCEPTED');
      expect(detail.history.at(-1)).toMatchObject({
        action: 'ACCEPTED',
        quotationId: quote.quotationId,
      });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        id: acceptance.body.data.id,
        snapshot: acceptance.body.data.snapshot,
      });
      const retry = await accept(id, selection).expect(200);
      expect(retry.body.data.id).toBe(acceptance.body.data.id);
      expect(
        await db.specialOrderAcceptance.count({
          where: { quotationId: quote.quotationId },
        }),
      ).toBe(1);
    }
  });

  it('removes the unconsumed acceptance when the customer cancels an accepted request', async () => {
    const { id } = await underReview();
    const draft = (await save(id).expect(200)).body.data;
    const quote = (await publish(id, versionOf(draft)).expect(200)).body.data;
    const selection = select(quote, quote.availableProducts[0].id);
    const {
      body: { data: acceptance },
    } = await accept(id, selection).expect(200);
    const where = { id: acceptance.id };
    expect(await db.specialOrderAcceptance.findUnique({ where })).toMatchObject(
      {
        quotationId: quote.quotationId,
        snapshot: acceptance.snapshot,
      },
    );

    const cancelled = await scoped(request(app).post(`${base}/my/${id}/cancel`))
      .send({ ...versionOf(quote), status: 'ACCEPTED' })
      .expect(200);
    expect(cancelled.body.data).toMatchObject({ id, status: 'CANCELLED' });
    expect(cancelled.body.data.history.at(-1)).toMatchObject({
      action: 'CANCELLED',
      from: 'ACCEPTED',
    });
    expect(await db.specialOrderAcceptance.findUnique({ where })).toBeNull();
    await accept(id, selection).expect(409);
    expect(
      await db.specialOrderAcceptance.count({
        where: { quotationId: quote.quotationId },
      }),
    ).toBe(0);
    const detail = await scoped(request(app).get(`${base}/my/${id}`)).expect(
      200,
    );
    expect(detail.body.data.status).toBe('CANCELLED');
  });
  const pickup = {
    id: 'public-store',
    enabled: true,
    name: 'Main store',
    address: '1 Main St',
    countryCode: 'US',
  };
  const setCheckoutSettings = (value: object) =>
    db.appSetting.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: 'special_checkout' } },
      create: {
        tenantId: tenant.id,
        key: 'special_checkout',
        isPublic: false,
        value,
      },
      update: { value },
    });
  const checkoutPath = (id: string) => `${base}/my/${id}/checkout`;
  const requestPreview = (id: string, body: object) =>
    scoped(request(app).post(`${checkoutPath(id)}/preview`)).send(body);
  const confirm = (id: string, body: object, key: string) =>
    scoped(request(app).post(`${checkoutPath(id)}/confirm`))
      .set('Idempotency-Key', key)
      .send(body);
  const pickupInput = (id: string) => ({
    acceptanceId: id,
    fulfillment: { method: 'STORE_PICKUP', pickupLocationId: pickup.id },
    paymentMethod: 'CASH_ON_FULFILLMENT',
  });

  async function readyForCheckout(
    terms?: object[],
    unitPrice = available.unitPrice,
  ) {
    const original = await underReview();
    const draft = (
      await merchant(request(app).put(`${quotePath(original.id)}/draft`))
        .field(
          'request',
          JSON.stringify({
            sourcingDays: 3,
            sourcingFee: '10.00',
            sourcingFeeDescription: 'Manual sourcing',
            ...(terms && { paymentTerms: terms }),
            items: [
              { ...available, productId, variantId, unitPrice },
              suggested,
              { ...suggested, name: 'Not selected' },
            ],
          }),
        )
        .attach('itemImage-0', png, {
          filename: 'selected.png',
          contentType: 'image/png',
        })
        .attach('itemImage-2', png, {
          filename: 'obsolete.png',
          contentType: 'image/png',
        })
        .expect(200)
    ).body.data;
    const quote = (await publish(original.id, versionOf(draft)).expect(200))
      .body.data;
    const selection = {
      ...versionOf(quote),
      items: [
        { itemId: quote.availableProducts[0].id, quantity: 2 },
        { itemId: quote.suggestedProducts[0].id, quantity: 1 },
      ],
    };
    const acceptance = (await accept(original.id, selection).expect(200)).body
      .data;
    return { original, quote, acceptance, id: original.id as string };
  }

  it('creates an immutable home-delivery order idempotently without commerce side effects', async () => {
    const { id, original, quote, acceptance } = await readyForCheckout();
    const countCommerce = () =>
      Promise.all([
        db.cart.count(),
        db.cartItem.count(),
        db.order.count(),
        db.payment.count(),
        db.inventory.count(),
        db.inventoryTransaction.count(),
      ]);
    const counts = await countCommerce();
    const delivery = {
      countryCode: 'US',
      firstName: 'Test',
      lastName: 'Customer',
      addressLine1: '1 Main St',
      city: 'Test City',
    };
    const address = await db.address.create({
      data: { ...delivery, userId: users.customer },
    });
    const foreignAddress = await db.address.create({
      data: { ...delivery, userId: users.other },
    });
    const profile = await db.shippingProfile.create({
      data: { tenantId: tenant.id, countryCode: 'US', currency: 'USD' },
    });
    const zone = await db.shippingZone.create({
      data: {
        profileId: profile.id,
        countryCode: 'US',
        code: 'domestic',
        name: 'Domestic',
      },
    });
    const method = await db.shippingMethod.create({
      data: { zoneId: zone.id, code: 'standard', name: 'Standard' },
    });
    const rule = await db.shippingRule.create({
      data: {
        methodId: method.id,
        flatRate: '11.40',
        minOrderAmount: '150.00',
      },
    });
    const input = {
      acceptanceId: acceptance.id,
      fulfillment: {
        method: 'HOME_DELIVERY',
        addressId: address.id,
        shippingMethodCode: method.code,
      },
      paymentMethod: 'CASH_ON_FULFILLMENT',
    };
    await scoped(request(app).get(checkoutPath(id)), users.other).expect(404);
    await scoped(request(app).get(checkoutPath(id))).expect(200);
    await scoped(
      request(app)
        .get(`${checkoutPath(id)}/options`)
        .query({ addressId: address.id }),
    )
      .expect(200)
      .expect(({ body }) =>
        expect(body.data.shippingOptions[0].code).toBe('standard'),
      );
    await requestPreview(id, {
      ...input,
      fulfillment: { ...input.fulfillment, addressId: foreignAddress.id },
    }).expect(404);
    await requestPreview(id, { ...input, acceptanceId: randomUUID() }).expect(
      409,
    );
    await requestPreview(id, { ...input, grandTotal: '1.00' }).expect(400);
    const stale = (await requestPreview(id, input).expect(200)).body.data;
    await db.shippingRule.update({
      where: { id: rule.id },
      data: { flatRate: '22.80' },
    });
    await confirm(
      id,
      { ...input, previewToken: stale.previewToken },
      randomUUID(),
    ).expect(409);
    await db.shippingRule.update({
      where: { id: rule.id },
      data: { flatRate: '11.40' },
    });
    const quoteTaxId = quote.availableProducts[0].tax.taxCategoryId as string;
    await db.taxRule.updateMany({
      where: { taxCategoryId: quoteTaxId },
      data: { rate: 15 },
    });
    await requestPreview(id, input)
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('SPECIAL_CHECKOUT_TAX_CONFLICT'),
      );
    await db.taxRule.updateMany({
      where: { taxCategoryId: quoteTaxId },
      data: { rate: 14 },
    });
    await db.product.update({
      where: { id: productId },
      data: { basePrice: '99.99' },
    });
    const preview = (await requestPreview(id, input).expect(200)).body.data;
    expect(preview.financials).toEqual({
      currency: 'USD',
      productsSubtotalBeforeTax: '143.86',
      productsTax: '20.14',
      productsTotalIncludingTax: '164.00',
      sourcingFeeSubtotalBeforeTax: '10.00',
      sourcingFeeTax: '1.40',
      sourcingFeeTotalIncludingTax: '11.40',
      shippingSubtotalBeforeTax: '10.00',
      shippingTax: '1.40',
      shippingTotalIncludingTax: '11.40',
      grandTotal: '186.80',
    });
    const key = randomUUID();
    const body = { ...input, previewToken: preview.previewToken };
    await setEnabled(false);
    const responses = await Promise.all([
      confirm(id, body, key),
      confirm(id, body, key),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    const order = responses[0]!.body.data;
    expect(responses[1]!.body.data).toEqual(order);
    expect(order).toMatchObject({
      requestId: id,
      acceptanceId: acceptance.id,
      state: 'PENDING_SOURCING',
      paymentStatus: 'PENDING',
      initialPayment: '0.00',
      remainingBalance: '186.80',
      deliveryAddress: { addressLine1: '1 Main St' },
      items: [
        {
          productId,
          variantId,
          quantity: 2,
          unitPrice: '50.00',
          hasImage: true,
        },
        {
          productId: null,
          quantity: 1,
          unitPrice: '50.00',
          pricesIncludeTax: true,
        },
      ],
    });
    await confirm(id, body, randomUUID()).expect(409);
    await db.address.update({
      where: { id: address.id },
      data: { addressLine1: 'Changed' },
    });
    await scoped(request(app).get(`${base}/my/${id}/order`))
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(order));
    await scoped(
      request(app).get(`${base}/my/orders/${order.id}`),
      users.other,
    ).expect(404);
    await scoped(request(app).get(`${base}/my/orders`))
      .expect(200)
      .expect(({ body }) => expect(body.data.items[0].id).toBe(order.id));
    await merchant(
      request(app)
        .get(`${base}/orders`)
        .query({ search: order.orderNumber, state: order.state }),
    )
      .expect(200)
      .expect(({ body }) => expect(body.data.items[0].id).toBe(order.id));
    await merchant(request(app).get(`${base}/orders/${order.id}`)).expect(200);
    await scoped(request(app).get(`${base}/orders/${order.id}`)).expect(403);
    await scoped(
      request(app).get(`${base}/orders/${order.id}`),
      users.foreign,
      otherTenant,
    ).expect(404);
    expect(
      await db.specialOrderAcceptance.findUnique({
        where: { id: acceptance.id },
      }),
    ).toMatchObject({ consumedAt: expect.any(Date) });
    expect(
      await db.specialOrderQuotationItem.count({
        where: { quotationId: quote.quotationId },
      }),
    ).toBe(2);
    await scoped(
      request(app).get(
        `${customerPath(id)}/${quote.quotationId}/items/${quote.availableProducts[0].id}/image`,
      ),
    ).expect(200);
    const linked = (
      await scoped(request(app).get(`${base}/my/${id}`)).expect(200)
    ).body.data;
    expect(linked).toMatchObject({
      status: 'ORDER_CREATED',
      finalOrder: { id: order.id },
      items: original.items,
    });
    expect(
      await db.notification.count({
        where: {
          tenantId: tenant.id,
          eventKey: { startsWith: `SPECIAL_ORDER_CREATED:${order.id}:` },
        },
      }),
    ).toBe(2);
    expect(await countCommerce()).toEqual(counts);
    await setEnabled(true);
  });

  it('offers only eligible pickup and calculates disclosed deferred payments without executing them', async () => {
    await setCheckoutSettings({
      pickupLocations: [pickup, { ...pickup, id: 'warehouse', enabled: false }],
    });
    await db.appSetting.create({
      data: {
        tenantId: otherTenant.id,
        key: 'special_checkout',
        isPublic: false,
        value: { pickupLocations: [{ ...pickup, id: 'other-tenant-pickup' }] },
      },
    });
    const { id, acceptance, quote } = await readyForCheckout([
      { method: 'CASH_ON_FULFILLMENT' },
      { method: 'FULL_ADVANCE_ONLINE' },
      {
        method: 'DEPOSIT_REMAINING_CASH',
        deposit: { type: 'PERCENTAGE', percentage: '12.50' },
      },
      {
        method: 'DEPOSIT_REMAINING_ONLINE',
        deposit: { type: 'FIXED', amount: '25.01' },
      },
    ]);
    expect(quote.paymentTerms[2]).toMatchObject({
      percentageBase: 'PRODUCTS_INCLUDING_TAX',
      shippingAllocation: 'REMAINING_BALANCE',
    });
    const input = pickupInput(acceptance.id);
    const options = (
      await scoped(request(app).get(`${checkoutPath(id)}/options`)).expect(200)
    ).body.data;
    expect(
      options.pickupLocations.map(
        ({ id: locationId }: { id: string }) => locationId,
      ),
    ).toEqual([pickup.id]);
    await requestPreview(id, {
      ...input,
      fulfillment: {
        ...input.fulfillment,
        pickupLocationId: 'other-tenant-pickup',
      },
    }).expect(404);
    await requestPreview(id, {
      ...input,
      paymentMethod: 'FULL_ADVANCE_ONLINE',
    }).expect(409);
    const preview = (await requestPreview(id, input).expect(200)).body.data;
    expect(preview.financials).toMatchObject({
      grandTotal: '175.40',
      shippingTax: '0.00',
      shippingTotalIncludingTax: '0.00',
    });
    expect(preview.deferredPaymentTerms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'DEPOSIT_REMAINING_CASH',
          initialPayment: '20.50',
          remainingBalance: '154.90',
          executable: false,
        }),
        expect.objectContaining({
          method: 'DEPOSIT_REMAINING_ONLINE',
          initialPayment: '25.01',
          remainingBalance: '150.39',
          executable: false,
        }),
      ]),
    );
    await confirm(
      id,
      {
        ...input,
        previewToken: preview.previewToken,
        paymentMethod: 'DEPOSIT_REMAINING_CASH',
      },
      randomUUID(),
    ).expect(409);
    await setCheckoutSettings({
      cashEnabled: false,
      pickupLocations: [pickup],
    });
    await confirm(
      id,
      { ...input, previewToken: preview.previewToken },
      randomUUID(),
    ).expect(409);
    await setCheckoutSettings({ pickupLocations: [pickup] });
    const final = (
      await confirm(
        id,
        { ...input, previewToken: preview.previewToken },
        randomUUID(),
      ).expect(201)
    ).body.data;
    expect(final).toMatchObject({
      deliveryAddress: null,
      shippingMethod: null,
      pickupLocation: { id: pickup.id, name: pickup.name },
    });
  });

  it('rejects a deposit above the accepted products total', async () => {
    await setCheckoutSettings({ pickupLocations: [pickup] });
    const { id, acceptance } = await readyForCheckout([
      { method: 'CASH_ON_FULFILLMENT' },
      {
        method: 'DEPOSIT_REMAINING_CASH',
        deposit: { type: 'FIXED', amount: '165.00' },
      },
    ]);
    await requestPreview(id, pickupInput(acceptance.id))
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('SPECIAL_ORDER_INVALID_DEPOSIT'),
      );
  });

  it('preserves aggregate totals above the unit-price limit and the accepted validity rules', async () => {
    await setCheckoutSettings({ pickupLocations: [pickup] });
    const { id, quote, acceptance } = await readyForCheckout(
      undefined,
      '9999999999.99',
    );
    await db.specialOrderQuotation.update({
      where: { id: quote.quotationId },
      data: {
        publishedAt: new Date(Date.now() - 3 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });
    await db.specialOrderAcceptance.update({
      where: { id: acceptance.id },
      data: { createdAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    const input = pickupInput(acceptance.id);
    const preview = (await requestPreview(id, input).expect(200)).body.data;
    expect(preview.financials.grandTotal).toBe('22800000061.38');
    const order = (
      await confirm(
        id,
        { ...input, previewToken: preview.previewToken },
        randomUUID(),
      ).expect(201)
    ).body.data;
    expect(order.remainingBalance).toBe('22800000061.38');
    expect(order.items[0].totalIncludingTax).toBe('22799999999.98');
    await setCheckoutSettings({
      pickupLocations: [{ ...pickup, name: 'Renamed store' }],
    });
    await scoped(request(app).get(`${base}/my/orders/${order.id}`))
      .expect(200)
      .expect(({ body }) =>
        expect(body.data.pickupLocation.name).toBe(pickup.name),
      );
  });

  it.each(['cancel', 'resubmit'] as const)(
    'serializes checkout confirmation against %s',
    async (action) => {
      await setCheckoutSettings({ pickupLocations: [pickup] });
      const { id, quote, acceptance } = await readyForCheckout();
      const input = pickupInput(acceptance.id);
      const preview = (await requestPreview(id, input).expect(200)).body.data;
      const state = { ...versionOf(quote), status: 'ACCEPTED' };
      const lifecycle =
        action === 'cancel'
          ? scoped(request(app).post(`${base}/my/${id}/cancel`)).send(state)
          : scoped(request(app).patch(`${base}/my/${id}`)).send({
              ...payload,
              resubmit: state,
            });
      const [confirmation, change] = await Promise.all([
        confirm(
          id,
          { ...input, previewToken: preview.previewToken },
          randomUUID(),
        ),
        lifecycle,
      ]);
      expect([
        [201, 409],
        [409, 200],
      ]).toContainEqual([confirmation.status, change.status]);
      expect(await db.specialOrder.count({ where: { requestId: id } })).toBe(
        confirmation.status === 201 ? 1 : 0,
      );
      await requestPreview(id, input).expect(409);
    },
  );

  it('installs required financial checks and uniqueness constraints', async () => {
    const checks = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid IN ('"SpecialOrder"'::regclass, '"SpecialOrderItem"'::regclass)
    `;
    expect(checks.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        'SpecialOrder_payment_split_check',
        'SpecialOrder_fulfillment_snapshot_check',
        'SpecialOrderItem_amounts_check',
        'SpecialOrder_tenantId_customerId_requestId_fkey',
        'SpecialOrder_acceptanceId_fkey',
        'SpecialOrderItem_quotationItemId_fkey',
      ]),
    );
    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'SpecialOrder' AND indexdef LIKE 'CREATE UNIQUE INDEX%'
    `;
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'SpecialOrder_requestId_key',
        'SpecialOrder_acceptanceId_key',
        'SpecialOrder_tenantId_number_key',
        'SpecialOrder_tenantId_customerId_idempotencyKey_key',
      ]),
    );
  });
});
