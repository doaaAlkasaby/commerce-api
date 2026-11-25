import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { testPrisma as db } from '../../src/config/test-database.js';
import type { Prisma } from '../../src/generated/prisma/client.js';

const merchant = randomUUID();
const customer = randomUUID();
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const date = new Date('2026-01-02T12:00:00Z');
const after = new Date('2026-01-04T12:00:00Z');
const range = { from: '2026-01-02', to: '2026-01-02' };
const tokens = new Map<string, string>();
let number = 1000;
let productId: string;
let variantId: string;

function get(
  endpoint: string,
  query = range,
  tenant = tenantId,
  actor = merchant,
) {
  return request(app)
    .get(`/api/v1/special-orders/analytics/${endpoint}`)
    .set('X-Tenant-Slug', tenant)
    .auth(tokens.get(actor)!, { type: 'bearer' })
    .query(query);
}

async function submitted(
  items: Prisma.SpecialOrderRequestItemCreateWithoutRequestInput[],
  options: {
    tenant?: string;
    createdAt?: Date;
    status?: Prisma.SpecialOrderRequestCreateInput['status'];
  } = {},
) {
  return db.specialOrderRequest.create({
    data: {
      tenantId: options.tenant ?? tenantId,
      customerId: customer,
      number: ++number,
      contactPhone: '+15555550100',
      notes: 'private request note',
      idempotencyKey: randomUUID(),
      requestFingerprint: 'fixture',
      createdAt: options.createdAt ?? date,
      status: options.status ?? 'NEW',
      history: [
        { action: 'QUOTED' },
        { action: 'QUOTED' },
        { action: 'RESUBMITTED' },
      ],
      items: { create: items },
    },
  });
}

async function confirmed(
  source: Awaited<ReturnType<typeof submitted>>,
  amount: string,
  currency: string,
  warehouseId?: string,
) {
  const state = warehouseId ? 'PICKED_UP' : 'PENDING_SOURCING';
  const quotation = await db.specialOrderQuotation.create({
    data: {
      requestId: source.id,
      tenantId: source.tenantId,
      isDraft: false,
      status: 'ACCEPTED',
      currency,
      taxCountryCode: 'US',
      sourcingDays: 2,
      publishedAt: date,
      expiresAt: after,
      items: {
        create: {
          name: 'Merchant suggestion',
          type: 'SUGGESTED',
          position: 0,
          offeredQuantity: 2,
          unitPrice: 1,
          pricesIncludeTax: false,
          tax: {},
        },
      },
      acceptance: {
        create: { selectionKey: 'fixture', snapshot: {}, consumedAt: date },
      },
    },
    include: { items: true, acceptance: true },
  });
  return db.specialOrder.create({
    data: {
      tenantId: source.tenantId,
      requestId: source.id,
      acceptanceId: quotation.acceptance!.id,
      customerId: customer,
      number: source.number,
      currency,
      state,
      paymentStatus: warehouseId ? 'PAID' : 'PENDING',
      fulfillmentMethod: 'STORE_PICKUP',
      customerFirstName: 'Private',
      customerLastName: 'Person',
      customerEmail: 'private@example.test',
      customerPhone: source.contactPhone,
      pickupLocation: { id: 'pickup' },
      grandTotal: amount,
      remainingBalance: warehouseId ? '20.000' : amount,
      initialPayment: warehouseId ? '10.000' : 0,
      financials: {
        sourcingFeeTotalIncludingTax: warehouseId ? '2.500' : '0',
        shippingTotalIncludingTax: '0',
      },
      paymentTerms: {},
      commercialTerms: {},
      sourcingDays: 2,
      idempotencyKey: randomUUID(),
      requestFingerprint: 'fixture',
      createdAt: date,
      ...(warehouseId && {
        warehouseId,
        sourcingStartedAt: date,
        readyAt: date,
        completedAt: date,
      }),
      items: {
        create: {
          quotationItemId: quotation.items[0]!.id,
          position: 0,
          name: 'Merchant suggestion',
          quantity: 2,
          unitPrice: 1,
          tax: {},
          pricesIncludeTax: false,
          subtotalBeforeTax: 2,
          taxAmount: 0,
          totalIncludingTax: 2,
          hasImage: false,
        },
      },
    },
  });
}

beforeAll(async () => {
  await db.country.upsert({
    where: { code: 'US' },
    update: {},
    create: { code: 'US', name: 'USA', currencyCode: 'USD' },
  });
  for (const id of [tenantId, otherTenantId])
    await db.tenant.create({
      data: { id, slug: id, code: id, name: 'Analytics fixture' },
    });
  for (const id of [merchant, customer]) {
    await db.user.create({
      data: {
        id,
        email: `${id}@test.example`,
        firstName: 'Fixture',
        lastName: 'User',
        passwordHash: 'fixture',
      },
    });
    await db.tenantMember.createMany({
      data: [tenantId, otherTenantId].map((tenant) => ({
        tenantId: tenant,
        userId: id,
        role: id === merchant ? ('OWNER' as const) : ('CUSTOMER' as const),
      })),
    });
    tokens.set(id, await createAccessToken(id));
  }
  const category = await db.category.create({
    data: { tenantId, name: 'Analytics catalog', slug: randomUUID() },
  });
  const product = await db.product.create({
    data: {
      tenantId,
      categoryId: category.id,
      name: 'Catalog title',
      slug: randomUUID(),
      basePrice: 4,
      variants: {
        create: { sku: randomUUID(), combinationKey: '', isDefault: true },
      },
    },
    include: { variants: true },
  });
  productId = product.id;
  variantId = product.variants[0]!.id;
  const original = await submitted(
    [
      {
        position: 0,
        name: 'Catalog title',
        quantity: 3,
        product: { connect: { id: productId } },
        variant: { connect: { id: variantId } },
      },
      {
        position: 1,
        name: ' Generic   Item ',
        quantity: 2,
        specifications: 'private prescribing instructions',
      },
      {
        position: 2,
        name: 'Patient Jane, prescription information',
        quantity: 1,
      },
    ],
    { status: 'ORDER_CREATED' },
  );
  await submitted([{ position: 0, name: 'generic item', quantity: 4 }], {
    status: 'QUOTED',
  });
  await submitted([{ position: 0, name: 'Outside range', quantity: 100 }], {
    createdAt: after,
  });
  await submitted([{ position: 0, name: 'Foreign request', quantity: 200 }], {
    tenant: otherTenantId,
  });
  const location = await db.warehouse.create({
    data: {
      tenantId,
      code: 'analytics',
      name: 'Fixture warehouse',
      countryCode: 'US',
      city: 'Fixture',
      address: 'Fixture',
    },
  });
  const paid = await confirmed(original, '30.000', 'KWD', location.id);
  const cancelled = await confirmed(
    await submitted([], { status: 'ORDER_CREATED' }),
    '12.00',
    'USD',
  );
  await db.specialOrder.update({
    where: { id: cancelled.id },
    data: { cancellationStatus: 'CANCELLED' },
  });
  await confirmed(
    await submitted([], { status: 'ORDER_CREATED' }),
    '7.00',
    'USD',
  );

  const initial = await db.specialOrderPayment.create({
    data: {
      tenantId,
      orderId: paid.id,
      kind: 'INITIAL',
      method: 'ONLINE',
      amount: 10,
      currency: 'KWD',
      expiresAt: after,
    },
  });
  const balance = await db.specialOrderPayment.create({
    data: {
      tenantId,
      orderId: paid.id,
      kind: 'BALANCE',
      method: 'CASH',
      amount: 20,
      currency: 'KWD',
    },
  });
  const account = await db.paymentProviderAccount.create({
    data: {
      provider: 'MYFATOORAH',
      environment: 'MOCK',
      accountKey: tenantId,
      ownerTenantId: tenantId,
      countryCode: 'KWT',
      currency: 'KWD',
      status: 'ACTIVE',
    },
  });
  await db.paymentProviderAccountTenant.create({
    data: {
      tenantId,
      providerAccountId: account.id,
      provider: 'MYFATOORAH',
      environment: 'MOCK',
    },
  });
  const attempt = await db.specialOrderPaymentAttempt.create({
    data: {
      tenantId,
      obligationId: initial.id,
      idempotencyKey: randomUUID(),
      provider: 'MYFATOORAH',
      providerAccountId: account.id,
      providerEnvironment: 'MOCK',
      credentialVersion: account.credentialVersion,
      status: 'PAID',
      initiationState: 'INITIATED',
    },
  });
  const online = await db.specialOrderPaymentSettlement.create({
    data: {
      tenantId,
      attemptId: attempt.id,
      provider: 'MYFATOORAH',
      transactionId: randomUUID(),
      providerTransactionId: randomUUID(),
      amount: 10,
      currency: 'KWD',
      attributable: true,
      verifiedAt: date,
    },
  });
  const handover = await db.specialOrderFulfillmentEvent.create({
    data: {
      tenantId,
      orderId: paid.id,
      action: 'PICK_UP',
      key: randomUUID(),
      fingerprint: 'fixture',
      actorId: merchant,
      evidence: {
        handedOver: true,
        cash: { observedAmount: '20.000', currency: 'KWD' },
      },
      occurredAt: date,
    },
  });
  await db.specialOrderPaymentSettlement.create({
    data: {
      tenantId,
      cashObligationId: balance.id,
      cashEventId: handover.id,
      provider: 'NONE',
      transactionId: randomUUID(),
      providerTransactionId: randomUUID(),
      amount: 20,
      currency: 'KWD',
      attributable: true,
      verifiedAt: date,
    },
  });
  await db.specialOrderFulfillmentEvent.create({
    data: {
      tenantId,
      orderId: paid.id,
      action: 'REMIT_CASH',
      key: randomUUID(),
      fingerprint: 'fixture',
      actorId: merchant,
      evidence: { reference: 'fixture' },
      occurredAt: date,
    },
  });
  await db.specialOrderRefund.createMany({
    data: [
      {
        tenantId,
        orderId: paid.id,
        settlementId: online.id,
        sourceKey: 'fixture-settled',
        amount: 2,
        currency: 'KWD',
        state: 'SETTLED',
        createdAt: date,
        updatedAt: date,
      },
      {
        tenantId,
        orderId: paid.id,
        settlementId: online.id,
        sourceKey: 'fixture-due',
        amount: 3,
        currency: 'KWD',
        state: 'DUE',
        createdAt: date,
        updatedAt: date,
      },
    ],
  });
  await db.specialOrderReturn.create({
    data: {
      tenantId,
      orderId: paid.id,
      items: [],
      status: 'RECEIVED',
      receipt: { receivedAt: date.toISOString() },
      createdAt: date,
    },
  });
});

describe('Special Order analytics', () => {
  it('bounds date ranges, guards merchant access and keeps tenant counts separate', async () => {
    await get('overview', range, tenantId, customer).expect(403);
    await get('overview', { from: '2025-01-01', to: '2026-01-02' }).expect(400);
    await get('overview', { from: '2026-01-03', to: '2026-01-02' }).expect(400);
    await get('overview', { from: '2026-01-02', to: '2026-02-30' }).expect(400);
    const response = (await get('overview').expect(200)).body.data;
    expect(response).toMatchObject({
      requests: { submitted: 4, quoted: 1, awaitingReview: 0 },
      orders: { confirmedOrders: 3, completedOrders: 1, cancelledOrders: 1 },
      activity: {
        returnCasesOpened: 1,
        returnCasesReceived: 1,
        refundsAllocated: 2,
        refundsSettled: 1,
      },
      conversion: { submittedRequests: 4, convertedRequests: 3, rate: 0.75 },
    });
    expect(
      (await get('overview', range, otherTenantId).expect(200)).body.data
        .conversion,
    ).toEqual({ submittedRequests: 1, convertedRequests: 0, rate: 0 });
    expect(
      (
        await get('overview', { from: '2026-01-01', to: '2026-01-01' }).expect(
          200,
        )
      ).body.data.conversion,
    ).toEqual({ submittedRequests: 0, convertedRequests: 0, rate: 0 });
  });

  it('groups demand by identity or normalized title without counting suggestions as submissions', async () => {
    const response = (await get('demand').expect(200)).body.data;
    expect(response.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'CATALOG',
          productId,
          variantId,
          requestedQuantity: 3,
        }),
        expect.objectContaining({
          kind: 'NON_CATALOG',
          name: 'generic item',
          requestedQuantity: 6,
        }),
        expect.objectContaining({
          name: 'merchant suggestion',
          requestedQuantity: 0,
          confirmedQuantity: 6,
          suggestedConfirmedQuantity: 6,
          fulfilledQuantity: 2,
        }),
        expect.objectContaining({
          name: null,
          kind: 'NON_CATALOG',
          requestedQuantity: 1,
        }),
      ]),
    );
    expect(JSON.stringify(response)).not.toMatch(
      /private|prescribing|patient jane|foreign request|outside range/i,
    );
    const empty = (
      await get('demand', {
        ...range,
        page: '99',
        limit: '2',
      } as typeof range).expect(200)
    ).body.data;
    expect(empty.items).toEqual([]);
    expect(empty.pagination.total).toBe(4);
  });

  it('separates currencies, refunds and collections, excluding cancelled debt and remittance', async () => {
    const response = (await get('financial').expect(200)).body.data;
    expect(response.byCurrency).toEqual([
      expect.objectContaining({
        currency: 'KWD',
        confirmedOrderValue: '30.000',
        quotedSourcingFeesIncludingTax: '2.500',
        verifiedCashCollections: '20.000',
        verifiedOnlineCollections: '10.000',
        verifiedCollections: '30.000',
        settledRefunds: '2.000',
        refundDue: '3.000',
        netCollected: '28.000',
        outstanding: '0.000',
      }),
      expect.objectContaining({
        currency: 'USD',
        confirmedOrderValue: '19.00',
        verifiedCollections: '0.00',
        outstanding: '7.00',
      }),
    ]);
    expect(
      (await get('financial', range, otherTenantId).expect(200)).body.data
        .byCurrency,
    ).toEqual([]);
  });
});
