import { AppError } from '../../src/common/errors/app-error.js';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: { ...actual.env, PAYMENT_PROVIDER: 'MOCK' },
  };
});

import app from '../../src/app.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { env } from '../../src/config/env.js';
import { testPrisma as db } from '../../src/config/test-database.js';
import { MockMyFatoorahProvider } from '../../src/modules/payments/providers/mock-myfatoorah.provider.js';
import { MyFatoorahProvider } from '../../src/modules/payments/providers/myfatoorah.provider.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import { recoverSpecialPaymentAttempts } from '../../src/modules/special-orders/special-order-payments.service.js';

const base = '/api/v1/special-orders';
const tenantId = randomUUID();
const tenantSlug = `payments-${tenantId}`;
const customerId = randomUUID();
const otherId = randomUUID();
const merchantId = randomUUID();
const fulfillmentMerchantId = randomUUID();
const resolutionMerchantId = randomUUID();
const resolutionCustomerId = randomUUID();
const tokens = new Map<string, string>();

const scoped = (call: request.Test, userId = customerId) =>
  call
    .set('X-Tenant-Slug', tenantSlug)
    .auth(tokens.get(userId)!, { type: 'bearer' });
const call = (path: string, userId = customerId) =>
  scoped(request(app).get(base + path), userId);
const post = (path: string, userId = customerId) =>
  scoped(request(app).post(base + path), userId);
const pathFor = (id: string) => `/my/orders/${id}/payment`;
const initiate = (
  id: string,
  obligationId: string,
  key = randomUUID(),
  user = customerId,
) =>
  post(`${pathFor(id)}/attempts`, user)
    .set('Idempotency-Key', key)
    .send({ obligationId });
const verify = (id: string, attemptId: string, buyer = customerId) =>
  post(`${pathFor(id)}/attempts/${attemptId}/verify`, buyer).send({});

beforeAll(async () => {
  vi.stubEnv(
    'MOCK_CHECKOUT_SECRET',
    'test-mock-special-checkout-secret-1234567890',
  );
  await db.country.upsert({
    where: { code: 'KW' },
    create: { code: 'KW', name: 'Kuwait', currencyCode: 'KWD' },
    update: {},
  });
  await db.tenant.create({
    data: {
      id: tenantId,
      slug: tenantSlug,
      code: tenantSlug,
      name: 'Special Payment Store',
      defaultCountryCode: 'KW',
      defaultCurrency: 'KWD',
    },
  });
  for (const id of [
    customerId,
    otherId,
    merchantId,
    fulfillmentMerchantId,
    resolutionMerchantId,
    resolutionCustomerId,
  ]) {
    await db.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        firstName: 'Test',
        lastName: 'Customer',
        passwordHash: 'fixture',
        emailVerifiedAt: new Date(),
      },
    });
    await db.tenantMember.create({
      data: {
        tenantId,
        userId: id,
        role: [
          merchantId,
          fulfillmentMerchantId,
          resolutionMerchantId,
        ].includes(id)
          ? 'OWNER'
          : 'CUSTOMER',
      },
    });
    tokens.set(id, await createAccessToken(id));
  }
  const tax = await db.taxCategory.create({
    data: { tenantId, code: 'NONE', name: 'No tax', treatment: 'ZERO_RATED' },
  });
  await db.taxRule.create({
    data: { taxCategoryId: tax.id, countryCode: 'KW', rate: '0' },
  });
  await db.taxProfile.create({
    data: {
      tenantId,
      countryCode: 'KW',
      currency: 'KWD',
      defaultTaxCategoryId: tax.id,
    },
  });
  await db.appSetting.createMany({
    data: [
      { tenantId, key: 'special_orders', value: { enabled: true } },
      {
        tenantId,
        key: 'special_checkout',
        value: {
          pickupLocations: [
            {
              id: 'store',
              enabled: true,
              name: 'Main Store',
              address: '1 Main Street',
              countryCode: 'KW',
              regionCode: 'CAPITAL',
            },
          ],
        },
      },
    ],
  });
  const account = await db.paymentProviderAccount.create({
    data: {
      provider: 'MYFATOORAH',
      environment: 'MOCK',
      accountKey: tenantSlug,
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
});

afterAll(async () => {
  // The push worker reads a global queue shared by suites in this disposable database.
  await db.notificationPushJob.deleteMany({ where: { tenantId } });
});

async function checkout(
  term: { method: string; deposit?: object },
  catalog?: { productId: string; variantId: string },
  buyer = customerId,
  deliveryAddressId?: string,
  seller = merchantId,
) {
  const original = (
    await post('/my', buyer)
      .set('Idempotency-Key', randomUUID())
      .send({
        contactPhone: '+96555551234',
        items: [{ name: 'Special item', quantity: 2 }],
      })
      .expect(201)
  ).body.data;
  await post(`/${original.id}/review`, seller).expect(200);
  const draft = (
    await scoped(
      request(app).put(`${base}/${original.id}/quotation/draft`),
      seller,
    )
      .send({
        sourcingDays: 2,
        sourcingFee: '3.250',
        paymentTerms: [term],
        items: [
          {
            type: 'AVAILABLE',
            name: 'Special item',
            offeredQuantity: 2,
            unitPrice: '10.005',
            pricesIncludeTax: false,
            ...catalog,
          },
          ...(catalog
            ? [
                {
                  type: 'SUGGESTED',
                  name: 'Manual item',
                  offeredQuantity: 1,
                  unitPrice: '1.125',
                  pricesIncludeTax: false,
                },
              ]
            : []),
        ],
      })
      .expect(200)
  ).body.data;
  const version = { quotationId: draft.quotationId, version: draft.version };
  await post(`/${original.id}/quotation/publish`, seller)
    .send(version)
    .expect(200);
  const acceptance = (
    await post(`/my/${original.id}/quotation/accept`, buyer)
      .send({
        ...version,
        items: [
          { itemId: draft.availableProducts[0].id, quantity: 2 },
          ...(catalog
            ? [{ itemId: draft.suggestedProducts[0].id, quantity: 1 }]
            : []),
        ],
      })
      .expect(200)
  ).body.data;
  const choices = {
    acceptanceId: acceptance.id,
    fulfillment: deliveryAddressId
      ? {
          method: 'HOME_DELIVERY',
          addressId: deliveryAddressId,
          shippingMethodCode: 'standard',
        }
      : { method: 'STORE_PICKUP', pickupLocationId: 'store' },
    paymentMethod: term.method,
  };
  const preview = (
    await post(`/my/${original.id}/checkout/preview`, buyer)
      .send(choices)
      .expect(200)
  ).body.data;
  return (
    await post(`/my/${original.id}/checkout/confirm`, buyer)
      .set('Idempotency-Key', randomUUID())
      .send({ ...choices, previewToken: preview.previewToken })
      .expect(201)
  ).body.data;
}

async function scenario(url: string, status: string, buyer = customerId) {
  const parsed = new URL(url);
  return scoped(
    request(app).post(`${parsed.pathname}/scenario${parsed.search}`),
    buyer,
  )
    .send({ status })
    .expect(200);
}

async function initial(id: string) {
  const summary = (await call(pathFor(id)).expect(200)).body.data;
  return summary.obligations.find(
    ({ kind }: { kind: string }) => kind === 'INITIAL',
  );
}

describe('Special Order payment lifecycle', () => {
  it('keeps cash outstanding with the initial sourcing gate open and no fake settlement', async () => {
    const order = await checkout({ method: 'CASH_ON_FULFILLMENT' });
    expect(order.paymentSummary).toMatchObject({
      grandTotal: '23.260',
      verifiedCollected: '0.000',
      outstanding: '23.260',
      status: 'PENDING',
      initialSourcingPrerequisiteSatisfied: true,
      furtherPaymentAllowed: false,
    });
    expect(
      await db.specialOrderPaymentAttempt.count({
        where: { obligation: { orderId: order.id } },
      }),
    ).toBe(0);
  });

  it('claims one full advance attempt and only settles after trusted verification', async () => {
    const count = () =>
      Promise.all([
        db.order.count(),
        db.cart.count(),
        db.payment.count(),
        db.inventoryTransaction.count(),
      ]);
    const before = await count();
    const order = await checkout({ method: 'FULL_ADVANCE_ONLINE' });
    expect(order.paymentSummary.initialSourcingPrerequisiteSatisfied).toBe(
      false,
    );
    const location = await warehouse();
    await source(order.id, { action: 'START', warehouseId: location.id })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('SPECIAL_SOURCING_FINANCIAL_BLOCK'),
      );
    const obligation = await initial(order.id);
    expect(obligation.amount).toBe('23.260');
    expect(
      new Date(obligation.expiresAt).getTime() - Date.now(),
    ).toBeGreaterThan(29 * 60_000);
    await initiate(order.id, obligation.id, randomUUID(), otherId).expect(404);
    await call(`/orders/${order.id}/payment`).expect(403);
    const key = randomUUID();
    const replies = await Promise.all([
      initiate(order.id, obligation.id, key),
      initiate(order.id, obligation.id, key),
    ]);
    expect(replies.map(({ status }) => status).sort()).toEqual([200, 201]);
    const attempt = replies.find(({ status }) => status === 201)!.body.data;
    expect(replies[0]!.body.data.id).toBe(attempt.id);
    await initiate(order.id, obligation.id).expect(409);
    await scenario(attempt.checkoutUrl, 'PAID');
    expect(
      (await call(pathFor(order.id)).expect(200)).body.data.verifiedCollected,
    ).toBe('0.000');
    MockMyFatoorahProvider.clearMockInvoices();
    await Promise.all([
      verify(order.id, attempt.id).expect(200),
      verify(order.id, attempt.id).expect(200),
    ]);
    const merchant = (
      await call(`/orders/${order.id}/payment`, merchantId).expect(200)
    ).body.data;
    expect(merchant).toMatchObject({
      status: 'PAID',
      outstanding: '0.000',
      verifiedCollected: '23.260',
      initialSourcingPrerequisiteSatisfied: true,
    });
    expect(merchant.obligations[0].attempts[0].settlements).toHaveLength(1);
    expect(
      await db.notification.count({
        where: {
          tenantId,
          eventKey: {
            startsWith: `SPECIAL_ORDER_PAYMENT_VERIFIED:${obligation.id}:`,
          },
        },
      }),
    ).toBe(1);
    expect(await count()).toEqual(before);
  });

  it.each([
    [
      'DEPOSIT_REMAINING_ONLINE',
      { type: 'PERCENTAGE', percentage: '12.50' },
      '2.501',
      '20.759',
    ],
    [
      'DEPOSIT_REMAINING_CASH',
      { type: 'FIXED', amount: '2.345' },
      '2.345',
      '20.915',
    ],
  ] as const)(
    'settles %s and blocks the balance',
    async (method, deposit, amount, balance) => {
      const order = await checkout({ method, deposit });
      const obligation = await initial(order.id);
      expect(obligation.amount).toBe(amount);
      const attempt = (await initiate(order.id, obligation.id).expect(201)).body
        .data;
      await scenario(attempt.checkoutUrl, 'PAID');
      const result = (await verify(order.id, attempt.id).expect(200)).body.data
        .financials;
      expect(result).toMatchObject({
        status: 'PARTIALLY_PAID',
        verifiedCollected: amount,
        outstanding: balance,
        initialSourcingPrerequisiteSatisfied: true,
        furtherPaymentAllowed: false,
      });
      const remaining = result.obligations.find(
        ({ kind }: { kind: string }) => kind === 'BALANCE',
      );
      expect(remaining).toMatchObject({
        amount: balance,
        payable: false,
        expiresAt: null,
      });
      await initiate(order.id, remaining.id).expect(409);
    },
  );

  it('blocks unknown initiation and recovers the same durable attempt', async () => {
    const order = await checkout({ method: 'FULL_ADVANCE_ONLINE' });
    const obligation = await initial(order.id);
    const gateway = vi
      .spyOn(MockMyFatoorahProvider.prototype, 'createPayment')
      .mockRejectedValueOnce(new Error('timeout'));
    const attempt = (await initiate(order.id, obligation.id).expect(201)).body
      .data;
    expect(attempt.initiationState).toBe('UNKNOWN');
    await initiate(order.id, obligation.id).expect(409);
    await db.specialOrderPaymentAttempt.update({
      where: { id: attempt.id },
      data: { recheckAt: new Date(0) },
    });
    await recoverSpecialPaymentAttempts(20, new AbortController().signal);
    expect(gateway).toHaveBeenCalledTimes(2);
    const recovered = (
      await call(`${pathFor(order.id)}/attempts/${attempt.id}`).expect(200)
    ).body.data;
    expect(recovered.initiationState).toBe('INITIATED');
    await scenario(recovered.checkoutUrl, 'FAILED');
    const failed = (await verify(order.id, attempt.id).expect(200)).body.data;
    expect(failed.attempt.status).toBe('FAILED');
    expect(failed.financials.status).toBe('PENDING');
    await db.specialOrderPayment.update({
      where: { id: obligation.id },
      data: { expiresAt: new Date(0) },
    });
    await initiate(order.id, obligation.id).expect(409);
  });

  it('preserves mismatched and multiple verified collection evidence', async () => {
    const order = await checkout({ method: 'FULL_ADVANCE_ONLINE' });
    const obligation = await initial(order.id);
    const attempt = (await initiate(order.id, obligation.id).expect(201)).body
      .data;
    const invoiceId = `mock-inv-${attempt.id}`;
    const otherTransaction = randomUUID();
    vi.spyOn(
      MockMyFatoorahProvider.prototype,
      'getPaymentStatus',
    ).mockResolvedValue({
      invoiceId,
      customerReference: attempt.id,
      orderReference: `SO:${order.id}`,
      currency: 'KWD',
      amount: '23.260',
      status: 'PAID',
      transactionPaymentIds: [invoiceId, otherTransaction],
      collections: [
        {
          transactionId: invoiceId,
          paymentId: invoiceId,
          currency: 'KWD',
          amount: '23.260',
        },
        {
          transactionId: otherTransaction,
          paymentId: otherTransaction,
          currency: 'KWD',
          amount: '24.000',
        },
      ],
    });
    const financials = (await verify(order.id, attempt.id).expect(200)).body
      .data.financials;
    expect(financials).toMatchObject({
      verifiedCollected: '47.260',
      overpaid: '24.000',
      initialSourcingPrerequisiteSatisfied: false,
      furtherPaymentAllowed: false,
      financialConflict: expect.any(String),
    });
    const location = await warehouse();
    await source(order.id, { action: 'START', warehouseId: location.id })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('SPECIAL_SOURCING_FINANCIAL_BLOCK'),
      );
    expect(
      await db.specialOrderPaymentSettlement.count({
        where: { attemptId: attempt.id },
      }),
    ).toBe(2);
    await customerResolution(
      order.id,
      { action: 'REQUEST_CANCELLATION', reason: 'Customer cancelled' },
      randomUUID(),
      customerId,
    ).expect(200);
    const { refunds } = await resolution(order.id);
    expect(refunds).toHaveLength(2);
    const gateway = vi.spyOn(MockMyFatoorahProvider.prototype, 'executeRefund');
    await refund(order.id, {
      refundId: refunds[0].id,
      reason: 'Refund the verified collection',
    }).expect(200);
    const updated = await resolution(order.id);
    expect(
      updated.refunds.find(({ id }: { id: string }) => id === refunds[0].id),
    ).toMatchObject({ state: 'UNSUPPORTED' });
    expect(gateway).not.toHaveBeenCalled();
  });

  it('blocks cross-tenant and unauthorized gateway use', async () => {
    const order = await checkout({ method: 'FULL_ADVANCE_ONLINE' });
    const obligation = await initial(order.id);
    const foreign = await db.tenant.create({
      data: {
        slug: `other-${tenantSlug}`,
        code: `other-${tenantSlug}`,
        name: 'Other store',
      },
    });
    await db.tenantMember.create({
      data: { tenantId: foreign.id, userId: customerId, role: 'CUSTOMER' },
    });
    await call(pathFor(order.id))
      .set('X-Tenant-Slug', foreign.slug)
      .expect(404);
    env.PAYMENT_PROVIDER = 'NONE';
    try {
      await initiate(order.id, obligation.id)
        .expect(409)
        .expect(({ body }) =>
          expect(body.code).toBe('SPECIAL_PAYMENT_PROVIDER_UNAVAILABLE'),
        );
    } finally {
      env.PAYMENT_PROVIDER = 'MOCK';
    }
  });

  it('keeps wrong-currency evidence without crediting it to the order currency', async () => {
    const order = await checkout({ method: 'FULL_ADVANCE_ONLINE' });
    const obligation = await initial(order.id);
    const attempt = (await initiate(order.id, obligation.id).expect(201)).body
      .data;
    const invoiceId = `mock-inv-${attempt.id}`;
    vi.spyOn(
      MockMyFatoorahProvider.prototype,
      'getPaymentStatus',
    ).mockResolvedValue({
      invoiceId,
      customerReference: attempt.id,
      orderReference: `SO:${order.id}`,
      amount: obligation.amount,
      currency: 'USD',
      status: 'PAID',
      transactionPaymentIds: [invoiceId],
      transactionId: invoiceId,
      transactionPaymentId: invoiceId,
    });
    const result = (await verify(order.id, attempt.id).expect(200)).body.data
      .financials;
    expect(result).toMatchObject({
      verifiedCollected: '0.000',
      outstanding: obligation.amount,
      initialSourcingPrerequisiteSatisfied: false,
      financialConflict: 'SPECIAL_PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH',
    });
    expect(
      await db.specialOrderPaymentSettlement.findFirst({
        where: { attemptId: attempt.id },
      }),
    ).toMatchObject({ currency: 'USD' });
  });

  it('enforces invoice and collection ownership across regular and Special Orders', async () => {
    const special = await checkout({ method: 'FULL_ADVANCE_ONLINE' });
    const obligation = await initial(special.id);
    const regular = await db.order.create({
      data: {
        tenantId,
        userId: customerId,
        orderNumber: randomUUID(),
        currency: 'KWD',
        subtotal: obligation.amount,
        totalAmount: obligation.amount,
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        shippingAddress: {},
        billingAddress: {},
      },
    });
    const transactionId = randomUUID();
    const payment = await db.payment.create({
      data: {
        orderId: regular.id,
        provider: 'MYFATOORAH',
        method: 'CARD',
        status: 'PAID',
        currency: 'KWD',
        amount: obligation.amount,
        providerTransactionId: transactionId,
      },
    });
    const attempt = (await initiate(special.id, obligation.id).expect(201)).body
      .data;
    const invoiceId = `mock-inv-${attempt.id}`;
    await expect(
      db.myFatoorahInvoice.create({
        data: { paymentId: payment.id, invoiceId },
      }),
    ).rejects.toThrow();
    const specialTransaction = randomUUID();
    vi.spyOn(
      MockMyFatoorahProvider.prototype,
      'getPaymentStatus',
    ).mockResolvedValue({
      invoiceId,
      customerReference: attempt.id,
      orderReference: `SO:${special.id}`,
      amount: obligation.amount,
      currency: 'KWD',
      status: 'PAID',
      transactionPaymentIds: [transactionId, specialTransaction],
      collections: [
        {
          paymentId: transactionId,
          transactionId,
          currency: 'KWD',
          amount: obligation.amount,
        },
        {
          paymentId: specialTransaction,
          transactionId: specialTransaction,
          currency: 'KWD',
          amount: obligation.amount,
        },
      ],
    });
    const result = (await verify(special.id, attempt.id).expect(200)).body.data
      .financials;
    expect(result.financialConflict).toBe(
      'SPECIAL_PAYMENT_PROVIDER_IDENTITY_CONFLICT',
    );
    expect(
      await db.specialOrderPaymentSettlement.findFirst({
        where: { attemptId: attempt.id, transactionId },
      }),
    ).toMatchObject({ attributable: false });
    await expect(
      db.payment.update({
        where: { id: payment.id },
        data: { providerTransactionId: specialTransaction },
      }),
    ).rejects.toThrow();
  });

  const source = (
    id: string,
    input: object,
    key = randomUUID(),
    actor = merchantId,
  ) =>
    post(`/orders/${id}/sourcing`, actor)
      .set('Idempotency-Key', key)
      .send(input);

  const warehouse = (owner = tenantId, region = 'CAPITAL') =>
    db.warehouse.create({
      data: {
        tenantId: owner,
        name: 'Sourcing warehouse',
        code: randomUUID(),
        countryCode: 'KW',
        region,
        city: 'Kuwait City',
        address: 'Fixture',
      },
    });

  it('reserves and receives mixed products exclusively, with idempotent actions and safe readiness', async () => {
    const location = await warehouse();
    const alternate = await warehouse();
    const incompatible = await warehouse(tenantId, 'OTHER');
    const foreign = await db.tenant.create({
      data: {
        slug: randomUUID(),
        code: randomUUID(),
        name: 'Foreign sourcing',
      },
    });
    const foreignLocation = await warehouse(foreign.id);
    const category = await db.category.create({
      data: { tenantId, name: 'Sourcing', slug: randomUUID() },
    });
    const product = await db.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Catalog fixture',
        slug: randomUUID(),
        basePrice: 5,
        variants: {
          create: {
            sku: randomUUID(),
            combinationKey: 'DEFAULT',
            isDefault: true,
          },
        },
      },
      include: { variants: true },
    });
    const catalog = {
      productId: product.id,
      variantId: product.variants[0]!.id,
    };
    const inventory = await db.inventory.create({
      data: {
        tenantId,
        warehouseId: location.id,
        variantId: catalog.variantId,
        quantity: 1,
      },
    });
    const order = await checkout({ method: 'CASH_ON_FULFILLMENT' }, catalog);
    const second = await checkout({ method: 'CASH_ON_FULFILLMENT' }, catalog);
    await source(
      order.id,
      { action: 'START', warehouseId: location.id },
      randomUUID(),
      customerId,
    ).expect(403);
    await source(order.id, {
      action: 'START',
      warehouseId: foreignLocation.id,
    }).expect(409);
    await source(order.id, {
      action: 'START',
      warehouseId: incompatible.id,
    }).expect(409);
    await Promise.all([
      source(order.id, { action: 'START', warehouseId: location.id }).expect(
        200,
      ),
      source(second.id, { action: 'START', warehouseId: location.id }).expect(
        200,
      ),
    ]);
    const read = async (id: string) =>
      (await call(`/orders/${id}/sourcing`, merchantId).expect(200)).body.data;
    const results = await Promise.all([read(order.id), read(second.id)]);
    expect(
      results.reduce(
        (sum, value) => sum + value.items[0].reservedCatalogQuantity,
        0,
      ),
    ).toBe(1);
    const selected = results[0].items[0].reservedCatalogQuantity
      ? order
      : second;
    const itemId = selected.items[0].id;
    await source(selected.id, {
      action: 'START',
      warehouseId: alternate.id,
    }).expect(409);
    await source(selected.id, { action: 'READY' }).expect(409);
    await source(selected.id, {
      action: 'RECEIVE',
      itemId,
      quantity: 2,
    }).expect(409);
    const receipt = { action: 'RECEIVE', itemId, quantity: 1 };
    const key = randomUUID();
    await Promise.all([
      source(selected.id, receipt, key).expect(200),
      source(selected.id, receipt, key).expect(200),
    ]);
    await source(selected.id, { ...receipt, quantity: 2 }, key).expect(409);
    const row = await db.inventory.findUniqueOrThrow({
      where: { id: inventory.id },
    });
    expect(row).toMatchObject({ quantity: 2, reservedQuantity: 2 });
    const movements = await db.inventoryTransaction.findMany({
      where: { inventoryId: inventory.id },
    });
    expect(movements.map(({ type }) => type).sort()).toEqual([
      'RESERVATION',
      'RESERVATION',
      'STOCK_IN',
    ]);
    const referenceId = movements[0]!.referenceId;
    await scoped(
      request(app).post(`/api/v1/inventory/${inventory.id}/stock-in`),
      merchantId,
    )
      .send({ quantity: 1, referenceId })
      .expect(400);
    await source(selected.id, {
      action: 'SECURE',
      itemId: selected.items[1].id,
      quantity: 1,
    }).expect(200);
    const readyKey = randomUUID();
    const ready = (
      await source(selected.id, { action: 'READY' }, readyKey).expect(200)
    ).body.data;
    await source(selected.id, { action: 'READY' }, readyKey).expect(200);
    expect(ready).toMatchObject({
      state: 'READY_FOR_FULFILLMENT',
      readyAt: expect.any(String),
      blockers: [],
    });
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 2, reservedQuantity: 2 });
    expect(
      await db.inventoryTransaction.count({
        where: { inventoryId: inventory.id },
      }),
    ).toBe(3);
    // The database also protects the assignment from a direct update.
    await expect(
      db.specialOrder.update({
        where: { id: selected.id },
        data: { warehouseId: alternate.id },
      }),
    ).rejects.toThrow();
    const customer = (await call(`/my/orders/${selected.id}`).expect(200)).body
      .data;
    expect(customer.sourcing).not.toHaveProperty('warehouse');
    expect(customer.items[0]).not.toHaveProperty('sourcingEntries');
    const merchant = (
      await call(`/orders/${selected.id}`, merchantId).expect(200)
    ).body.data;
    expect(merchant.sourcing.warehouse.id).toBe(location.id);
    expect(await db.inventory.count({ where: { tenantId } })).toBe(1);
  });

  it('shares available inventory safely with concurrent regular checkout', async () => {
    const location = await warehouse();
    await db.warehouseCoverage.create({
      data: { tenantId, warehouseId: location.id, countryCode: 'KW' },
    });
    const category = await db.category.create({
      data: { tenantId, name: 'Concurrent checkout', slug: randomUUID() },
    });
    const product = await db.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Shared stock',
        slug: randomUUID(),
        basePrice: '5.000',
        status: 'ACTIVE',
        variants: {
          create: { sku: randomUUID(), combinationKey: '', isDefault: true },
        },
      },
      include: { variants: true },
    });
    const variantId = product.variants[0]!.id;
    const inventory = await db.inventory.create({
      data: { tenantId, warehouseId: location.id, variantId, quantity: 2 },
    });
    const address = await db.address.create({
      data: {
        userId: otherId,
        firstName: 'Regular',
        lastName: 'Buyer',
        addressLine1: 'Main Street',
        city: 'Kuwait City',
        countryCode: 'KW',
      },
    });
    await db.cart.create({
      data: {
        tenantId,
        userId: otherId,
        items: { create: { variantId, quantity: 2 } },
      },
    });
    await db.shippingProfile.create({
      data: {
        tenantId,
        countryCode: 'KW',
        currency: 'KWD',
        zones: {
          create: {
            countryCode: 'KW',
            code: 'KW',
            name: 'Kuwait',
            methods: {
              create: {
                code: 'standard',
                name: 'Standard',
                rules: { create: { flatRate: 0 } },
              },
            },
          },
        },
      },
    });
    const special = await checkout(
      { method: 'CASH_ON_FULFILLMENT' },
      { productId: product.id, variantId },
    );
    const [sourcing, regular] = await Promise.all([
      source(special.id, { action: 'START', warehouseId: location.id }).expect(
        200,
      ),
      scoped(request(app).post('/api/v1/checkout'), otherId)
        .set('Idempotency-Key', randomUUID())
        .send({
          shippingAddressId: address.id,
          billingSameAsShipping: true,
          shippingMethodCode: 'standard',
          paymentMethod: 'CASH_ON_DELIVERY',
        }),
    ]);
    const reserved = sourcing.body.data.items[0].reservedCatalogQuantity;
    expect([
      [0, 201],
      [2, 409],
    ]).toContainEqual([reserved, regular.status]);
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 2, reservedQuantity: 2 });
    await scoped(
      request(app).post(`/api/v1/inventory/${inventory.id}/stock-in`),
      merchantId,
    )
      .send({ quantity: 2 })
      .expect(200);
    const result = (await source(special.id, { action: 'RESERVE' }).expect(200))
      .body.data;
    expect(result.items[0]).toMatchObject({
      reservedCatalogQuantity: 2,
      remainingQuantity: 0,
    });
  });

  it('opens and settles the original online balance only after authorized readiness', async () => {
    const location = await warehouse();
    const order = await checkout(
      {
        method: 'DEPOSIT_REMAINING_ONLINE',
        deposit: { type: 'FIXED', amount: '2.345' },
      },
      undefined,
      otherId,
    );
    const options = (await call(pathFor(order.id), otherId).expect(200)).body
      .data.obligations;
    const initial = options.find(
      ({ kind }: { kind: string }) => kind === 'INITIAL',
    );
    const balance = options.find(
      ({ kind }: { kind: string }) => kind === 'BALANCE',
    );
    await source(order.id, {
      action: 'START',
      warehouseId: location.id,
    }).expect(409);
    await initiate(order.id, balance.id, randomUUID(), otherId).expect(409);
    const deposit = (
      await initiate(order.id, initial.id, randomUUID(), otherId).expect(201)
    ).body.data;
    await scenario(deposit.checkoutUrl, 'PAID', otherId);
    await verify(order.id, deposit.id, otherId).expect(200);
    await source(order.id, {
      action: 'START',
      warehouseId: location.id,
    }).expect(200);
    await source(order.id, {
      action: 'SECURE',
      itemId: order.items[0].id,
      quantity: 2,
    }).expect(200);
    await initiate(order.id, balance.id, randomUUID(), otherId).expect(409);
    await source(order.id, { action: 'READY' }).expect(200);
    const payment = (
      await initiate(order.id, balance.id, randomUUID(), otherId).expect(201)
    ).body.data;
    await initiate(order.id, balance.id, randomUUID(), otherId).expect(409);
    await scenario(payment.checkoutUrl, 'PAID', otherId);
    const settled = (await verify(order.id, payment.id, otherId).expect(200))
      .body.data.financials;
    expect(settled).toMatchObject({
      status: 'PAID',
      verifiedCollected: '23.260',
      outstanding: '0.000',
      onlinePaymentPrerequisiteSatisfied: true,
      furtherPaymentAllowed: false,
      financialConflict: null,
    });
    expect(
      await db.specialOrderPayment.count({ where: { orderId: order.id } }),
    ).toBe(2);
  });

  it('authenticates a sandbox webhook and deduplicates concurrent customer verification', async () => {
    const config = {
      PAYMENT_PROVIDER: 'MYFATOORAH',
      MYFATOORAH_ENV: 'sandbox',
      MYFATOORAH_API_VERSION: 'v2',
      MYFATOORAH_ACCOUNT_COUNTRY: 'KWT',
      MYFATOORAH_ACCOUNT_CURRENCY: 'KWD',
      MYFATOORAH_API_TOKEN: 'test-only-token',
      MYFATOORAH_WEBHOOK_SECRET: 'test-only-signing',
      MYFATOORAH_CALLBACK_URL: 'https://example.test/callback',
      MYFATOORAH_ERROR_URL: 'https://example.test/error',
    };
    const account = await db.paymentProviderAccount.create({
      data: {
        provider: 'MYFATOORAH',
        environment: 'SANDBOX',
        accountKey: tenantSlug,
        ownerTenantId: tenantId,
        countryCode: 'KWT',
        currency: 'KWD',
        status: 'ACTIVE',
        credentialRef: 'env:MYFATOORAH_API_TOKEN',
      },
    });
    await db.paymentProviderAccountTenant.create({
      data: {
        tenantId,
        providerAccountId: account.id,
        provider: 'MYFATOORAH',
        environment: 'SANDBOX',
      },
    });
    Object.assign(env, config);
    const sandbox = new PaymentProviderRegistry().getProvider('MYFATOORAH');
    const registry = vi.spyOn(PaymentProviderRegistry.prototype, 'getProvider');
    try {
      const invoiceId = '153797883884353512';
      const paymentId = '57931123344873';
      vi.spyOn(MyFatoorahProvider.prototype, 'createPayment').mockResolvedValue(
        {
          status: 'REQUIRES_ACTION',
          providerPaymentId: invoiceId,
          checkoutUrl: 'https://demo.myfatoorah.com/pay',
        },
      );
      const order = await checkout({ method: 'FULL_ADVANCE_ONLINE' });
      const obligation = await initial(order.id);
      const attempt = (await initiate(order.id, obligation.id).expect(201)).body
        .data;
      vi.spyOn(
        MyFatoorahProvider.prototype,
        'getPaymentStatus',
      ).mockResolvedValue({
        invoiceId,
        customerReference: attempt.id,
        orderReference: `SO:${order.id}`,
        amount: obligation.amount,
        currency: 'KWD',
        status: 'PAID',
        transactionPaymentIds: [paymentId],
        transactionId: paymentId,
        transactionPaymentId: paymentId,
      });
      const payload = {
        Event: {
          Code: 1,
          Name: 'PAYMENT_STATUS_CHANGED',
          CountryIsoCode: 'KWT',
          Reference: randomUUID(),
        },
        Data: {
          Invoice: { Id: invoiceId, Status: 'PAID' },
          Transaction: { Status: 'SUCCESS', PaymentId: paymentId },
        },
      };
      const webhook = () =>
        request(app)
          .post('/api/v1/payment-providers/myfatoorah/webhook')
          .send(payload);
      await webhook().expect(401);
      const signature = createHmac('sha256', config.MYFATOORAH_WEBHOOK_SECRET)
        .update(
          `Invoice.Id=${invoiceId},Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=${paymentId},Invoice.ExternalIdentifier=`,
        )
        .digest('base64');
      const deliver = () =>
        webhook().set('MyFatoorah-Signature', signature).expect(200);
      await Promise.all([deliver(), verify(order.id, attempt.id).expect(200)]);
      await deliver();
      expect(
        await db.specialOrderPaymentSettlement.count({
          where: { attemptId: attempt.id },
        }),
      ).toBe(1);

      const lost = await checkout(
        { method: 'FULL_ADVANCE_ONLINE' },
        undefined,
        otherId,
      );
      const lostObligation = (await call(pathFor(lost.id), otherId).expect(200))
        .body.data.obligations[0];
      vi.mocked(
        MyFatoorahProvider.prototype.createPayment,
      ).mockRejectedValueOnce(new Error('Response lost'));
      const lostAttempt = (
        await initiate(
          lost.id,
          lostObligation.id,
          randomUUID(),
          otherId,
        ).expect(201)
      ).body.data;
      expect(lostAttempt.initiationState).toBe('UNKNOWN');
      const lateInvoice = '153797883884353513';
      const firstCollection = '57931123344874';
      const secondCollection = '57931123344875';
      vi.mocked(
        MyFatoorahProvider.prototype.getPaymentStatus,
      ).mockImplementation(async (id, options) => {
        expect(id).toBe(lateInvoice);
        if (!options)
          throw new AppError(
            'Requires reconciliation',
            409,
            'MYFATOORAH_STATUS_UNVERIFIED',
          );
        return {
          invoiceId: id,
          customerReference: lostAttempt.id,
          orderReference: `SO:${lost.id}`,
          amount: lostObligation.amount,
          currency: 'KWD',
          status: 'PAID',
          transactionPaymentIds: [firstCollection, secondCollection],
          collections: [firstCollection, secondCollection].map(
            (collection) => ({
              paymentId: collection,
              transactionId: collection,
              amount: lostObligation.amount,
              currency: 'KWD',
            }),
          ),
        };
      });
      // The app constructs its registry before this test enables sandbox.
      registry.mockReturnValue(sandbox);
      const signedLate = createHmac('sha256', config.MYFATOORAH_WEBHOOK_SECRET)
        .update(
          `Invoice.Id=${lateInvoice},Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=${firstCollection},Invoice.ExternalIdentifier=`,
        )
        .digest('base64');
      await request(app)
        .post('/api/v1/payment-providers/myfatoorah/webhook')
        .set('MyFatoorah-Signature', signedLate)
        .send({
          Event: { ...payload.Event, Reference: randomUUID() },
          Data: {
            Invoice: { Id: lateInvoice, Status: 'PAID' },
            Transaction: { Status: 'SUCCESS', PaymentId: firstCollection },
          },
        })
        .expect(200);
      expect(
        await db.specialOrderPaymentSettlement.count({
          where: { attemptId: lostAttempt.id },
        }),
      ).toBe(2);
      expect(
        (await call(pathFor(lost.id), otherId).expect(200)).body.data,
      ).toMatchObject({
        financialConflict: 'SPECIAL_PAYMENT_MULTIPLE_COLLECTIONS',
        overpaid: lostObligation.amount,
      });
    } finally {
      registry.mockRestore();
      env.PAYMENT_PROVIDER = 'MOCK';
    }
  });
  const fulfillmentCheckout = (
    term: Parameters<typeof checkout>[0],
    catalog?: Parameters<typeof checkout>[1],
    buyer = customerId,
    addressId?: string,
  ) => checkout(term, catalog, buyer, addressId, fulfillmentMerchantId);

  const fulfill = (
    id: string,
    data: object,
    key = randomUUID(),
    actor = fulfillmentMerchantId,
  ) =>
    post(`/orders/${id}/fulfillment`, actor)
      .set('Idempotency-Key', key)
      .send(data);

  const fulfillmentWarehouse = async () => {
    const location = await warehouse();
    await db.warehouseCoverage.create({
      data: { tenantId, warehouseId: location.id, countryCode: 'KW' },
    });
    return location;
  };

  async function makeReady(
    order: {
      id: string;
      items: { id: string; quantity: number; productId: string | null }[];
    },
    warehouseId: string,
  ) {
    await source(
      order.id,
      { action: 'START', warehouseId },
      randomUUID(),
      fulfillmentMerchantId,
    ).expect(200);
    for (const item of order.items.filter(({ productId }) => !productId)) {
      await source(
        order.id,
        {
          action: 'SECURE',
          itemId: item.id,
          quantity: item.quantity,
        },
        randomUUID(),
        fulfillmentMerchantId,
      ).expect(200);
    }
    await source(
      order.id,
      { action: 'READY' },
      randomUUID(),
      fulfillmentMerchantId,
    ).expect(200);
  }

  it('dispatches a mixed cash delivery once, preserves regular stock, and collects and remits cash separately', async () => {
    const location = await fulfillmentWarehouse();
    const category = await db.category.create({
      data: { tenantId, name: 'Dispatch fixture', slug: randomUUID() },
    });
    const product = await db.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Dispatch fixture',
        slug: randomUUID(),
        basePrice: 5,
        variants: {
          create: {
            sku: randomUUID(),
            combinationKey: 'DEFAULT',
            isDefault: true,
          },
        },
      },
      include: { variants: true },
    });
    const variantId = product.variants[0]!.id;
    const inventory = await db.inventory.create({
      data: {
        tenantId,
        warehouseId: location.id,
        variantId,
        quantity: 3,
        reservedQuantity: 1,
      },
    });
    const regularReference = randomUUID();
    await db.inventoryTransaction.create({
      data: {
        inventoryId: inventory.id,
        type: 'RESERVATION',
        quantity: 1,
        referenceId: regularReference,
      },
    });
    const address = await db.address.create({
      data: {
        userId: customerId,
        firstName: 'Delivery',
        lastName: 'Buyer',
        addressLine1: 'Original delivery address',
        city: 'Kuwait City',
        countryCode: 'KW',
      },
    });
    if (
      !(await db.shippingProfile.findFirst({
        where: { tenantId, countryCode: 'KW' },
      }))
    ) {
      await db.shippingProfile.create({
        data: {
          tenantId,
          countryCode: 'KW',
          currency: 'KWD',
          zones: {
            create: {
              countryCode: 'KW',
              code: 'KW',
              name: 'Kuwait',
              methods: {
                create: {
                  code: 'standard',
                  name: 'Standard',
                  rules: { create: { flatRate: 0 } },
                },
              },
            },
          },
        },
      });
    }
    const order = await fulfillmentCheckout(
      { method: 'CASH_ON_FULFILLMENT' },
      { productId: product.id, variantId },
      customerId,
      address.id,
    );
    const dispatch = {
      action: 'DISPATCH',
      deliveryMethod: 'EXTERNAL_CARRIER',
      carrierName: 'Courier',
      trackingNumber: 'parcel-123',
      trackingUrl: 'https://example.test/track/parcel-123',
      estimatedDeliveryAt: new Date(Date.now() + 86_400_000).toISOString(),
      evidence: 'Dispatch receipt',
    };
    await fulfill(order.id, dispatch).expect(409);
    await fulfill(order.id, dispatch, randomUUID(), otherId).expect(403);
    await makeReady(order, location.id);
    const key = randomUUID();
    await fulfill(order.id, {
      ...dispatch,
      shippingAddressId: randomUUID(),
    }).expect(400);
    const outcomes = await Promise.all([
      fulfill(order.id, dispatch, key).expect(200),
      fulfill(order.id, dispatch, key).expect(200),
    ]);
    expect(outcomes[0].body.data).toMatchObject({
      state: 'SHIPPED',
      paymentSummary: { verifiedCollected: '0.000' },
    });
    await fulfill(order.id, dispatch).expect(409);
    await fulfill(order.id, { action: 'COMPLETE' }).expect(409);
    await fulfill(order.id, {
      action: 'DELIVERY_ATTEMPT',
      outcome: 'REFUSED',
      evidence: 'Recipient refused first attempt',
    }).expect(200);
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 1, reservedQuantity: 1 });
    expect(
      await db.inventoryTransaction.count({
        where: { inventoryId: inventory.id, type: 'SALE' },
      }),
    ).toBe(1);
    expect(
      await db.inventoryTransaction.findFirst({
        where: { inventoryId: inventory.id, referenceId: regularReference },
      }),
    ).toMatchObject({ quantity: 1 });
    const cash = {
      observedAmount: order.paymentSummary.grandTotal,
      currency: 'KWD',
      reference: 'Signed cash receipt',
    };
    await fulfill(order.id, {
      action: 'DELIVER',
      handedOver: true,
      cash,
      evidence: 'Customer received all products',
    })
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          state: 'DELIVERED',
          requiresReview: false,
          paymentSummary: { status: 'PAID', outstanding: '0.000' },
        }),
      );
    await fulfill(order.id, {
      action: 'REMIT_CASH',
      reference: 'Treasury receipt',
    }).expect(200);
    await fulfill(order.id, {
      action: 'REMIT_CASH',
      reference: 'Duplicate',
    }).expect(409);
    await fulfill(order.id, { action: 'COMPLETE' }).expect(200);
    await db.address.update({
      where: { id: address.id },
      data: { addressLine1: 'Changed saved address' },
    });
    const customer = (await call(`/my/orders/${order.id}`).expect(200)).body
      .data;
    expect(customer.deliveryAddress.addressLine1).toBe(
      'Original delivery address',
    );
    expect(customer.fulfillment).toMatchObject({
      state: 'DELIVERED',
      trackingNumber: 'parcel-123',
      completedAt: expect.any(String),
    });
    expect(customer.fulfillment).not.toHaveProperty('events');
    expect(
      await db.inventoryTransaction.count({
        where: { inventoryId: inventory.id, type: 'SALE' },
      }),
    ).toBe(1);
    expect(
      await db.specialOrderPaymentSettlement.count({
        where: { cashObligation: { orderId: order.id } },
      }),
    ).toBe(1);
    const settlement = await db.specialOrderPaymentSettlement.findFirstOrThrow({
      where: { cashObligation: { orderId: order.id } },
    });
    await expect(
      db.specialOrderPaymentSettlement.update({
        where: { id: settlement.id },
        data: { amount: '1.000' },
      }),
    ).rejects.toThrow(/Cash settlement does not match/);
    const dispatchEvent =
      await db.specialOrderFulfillmentEvent.findFirstOrThrow({
        where: { orderId: order.id, action: 'DISPATCH' },
      });
    await expect(
      db.specialOrderFulfillmentEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          actorId: fulfillmentMerchantId,
          action: 'DISPATCH',
          key: randomUUID(),
          fingerprint: 'fixture-repeat',
          occurredAt: dispatchEvent.occurredAt,
          evidence: dispatch,
        },
      }),
    ).rejects.toThrow();
  });

  it('holds pickup inventory until physical handover and preserves cash discrepancies for review', async () => {
    const location = await fulfillmentWarehouse();
    const catalogCategory = await db.category.create({
      data: { tenantId, name: 'Pickup fixture', slug: randomUUID() },
    });
    const item = await db.product.create({
      data: {
        tenantId,
        categoryId: catalogCategory.id,
        name: 'Pickup fixture',
        slug: randomUUID(),
        basePrice: 5,
        variants: {
          create: {
            sku: randomUUID(),
            combinationKey: 'DEFAULT',
            isDefault: true,
          },
        },
      },
      include: { variants: true },
    });
    const variantId = item.variants[0]!.id;
    const inventory = await db.inventory.create({
      data: { tenantId, warehouseId: location.id, variantId, quantity: 2 },
    });
    const order = await fulfillmentCheckout(
      { method: 'CASH_ON_FULFILLMENT' },
      { productId: item.id, variantId },
    );
    await makeReady(order, location.id);
    await fulfill(order.id, {
      action: 'PICK_UP',
      handedOver: true,
      evidence: 'Counter evidence',
    }).expect(409);
    await fulfill(order.id, { action: 'AVAILABLE_FOR_PICKUP' }).expect(200);
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 2, reservedQuantity: 2 });
    const handover = {
      action: 'PICK_UP',
      handedOver: true,
      evidence: 'Customer received all products',
      cash: {
        observedAmount: '1.000',
        currency: 'KWD',
        reference: 'Counter receipt',
      },
    };
    const key = randomUUID();
    await Promise.all([
      fulfill(order.id, handover, key).expect(200),
      fulfill(order.id, handover, key).expect(200),
    ]);
    const progress = (
      await call(
        `/orders/${order.id}/fulfillment`,
        fulfillmentMerchantId,
      ).expect(200)
    ).body.data;
    expect(progress).toMatchObject({
      state: 'PICKED_UP',
      requiresReview: true,
      discrepancy: 'CASH_EVIDENCE_INCONSISTENT',
      paymentSummary: { verifiedCollected: '0.000' },
      events: expect.arrayContaining([
        expect.objectContaining({
          action: 'PICK_UP',
          actorId: fulfillmentMerchantId,
          evidence: expect.objectContaining({ cash: handover.cash }),
        }),
      ]),
    });
    await fulfill(order.id, { action: 'COMPLETE' }).expect(409);
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 0, reservedQuantity: 0 });
    expect(
      await db.inventoryTransaction.count({
        where: { inventoryId: inventory.id, type: 'SALE' },
      }),
    ).toBe(1);
    expect(
      await db.specialOrderPaymentSettlement.count({
        where: { cashObligation: { orderId: order.id } },
      }),
    ).toBe(0);
  });

  it.each([
    'FULL_ADVANCE_ONLINE',
    'DEPOSIT_REMAINING_CASH',
    'DEPOSIT_REMAINING_ONLINE',
  ] as const)(
    'enforces the payment and pickup gates for %s',
    async (method) => {
      const location = await fulfillmentWarehouse();
      const order = await fulfillmentCheckout(
        {
          method,
          ...(method !== 'FULL_ADVANCE_ONLINE' && {
            deposit: { type: 'FIXED', amount: '2.345' },
          }),
        },
        undefined,
        otherId,
      );
      const payment = async (kind: string) => {
        const options = (await call(pathFor(order.id), otherId).expect(200))
          .body.data.obligations;
        const obligation = options.find(
          (option: { kind: string }) => option.kind === kind,
        );
        const attempt = (
          await initiate(order.id, obligation.id, randomUUID(), otherId).expect(
            201,
          )
        ).body.data;
        await scenario(attempt.checkoutUrl, 'PAID', otherId);
        await verify(order.id, attempt.id, otherId).expect(200);
      };
      await fulfill(order.id, { action: 'AVAILABLE_FOR_PICKUP' }).expect(409);
      await payment('INITIAL');
      await makeReady(order, location.id);
      if (method === 'DEPOSIT_REMAINING_ONLINE') {
        await fulfill(order.id, { action: 'AVAILABLE_FOR_PICKUP' }).expect(409);
        await payment('BALANCE');
      }
      await fulfill(order.id, { action: 'AVAILABLE_FOR_PICKUP' }).expect(200);
      const correctCash =
        method === 'DEPOSIT_REMAINING_CASH'
          ? {
              cash: {
                observedAmount: '20.915',
                currency: 'KWD',
                reference: 'Customer cash receipt',
              },
            }
          : {};
      await fulfill(order.id, {
        action: 'PICK_UP',
        handedOver: true,
        evidence: 'Counter handover',
        ...correctCash,
      })
        .expect(200)
        .expect(({ body }) =>
          expect(body.data).toMatchObject({
            state: 'PICKED_UP',
            paymentSummary: { status: 'PAID', outstanding: '0.000' },
          }),
        );
      await fulfill(order.id, { action: 'COMPLETE' }).expect(200);
    },
  );
  it('blocks unverified online delivery and a late financial conflict', async () => {
    const location = await fulfillmentWarehouse();
    const address = await db.address.create({
      data: {
        userId: otherId,
        firstName: 'Balance',
        lastName: 'Buyer',
        addressLine1: 'Delivery address',
        city: 'Kuwait City',
        countryCode: 'KW',
      },
    });
    if (
      !(await db.shippingProfile.findFirst({
        where: { tenantId, countryCode: 'KW' },
      }))
    ) {
      await db.shippingProfile.create({
        data: {
          tenantId,
          countryCode: 'KW',
          currency: 'KWD',
          zones: {
            create: {
              countryCode: 'KW',
              code: 'KW',
              name: 'Kuwait',
              methods: {
                create: {
                  code: 'standard',
                  name: 'Standard',
                  rules: { create: { flatRate: 0 } },
                },
              },
            },
          },
        },
      });
    }
    const order = await fulfillmentCheckout(
      {
        method: 'DEPOSIT_REMAINING_ONLINE',
        deposit: { type: 'FIXED', amount: '2.345' },
      },
      undefined,
      otherId,
      address.id,
    );
    const initial = (await call(pathFor(order.id), otherId).expect(200)).body
      .data.obligations[0];
    const attempt = (
      await initiate(order.id, initial.id, randomUUID(), otherId).expect(201)
    ).body.data;
    await scenario(attempt.checkoutUrl, 'PAID', otherId);
    await verify(order.id, attempt.id, otherId).expect(200);
    await makeReady(order, location.id);
    const dispatch = {
      action: 'DISPATCH',
      deliveryMethod: 'MERCHANT',
      evidence: 'Delivery manifest',
    };
    await fulfill(order.id, dispatch)
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('SPECIAL_FULFILLMENT_NOT_ELIGIBLE'),
      );
    const invoiceId = `mock-inv-${attempt.id}`;
    const duplicate = randomUUID();
    vi.spyOn(
      MockMyFatoorahProvider.prototype,
      'getPaymentStatus',
    ).mockResolvedValue({
      invoiceId,
      customerReference: attempt.id,
      orderReference: `SO:${order.id}`,
      amount: initial.amount,
      currency: 'KWD',
      status: 'PAID',
      transactionPaymentIds: [duplicate],
      transactionId: duplicate,
      transactionPaymentId: duplicate,
    });
    await verify(order.id, attempt.id, otherId).expect(200);
    await fulfill(order.id, dispatch)
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('SPECIAL_FULFILLMENT_BLOCKED'),
      );
    expect(
      await db.specialOrderFulfillmentEvent.count({
        where: { orderId: order.id },
      }),
    ).toBe(0);
  });

  it('keeps the checkout pickup snapshot and records inconsistent handover without moving stock', async () => {
    const location = await fulfillmentWarehouse();
    const order = await fulfillmentCheckout({ method: 'CASH_ON_FULFILLMENT' });
    await makeReady(order, location.id);
    const foreign = await db.tenant.create({
      data: {
        slug: randomUUID(),
        code: randomUUID(),
        name: 'Foreign fulfillment',
      },
    });
    await db.tenantMember.create({
      data: {
        tenantId: foreign.id,
        userId: fulfillmentMerchantId,
        role: 'OWNER',
      },
    });
    await fulfill(order.id, { action: 'AVAILABLE_FOR_PICKUP' })
      .set('X-Tenant-Slug', foreign.slug)
      .expect(404);
    await fulfill(order.id, { action: 'AVAILABLE_FOR_PICKUP' }).expect(200);
    const moves = await db.inventoryTransaction.count();
    await fulfill(order.id, {
      action: 'PICK_UP',
      handedOver: false,
      evidence: 'Customer did not take the products',
    })
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          state: 'AWAITING_PICKUP',
          discrepancy: 'HANDOVER_EVIDENCE_INCONSISTENT',
          handedOverAt: null,
        }),
      );
    await fulfill(order.id, { action: 'COMPLETE' }).expect(409);
    expect(await db.inventoryTransaction.count()).toBe(moves);
    const pickupSetting = await db.appSetting.findUniqueOrThrow({
      where: { tenantId_key: { tenantId, key: 'special_checkout' } },
    });
    await db.appSetting.update({
      where: { tenantId_key: { tenantId, key: 'special_checkout' } },
      data: { value: { pickupLocations: [] } },
    });
    const customer = await call(`/my/orders/${order.id}`)
      .expect(200)
      .then(({ body }) => body.data)
      .finally(() =>
        db.appSetting.update({
          where: { id: pickupSetting.id },
          data: { value: pickupSetting.value as object },
        }),
      );
    expect(customer.pickupLocation).toEqual(order.pickupLocation);
    expect(customer.fulfillment).toMatchObject({
      requiresReview: true,
      handedOverAt: null,
    });
    expect(customer.fulfillment).not.toHaveProperty('discrepancy');
  });
  const resolutionCheckout = (
    term: Parameters<typeof checkout>[0],
    catalog?: Parameters<typeof checkout>[1],
    addressId?: string,
  ) =>
    checkout(
      term,
      catalog,
      resolutionCustomerId,
      addressId,
      resolutionMerchantId,
    );
  const customerResolution = (
    id: string,
    body: object,
    key = randomUUID(),
    user = resolutionCustomerId,
  ) =>
    post(`/my/orders/${id}/resolution`, user)
      .set('Idempotency-Key', key)
      .send(body);
  const merchantResolution = (id: string, body: object, key = randomUUID()) =>
    post(`/orders/${id}/resolution`, resolutionMerchantId)
      .set('Idempotency-Key', key)
      .send(body);
  const resolution = async (id: string) =>
    (await call(`/orders/${id}/resolution`, resolutionMerchantId).expect(200))
      .body.data;
  const refund = (id: string, body: object, key = randomUUID()) =>
    post(`/orders/${id}/refunds`, resolutionMerchantId)
      .set('Idempotency-Key', key)
      .send(body);
  async function settleResolutionPayment(orderId: string, status: string) {
    const payment = (
      await call(pathFor(orderId), resolutionCustomerId).expect(200)
    ).body.data.obligations[0];
    const initiated = (
      await initiate(
        orderId,
        payment.id,
        randomUUID(),
        resolutionCustomerId,
      ).expect(201)
    ).body.data;
    await scenario(initiated.checkoutUrl, status, resolutionCustomerId);
    await verify(orderId, initiated.id, resolutionCustomerId).expect(200);
    return { attempt: initiated, amount: payment.amount };
  }
  async function resolutionReady(
    order: {
      id: string;
      items: { id: string; quantity: number; productId: string | null }[];
    },
    warehouseId: string,
  ) {
    const act = (body: object) =>
      source(order.id, body, randomUUID(), resolutionMerchantId).expect(200);
    await act({ action: 'START', warehouseId });
    for (const item of order.items.filter(({ productId }) => !productId)) {
      await act({ action: 'SECURE', itemId: item.id, quantity: item.quantity });
    }
    await act({ action: 'READY' });
  }
  const counter = (id: string, body: object, key = randomUUID()) =>
    fulfill(id, body, key, resolutionMerchantId);

  it('cancels directly before sourcing and keeps uncertain payments under review', async () => {
    const cash = await resolutionCheckout({ method: 'CASH_ON_FULFILLMENT' });
    const requestBody = {
      action: 'REQUEST_CANCELLATION',
      reason: 'Customer requested cancellation',
    };
    await customerResolution(
      cash.id,
      requestBody,
      randomUUID(),
      otherId,
    ).expect(404);
    const key = randomUUID();
    await customerResolution(cash.id, requestBody, key)
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          cancellationStatus: 'CANCELLED',
          refunds: [],
          paymentSummary: { outstanding: '0.000' },
        }),
      );
    await customerResolution(cash.id, requestBody, key).expect(200);
    const online = await resolutionCheckout({ method: 'FULL_ADVANCE_ONLINE' });
    const original = (
      await call(pathFor(online.id), resolutionCustomerId).expect(200)
    ).body.data.obligations[0];
    vi.spyOn(
      MockMyFatoorahProvider.prototype,
      'createPayment',
    ).mockRejectedValueOnce(new Error('Uncertain initiation'));
    const attempt = (
      await initiate(
        online.id,
        original.id,
        randomUUID(),
        resolutionCustomerId,
      ).expect(201)
    ).body.data;
    expect(attempt.initiationState).toBe('UNKNOWN');
    await customerResolution(online.id, requestBody)
      .expect(200)
      .expect(({ body }) =>
        expect(body.data.cancellationStatus).toBe('UNDER_REVIEW'),
      );
    await merchantResolution(online.id, {
      action: 'CANCEL',
      reason: 'Review decision',
    }).expect(409);
    await initiate(
      online.id,
      original.id,
      randomUUID(),
      resolutionCustomerId,
    ).expect(409);
    const location = await fulfillmentWarehouse();
    await source(
      online.id,
      { action: 'START', warehouseId: location.id },
      randomUUID(),
      resolutionMerchantId,
    ).expect(409);
  });

  it('allocates late verified collections without reopening cancellation and executes the mock refund once', async () => {
    const order = await resolutionCheckout({
      method: 'DEPOSIT_REMAINING_CASH',
      deposit: { type: 'FIXED', amount: '2.345' },
    });
    const { attempt, amount } = await settleResolutionPayment(
      order.id,
      'FAILED',
    );
    await customerResolution(order.id, {
      action: 'REQUEST_CANCELLATION',
      reason: 'Customer cancelled before sourcing',
    }).expect(200);
    const invoice = `mock-inv-${attempt.id}`;
    const identity = randomUUID();
    vi.spyOn(
      MockMyFatoorahProvider.prototype,
      'getPaymentStatus',
    ).mockResolvedValue({
      invoiceId: invoice,
      customerReference: attempt.id,
      orderReference: `SO:${order.id}`,
      currency: 'KWD',
      amount,
      status: 'PAID',
      transactionPaymentIds: [identity],
      transactionId: identity,
      transactionPaymentId: identity,
    });
    await verify(order.id, attempt.id, resolutionCustomerId).expect(200);
    await verify(order.id, attempt.id, resolutionCustomerId).expect(200);
    const review = await resolution(order.id);
    expect(review).toMatchObject({
      cancellationStatus: 'CANCELLED',
      paymentSummary: { refundDue: amount },
    });
    expect(review.refunds).toHaveLength(1);
    const allocated = await db.specialOrderRefund.findFirstOrThrow({
      where: { orderId: order.id },
    });
    await expect(
      db.specialOrderRefund.create({
        data: {
          tenantId,
          orderId: order.id,
          settlementId: allocated.settlementId,
          sourceKey: 'fixture-extra',
          amount,
          currency: 'KWD',
        },
      }),
    ).rejects.toThrow(/Refund exceeds its attributable/);
    const gateway = vi.spyOn(MockMyFatoorahProvider.prototype, 'executeRefund');
    const body = {
      refundId: review.refunds[0].id,
      reason: 'Return the complete deposit',
    };
    const key = randomUUID();
    await Promise.all([
      refund(order.id, body, key).expect(200),
      refund(order.id, body, key).expect(200),
    ]);
    expect(gateway).toHaveBeenCalledTimes(1);
    const paid = await resolution(order.id);
    expect(paid.refunds[0].state).toBe('SETTLED');
    expect(paid.paymentSummary).toMatchObject({
      netCollected: '0.000',
      refundDue: '0.000',
      settledRefunds: amount,
    });
    await refund(order.id, body).expect(409);
  });

  it('records uncertain mock refunds and preserves the claim against retries', async () => {
    const order = await resolutionCheckout({ method: 'FULL_ADVANCE_ONLINE' });
    const { attempt } = await settleResolutionPayment(order.id, 'PAID');
    await customerResolution(order.id, {
      action: 'REQUEST_CANCELLATION',
      reason: 'Customer cancelled before sourcing',
    }).expect(200);
    const due = (await resolution(order.id)).refunds[0];
    MockMyFatoorahProvider.enqueueRefundBehavior(`mock-inv-${attempt.id}`, {
      throwError: new Error('Unknown refund result'),
    });
    await refund(order.id, { refundId: due.id, reason: 'Refund prepaid order' })
      .expect(200)
      .expect(({ body }) => expect(body.data.state).toBe('UNKNOWN'));
    await refund(order.id, {
      refundId: due.id,
      reason: 'Retry unknown refund',
    }).expect(409);
    expect((await resolution(order.id)).paymentSummary).toMatchObject({
      refundDue: '23.260',
      settledRefunds: '0.000',
    });
  });

  it('corrects an erroneous receipt, invalidates readiness, and releases only the net reservation on cancellation', async () => {
    const location = await fulfillmentWarehouse();
    const category = await db.category.create({
      data: { tenantId, name: 'Correction', slug: randomUUID() },
    });
    const product = await db.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Correction item',
        slug: randomUUID(),
        basePrice: 5,
        variants: {
          create: {
            sku: randomUUID(),
            combinationKey: 'DEFAULT',
            isDefault: true,
          },
        },
      },
      include: { variants: true },
    });
    const variantId = product.variants[0]!.id;
    const order = await resolutionCheckout(
      { method: 'CASH_ON_FULFILLMENT' },
      { productId: product.id, variantId },
    );
    const act = (body: object) =>
      source(order.id, body, randomUUID(), resolutionMerchantId).expect(200);
    await act({ action: 'START', warehouseId: location.id });
    await act({ action: 'RECEIVE', itemId: order.items[0].id, quantity: 2 });
    await act({ action: 'SECURE', itemId: order.items[1].id, quantity: 1 });
    await act({ action: 'READY' });
    const entry = (await resolution(order.id)).sourcingEntries.find(
      ({ action }: { action: string }) => action === 'RECEIVE',
    );
    const correct = {
      action: 'CORRECT_SOURCING',
      correction: 'REVERSE_RECEIPT',
      quantity: 1,
      entryId: entry.id,
      reason: 'Duplicate physical receipt',
      evidence: 'Verified warehouse count',
    };
    const key = randomUUID();
    await merchantResolution(order.id, correct, key).expect(200);
    await merchantResolution(order.id, correct, key).expect(200);
    expect(
      await db.specialOrder.findUnique({ where: { id: order.id } }),
    ).toMatchObject({ state: 'SOURCING', readyAt: null });
    const inventory = () =>
      db.inventory.findFirst({
        where: { warehouseId: location.id, variantId },
      });
    expect(await inventory()).toMatchObject({
      quantity: 1,
      reservedQuantity: 1,
    });
    await act({ action: 'RECEIVE', itemId: order.items[0].id, quantity: 1 });
    await act({ action: 'READY' });
    await customerResolution(order.id, {
      action: 'REQUEST_CANCELLATION',
      reason: 'Customer changed plans after sourcing',
    })
      .expect(200)
      .expect(({ body }) =>
        expect(body.data.cancellationStatus).toBe('UNDER_REVIEW'),
      );
    await source(
      order.id,
      { action: 'READY' },
      randomUUID(),
      resolutionMerchantId,
    ).expect(409);
    await merchantResolution(order.id, {
      action: 'CANCEL',
      reason: 'Merchant approved cancellation',
    }).expect(200);
    expect(await inventory()).toMatchObject({
      quantity: 2,
      reservedQuantity: 0,
    });
  });

  it('reconciles cash evidence and supports cumulative partial returns and cash repayments', async () => {
    const location = await fulfillmentWarehouse();
    const order = await resolutionCheckout({ method: 'CASH_ON_FULFILLMENT' });
    await resolutionReady(order, location.id);
    await counter(order.id, { action: 'AVAILABLE_FOR_PICKUP' }).expect(200);
    await counter(order.id, {
      action: 'PICK_UP',
      handedOver: true,
      evidence: 'Items transferred',
      cash: {
        observedAmount: '1.000',
        currency: 'KWD',
        reference: 'Incorrect entry',
      },
    }).expect(200);
    await counter(order.id, { action: 'COMPLETE' }).expect(409);
    await merchantResolution(order.id, {
      action: 'RECONCILE_CASH',
      reason: 'Verified signed receipt',
      evidence: 'Signed receipt',
      cash: {
        observedAmount: '23.260',
        currency: 'KWD',
        reference: 'Correct collection',
      },
    }).expect(200);
    await counter(order.id, { action: 'COMPLETE' }).expect(200);
    for (const expected of ['10.005', '13.255']) {
      const selected = [{ itemId: order.items[0].id, quantity: 1 }];
      const response = (
        await customerResolution(order.id, {
          action: 'REQUEST_RETURN',
          reason: 'Return one item',
          items: selected,
        }).expect(200)
      ).body.data;
      const returnId = response.returns.at(-1).id;
      await merchantResolution(order.id, {
        action: 'DECIDE_RETURN',
        reason: 'Approve listed item',
        returnId,
        approved: true,
      }).expect(200);
      const receipt = {
        action: 'RECEIVE_RETURN',
        reason: 'Received and inspected',
        returnId,
        warehouseId: location.id,
        evidence: 'Inspection ticket',
        items: selected.map((line) => ({ ...line, condition: 'SELLABLE' })),
      };
      const key = randomUUID();
      await merchantResolution(order.id, receipt, key).expect(200);
      await merchantResolution(order.id, receipt, key).expect(200);
      const due = (await resolution(order.id)).refunds.find(
        ({ state }: { state: string }) => state === 'DUE',
      );
      expect(due.amount).toBe(expected);
      await refund(order.id, {
        refundId: due.id,
        reason: 'Cash paid back to customer',
        reference: `repayment-${returnId}`,
      }).expect(200);
    }
    await customerResolution(order.id, {
      action: 'REQUEST_RETURN',
      reason: 'Return again',
      items: [{ itemId: order.items[0].id, quantity: 1 }],
    }).expect(409);
    const final = await resolution(order.id);
    expect(final.paymentSummary).toMatchObject({
      settledRefunds: '23.260',
      verifiedCollected: '23.260',
      netCollected: '0.000',
      refundDue: '0.000',
    });
    const original = await db.specialOrderFulfillmentEvent.findFirstOrThrow({
      where: { orderId: order.id, action: 'PICK_UP' },
    });
    expect(original.evidence).toMatchObject({
      cash: { observedAmount: '1.000' },
    });
  });

  it('keeps unsupported online refunds due', async () => {
    const order = await resolutionCheckout({ method: 'FULL_ADVANCE_ONLINE' });
    await settleResolutionPayment(order.id, 'PAID');
    await customerResolution(order.id, {
      action: 'REQUEST_CANCELLATION',
      reason: 'Customer cancelled prepaid order',
    }).expect(200);
    const due = (await resolution(order.id)).refunds[0];
    env.PAYMENT_PROVIDER = 'NONE';
    try {
      const calls = vi.spyOn(MockMyFatoorahProvider.prototype, 'executeRefund');
      await refund(order.id, {
        refundId: due.id,
        reason: 'Check unsupported configuration',
      })
        .expect(200)
        .expect(({ body }) => expect(body.data.state).toBe('UNSUPPORTED'));
      expect(calls).not.toHaveBeenCalled();
      expect((await resolution(order.id)).paymentSummary.refundDue).toBe(
        '23.260',
      );
    } finally {
      env.PAYMENT_PROVIDER = 'MOCK';
    }
  });

  it('receives a refused shipment in documented parts and restocks only inspected sellable units', async () => {
    const location = await fulfillmentWarehouse();
    const category = await db.category.create({
      data: { tenantId, name: 'Warehouse return', slug: randomUUID() },
    });
    const product = await db.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Warehouse return product',
        slug: randomUUID(),
        basePrice: 5,
        variants: {
          create: {
            sku: randomUUID(),
            combinationKey: 'DEFAULT',
            isDefault: true,
          },
        },
      },
      include: { variants: true },
    });
    const variantId = product.variants[0]!.id;
    const inventory = await db.inventory.create({
      data: { tenantId, warehouseId: location.id, variantId, quantity: 2 },
    });
    const address = await db.address.create({
      data: {
        userId: resolutionCustomerId,
        firstName: 'Return',
        lastName: 'Customer',
        addressLine1: 'Main Street',
        city: 'Kuwait City',
        countryCode: 'KW',
      },
    });
    if (
      !(await db.shippingProfile.findFirst({
        where: { tenantId, countryCode: 'KW' },
      }))
    ) {
      await db.shippingProfile.create({
        data: {
          tenantId,
          countryCode: 'KW',
          currency: 'KWD',
          zones: {
            create: {
              countryCode: 'KW',
              code: 'KW',
              name: 'Kuwait',
              methods: {
                create: {
                  code: 'standard',
                  name: 'Standard',
                  rules: { create: { flatRate: 0 } },
                },
              },
            },
          },
        },
      });
    }
    const order = await resolutionCheckout(
      { method: 'CASH_ON_FULFILLMENT' },
      { productId: product.id, variantId },
      address.id,
    );
    await resolutionReady(order, location.id);
    await counter(order.id, {
      action: 'DISPATCH',
      deliveryMethod: 'MERCHANT',
      evidence: 'Manifest',
    }).expect(200);
    await merchantResolution(order.id, {
      action: 'CANCEL',
      reason: 'Still dispatched',
    }).expect(409);
    const receipt = {
      action: 'WAREHOUSE_RETURN',
      warehouseId: location.id,
      reason: 'Refused shipment received',
      evidence: 'Verified inspection',
      items: [{ itemId: order.items[0].id, quantity: 1, condition: 'DAMAGED' }],
    };
    await merchantResolution(order.id, receipt).expect(409);
    await counter(order.id, {
      action: 'DELIVERY_ATTEMPT',
      outcome: 'REFUSED',
      evidence: 'Delivery refused',
    }).expect(200);
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 0, reservedQuantity: 0 });
    await merchantResolution(order.id, receipt).expect(200);
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 0, reservedQuantity: 0 });
    await counter(order.id, {
      action: 'DELIVER',
      handedOver: true,
      evidence: 'Invalid after receipt',
    }).expect(409);
    const finalReceipt = {
      ...receipt,
      items: [
        { itemId: order.items[0].id, quantity: 1, condition: 'SELLABLE' },
        { itemId: order.items[1].id, quantity: 1, condition: 'SELLABLE' },
      ],
    };
    const key = randomUUID();
    await merchantResolution(order.id, finalReceipt, key)
      .expect(200)
      .expect(({ body }) =>
        expect(body.data.cancellationStatus).toBe('CANCELLED'),
      );
    await merchantResolution(order.id, finalReceipt, key).expect(200);
    expect(
      await db.inventory.findUnique({ where: { id: inventory.id } }),
    ).toMatchObject({ quantity: 1, reservedQuantity: 0 });
    expect((await resolution(order.id)).refunds).toEqual([]);
  });
});
