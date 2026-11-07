import { metrics } from '../../src/common/observability/metrics.js';
import { verifyMyFatoorahWebhook } from '../../src/modules/payments/myfatoorah.webhook.js';
import { randomUUID, createHmac } from 'node:crypto';
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
import request from 'supertest';
import app from '../../src/app.js';
import { testPrisma } from '../../src/config/test-database.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { PaymentVerificationService } from '../../src/modules/payments/payment-verification.service.js';
import { OrderService } from '../../src/modules/orders/order.service.js';
import { CheckoutService } from '../../src/modules/checkout/checkout.service.js';
import { MyFatoorahProvider } from '../../src/modules/payments/providers/myfatoorah.provider.js';
import {
  myFatoorahSettingsSchema,
  paymentConfigurationSchema,
  validatePaymentConfiguration,
} from '../../src/config/payment-options.js';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      PAYMENT_PROVIDER: 'MYFATOORAH',
      MYFATOORAH_ENV: 'sandbox',
      MYFATOORAH_API_VERSION: 'v2',
      MYFATOORAH_ACCOUNT_COUNTRY: 'KWT',
      MYFATOORAH_ACCOUNT_CURRENCY: 'KWD',
      MYFATOORAH_API_TOKEN: 'mock-token-not-live',
      MYFATOORAH_WEBHOOK_SECRET: 'mock-webhook-secret',
      MYFATOORAH_CALLBACK_URL: 'https://shop.example.test/return',
      MYFATOORAH_ERROR_URL: 'https://shop.example.test/error',
      MYFATOORAH_TIMEOUT_MS: 100,
    },
  };
});

const settings = myFatoorahSettingsSchema.parse({
  MYFATOORAH_API_VERSION: 'v2',
  MYFATOORAH_ACCOUNT_COUNTRY: 'KWT',
  MYFATOORAH_ACCOUNT_CURRENCY: 'KWD',
  MYFATOORAH_API_TOKEN: 'mock-token-not-live',
  MYFATOORAH_WEBHOOK_SECRET: 'mock-webhook-secret',
  MYFATOORAH_CALLBACK_URL: 'https://shop.example.test/return',
  MYFATOORAH_ERROR_URL: 'https://shop.example.test/error',
  MYFATOORAH_TIMEOUT_MS: 100,
});
const fixture = `mf-${randomUUID()}`;
const invoiceId = '100001';
const transactionPaymentId = '07071000012345';
const url = 'https://demo.myfatoorah.com/ie/test-invoice';
const webhookPath = '/api/v1/payment-providers/myfatoorah/webhook';

describe('MyFatoorah Kuwait V2 integration against PostgreSQL', () => {
  const service = new PaymentService();
  const verification = new PaymentVerificationService();
  let tenantId: string,
    otherTenantId: string,
    userId: string,
    strangerId: string,
    variantId: string,
    inventoryId: string,
    paymentId: string,
    orderId: string,
    addressId: string,
    cartId: string,
    methodId: string;
  let token: string, strangerToken: string;
  const countryCode = `M${randomUUID()}`.toUpperCase();
  let state: 'paid' | 'failed' | 'pending' | 'attempt-failed' | 'authorized' =
    'paid';
  let amount = '10.250';
  let currency = 'KD';
  let paidCurrency = 'KD';
  let customerReference: string | undefined;
  let remoteInvoiceId = invoiceId;
  let remoteTransactionPaymentId = transactionPaymentId;

  function statusData() {
    return {
      InvoiceId: remoteInvoiceId,
      InvoiceStatus:
        state === 'paid' ? 'Paid' : state === 'failed' ? 'Canceled' : 'Pending',
      CustomerReference: customerReference ?? paymentId,
      UserDefinedField: orderId,
      InvoiceValue: amount,
      InvoiceDisplayValue: `${amount} ${currency}`,
      InvoiceTransactions: [
        {
          TransactionId: '90001',
          PaymentId: remoteTransactionPaymentId,
          TransactionStatus:
            state === 'paid'
              ? 'Succss'
              : state === 'failed' || state === 'attempt-failed'
                ? 'Failed'
                : state === 'authorized'
                  ? 'Authorize'
                  : 'InProgress',
          Currency: currency,
          PaidCurrency: paidCurrency,
          PaidCurrencyValue: amount,
          TransationValue: amount,
        },
      ],
    };
  }
  function event(
    status: 'SUCCESS' | 'FAILED' | 'AUTHORIZE' = 'SUCCESS',
    reference = 'WH-100001',
  ) {
    return {
      Event: {
        Code: 1,
        Name: 'PAYMENT_STATUS_CHANGED',
        CountryIsoCode: 'KWT',
        Reference: reference,
      },
      Data: {
        Invoice: {
          Id: invoiceId,
          Status: status === 'SUCCESS' ? 'PAID' : 'PENDING',
          ExternalIdentifier: null,
        },
        Transaction: { Status: status, PaymentId: transactionPaymentId },
      },
    };
  }
  function signature(payload: ReturnType<typeof event>) {
    const { Invoice, Transaction } = payload.Data;
    return createHmac('sha256', 'mock-webhook-secret')
      .update(
        `Invoice.Id=${Invoice.Id},Invoice.Status=${Invoice.Status},Transaction.Status=${Transaction.Status},Transaction.PaymentId=${Transaction.PaymentId},Invoice.ExternalIdentifier=`,
      )
      .digest('base64');
  }
  function deliver(payload = event()) {
    return request(app)
      .post(webhookPath)
      .set('MyFatoorah-Signature', signature(payload))
      .send(payload);
  }
  const initiate = () => service.initiatePayment(tenantId, userId, paymentId);
  const stored = () =>
    testPrisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const stock = () =>
    testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

  beforeAll(async () => {
    const tenant = await testPrisma.tenant.create({
      data: {
        name: 'Gateway test',
        slug: fixture,
        code: fixture,
        defaultCurrency: 'KWD',
      },
    });
    tenantId = tenant.id;
    const other = await testPrisma.tenant.create({
      data: {
        name: 'Other',
        slug: `${fixture}-other`,
        code: `${fixture}-other`,
      },
    });
    otherTenantId = other.id;
    const user = await testPrisma.user.create({
      data: {
        email: `${fixture}@example.test`,
        firstName: 'Gateway',
        lastName: 'Buyer',
        passwordHash: 'unused',
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    const stranger = await testPrisma.user.create({
      data: {
        email: `${fixture}-other@example.test`,
        firstName: 'Other',
        lastName: 'Buyer',
        passwordHash: 'unused',
      },
    });
    strangerId = stranger.id;
    token = await createAccessToken(userId);
    strangerToken = await createAccessToken(strangerId);
    await testPrisma.country.create({
      data: { code: countryCode, name: fixture, currencyCode: 'KWD' },
    });
    const category = await testPrisma.category.create({
      data: { tenantId, name: 'Gateway', slug: fixture },
    });
    const product = await testPrisma.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name: 'Gateway item',
        slug: fixture,
        basePrice: '10.25',
        status: 'ACTIVE',
      },
    });
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        sku: fixture,
        combinationKey: '',
        isDefault: true,
      },
    });
    variantId = variant.id;
    const inventory = await testPrisma.inventory.create({
      data: { variantId, quantity: 10, reservedQuantity: 1 },
    });
    inventoryId = inventory.id;
    const address = await testPrisma.address.create({
      data: {
        userId,
        firstName: 'Gateway',
        lastName: 'Buyer',
        addressLine1: 'Test',
        city: 'Kuwait',
        countryCode,
        latitude: 29.37,
        longitude: 47.97,
      },
    });
    addressId = address.id;
    const cart = await testPrisma.cart.create({ data: { tenantId, userId } });
    cartId = cart.id;
    const taxCategory = await testPrisma.taxCategory.create({
      data: {
        tenantId,
        code: fixture,
        name: 'Gateway exempt',
        treatment: 'EXEMPT',
      },
    });
    await testPrisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode, rate: 0 },
    });
    await testPrisma.taxProfile.create({
      data: {
        tenantId,
        countryCode,
        currency: 'KWD',
        defaultTaxCategoryId: taxCategory.id,
        isTaxRegistered: false,
      },
    });
    const profile = await testPrisma.shippingProfile.create({
      data: {
        tenantId,
        countryCode,
        currency: 'KWD',
        originLatitude: 29.37,
        originLongitude: 47.97,
      },
    });
    const zone = await testPrisma.shippingZone.create({
      data: { profileId: profile.id, code: fixture, name: 'Zone', countryCode },
    });
    const method = await testPrisma.shippingMethod.create({
      data: { zoneId: zone.id, code: fixture, name: 'Delivery' },
    });
    methodId = method.id;
    await testPrisma.shippingRule.create({
      data: { methodId, flatRate: 0, rateType: 'FREE', maxDistanceKm: 50 },
    });
  });
  beforeEach(async () => {
    state = 'paid';
    amount = '10.250';
    currency = 'KD';
    paidCurrency = 'KD';
    customerReference = undefined;
    remoteInvoiceId = invoiceId;
    remoteTransactionPaymentId = transactionPaymentId;
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 10, reservedQuantity: 1 },
    });
    const product = await testPrisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    const order = await testPrisma.order.create({
      data: {
        tenantId,
        userId,
        orderNumber: randomUUID(),
        currency: 'KWD',
        subtotal: '10.25',
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        totalAmount: '10.25',
        shippingAddress: {},
        billingAddress: {},
        items: {
          create: {
            productId: product.productId,
            variantId,
            productName: 'Gateway item',
            sku: fixture,
            quantity: 1,
            unitPrice: '10.25',
            finalUnitPrice: '10.25',
            totalPrice: '10.25',
            itemDiscountAmount: 0,
            taxableAmount: '10.25',
            taxAmount: 0,
            variantSnapshot: {},
          },
        },
      },
    });
    orderId = order.id;
    const payment = await testPrisma.payment.create({
      data: {
        orderId,
        amount: '10.25',
        currency: 'KWD',
        provider: 'MYFATOORAH',
        method: 'CARD',
        initiationState: 'NOT_STARTED',
      },
    });
    paymentId = payment.id;
    await testPrisma.inventoryTransaction.create({
      data: {
        inventoryId,
        type: 'RESERVATION',
        quantity: 1,
        referenceId: orderId,
      },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://apitest.myfatoorah.com/v2/SendPayment')
        return Response.json({
          IsSuccess: true,
          Data: {
            InvoiceId: Number(invoiceId),
            InvoiceURL: url,
            CustomerReference: paymentId,
          },
        });
      if (
        String(input) === 'https://apitest.myfatoorah.com/v2/GetPaymentStatus'
      )
        return Response.json({ IsSuccess: true, Data: statusData() });
      throw new Error('Unexpected provider URL');
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await testPrisma.myFatoorahWebhookEvent.deleteMany({
      where: { payment: { order: { tenantId } } },
    });
    await testPrisma.myFatoorahInvoice.deleteMany({
      where: { payment: { order: { tenantId } } },
    });
    await testPrisma.checkoutRequest.deleteMany({ where: { tenantId } });
    await testPrisma.payment.deleteMany({ where: { order: { tenantId } } });
    await testPrisma.order.deleteMany({ where: { tenantId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
    await testPrisma.cartItem.deleteMany({ where: { cartId } });
  });
  afterAll(async () => {
    await testPrisma.cart.deleteMany({ where: { tenantId } });
    await testPrisma.shippingProfile.deleteMany({ where: { tenantId } });
    await testPrisma.taxProfile.deleteMany({ where: { tenantId } });
    await testPrisma.taxRule.deleteMany({
      where: { taxCategory: { tenantId } },
    });
    await testPrisma.product.deleteMany({ where: { tenantId } });
    await testPrisma.category.deleteMany({ where: { tenantId } });
    await testPrisma.address.deleteMany({ where: { userId } });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: [userId, strangerId] } },
    });
    await testPrisma.country.deleteMany({ where: { code: countryCode } });
    await testPrisma.$disconnect();
  });

  it('accepts legitimate duplicate webhook bursts without generic API rate limiting', async () => {
    await initiate();
    for (let i = 0; i < 105; i++) expect((await deliver()).status).toBe(200);
    expect((await stored()).status).toBe('PAID');
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE', referenceId: orderId },
      }),
    ).toBe(1);
  });
  it('initiates with the existing Flutter payment envelope and persists the hosted URL and invoice mapping', async () => {
    const response = await request(app)
      .post(`/api/v1/payments/${paymentId}/initiate`)
      .set('X-Tenant-Slug', fixture)
      .auth(token, { type: 'bearer' })
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: null,
      data: {
        provider: 'MYFATOORAH',
        status: 'REQUIRES_ACTION',
        initiationState: 'INITIATED',
        providerPaymentId: invoiceId,
        metadata: { checkoutUrl: url },
      },
    });
    expect(
      await testPrisma.myFatoorahInvoice.findUnique({ where: { invoiceId } }),
    ).toMatchObject({ paymentId });
    expect(JSON.stringify(response.body)).not.toContain('mock-token-not-live');
  });
  it('uses only persisted order money and writes exact KWD major units after the claim commits', async () => {
    vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
      expect(init?.body).toContain('"InvoiceValue":10.250');
      expect(init?.body).toContain('"DisplayCurrencyIso":"KWD"');
      expect((await stored()).initiationState).toBe('IN_PROGRESS');
      await testPrisma.$transaction(
        (tx) =>
          tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE NOWAIT`,
      );
      return Response.json({
        IsSuccess: true,
        Data: {
          InvoiceId: 100001,
          InvoiceURL: url,
          CustomerReference: paymentId,
        },
      });
    });
    await initiate();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects client-provided payment amounts or success fields', async () => {
    const response = await request(app)
      .post(`/api/v1/payments/${paymentId}/initiate`)
      .set('X-Tenant-Slug', fixture)
      .auth(token, { type: 'bearer' })
      .send({ amount: '0.01', status: 'PAID' });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts third-decimal KWD fractions without scaling and blocks fourth decimals', () => {
    const provider = new MyFatoorahProvider(settings);
    expect(() =>
      provider.validatePayment({ amount: '1.230', currency: 'KWD' }),
    ).not.toThrow();
    expect(() =>
      provider.validatePayment({ amount: '1.2311', currency: 'KWD' }),
    ).toThrow('KWD precision');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['0.001', '12.345', '9999999999.999'])(
    'initiates and verifies exact persisted KWD %s',
    async (value) => {
      amount = value;
      await testPrisma.order.update({
        where: { id: orderId },
        data: { totalAmount: value },
      });
      await testPrisma.payment.update({
        where: { id: paymentId },
        data: { amount: value },
      });
      vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
        expect(init?.body).toContain(`"InvoiceValue":${value}`);
        return Response.json({
          IsSuccess: true,
          Data: {
            InvoiceId: 100001,
            InvoiceURL: url,
            CustomerReference: paymentId,
          },
        });
      });
      await service.initiatePayment(tenantId, userId, paymentId);
      const verified = await verification.verifyForUser(
        tenantId,
        userId,
        paymentId,
      );
      expect(verified.amount.equals(value)).toBe(true);
      expect(verified.status).toBe('PAID');
      expect(verified.currency).toBe('KWD');
    },
  );
  it('rejects unsupported persisted currency before changing initiation state or calling HTTP', async () => {
    await testPrisma.order.update({
      where: { id: orderId },
      data: { currency: 'USD' },
    });
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { currency: 'USD' },
    });
    await expect(initiate()).rejects.toMatchObject({
      code: 'PAYMENT_CURRENCY_NOT_SUPPORTED',
    });
    expect((await stored()).initiationState).toBe('NOT_STARTED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects incomplete selected configuration without falling back to NONE', () => {
    const schema = paymentConfigurationSchema.superRefine(
      validatePaymentConfiguration,
    );
    expect(schema.safeParse({ PAYMENT_PROVIDER: 'MYFATOORAH' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ PAYMENT_PROVIDER: 'MYFATOORAH', ...settings }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        PAYMENT_PROVIDER: 'MYFATOORAH',
        ...settings,
        MYFATOORAH_API_VERSION: 'v3',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        PAYMENT_PROVIDER: 'MYFATOORAH',
        ...settings,
        MYFATOORAH_CALLBACK_URL: 'http://localhost/return',
      }).success,
    ).toBe(false);
  });
  it('serializes concurrent initiation and never creates two remote invoices', async () => {
    const results = await Promise.allSettled([initiate(), initiate()]);
    expect(
      results.filter((result) => result.status === 'fulfilled').length,
    ).toBeGreaterThanOrEqual(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await stored()).initiationState).toBe('INITIATED');
  });
  it('replays duplicate initiation from persisted results without HTTP', async () => {
    await initiate();
    await initiate();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves UNKNOWN and stock on a provider timeout and blocks retry', async () => {
    const metric = vi.spyOn(metrics, 'payment');
    expect(metric).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValueOnce(
      new DOMException('sensitive transport details', 'TimeoutError'),
    );
    await expect(initiate()).rejects.toMatchObject({
      code: 'MYFATOORAH_TIMEOUT',
      statusCode: 503,
    });
    expect(metrics.render()).toContain(
      'commerce_payment_initiation_uncertain_total',
    );
    expect(metric).toHaveBeenCalledWith('initiation', 'timeout');
    expect((await stored()).initiationState).toBe('UNKNOWN');

    expect((await stock()).reservedQuantity).toBe(1);
    await expect(initiate()).rejects.toMatchObject({
      code: 'PAYMENT_RECONCILIATION_REQUIRED',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['rejected', 'credentials', 'missing-url', 'network'] as const)(
    'handles %s without marking paid or releasing inventory',
    async (kind) => {
      if (kind === 'network')
        vi.mocked(fetch).mockRejectedValueOnce(
          new Error('mock-token-not-live'),
        );
      else
        vi.mocked(fetch).mockResolvedValueOnce(
          kind === 'credentials'
            ? new Response('', { status: 401 })
            : Response.json(
                kind === 'rejected'
                  ? {
                      IsSuccess: false,
                      Message: 'mock-token-not-live',
                      Data: null,
                    }
                  : {
                      IsSuccess: true,
                      Data: { InvoiceId: 100001, CustomerReference: paymentId },
                    },
              ),
        );
      await expect(initiate()).rejects.toMatchObject({ name: 'AppError' });
      expect(await stored()).toMatchObject({
        status: 'PENDING',
        initiationState: 'UNKNOWN',
      });
      expect((await stock()).reservedQuantity).toBe(1);
    },
  );
  it('accepts an authentic signed webhook without customer JWT and verifies remotely', async () => {
    await initiate();
    const response = await deliver();
    expect(response.status).toBe(200);
    expect((await stored()).status).toBe('PAID');
    expect(
      await testPrisma.order.findUnique({ where: { id: orderId } }),
    ).toMatchObject({ paymentStatus: 'PAID' });
    expect(fetch).toHaveBeenLastCalledWith(
      'https://apitest.myfatoorah.com/v2/GetPaymentStatus',
      expect.objectContaining({
        body: JSON.stringify({ Key: invoiceId, KeyType: 'InvoiceId' }),
      }),
    );
  });
  it.each(['missing', 'invalid', 'tampered'] as const)(
    'rejects %s signatures without provider HTTP or database mutations',
    async (kind) => {
      const metric = vi.spyOn(metrics, 'payment');
      const payload = event();
      const original = signature(payload);
      if (kind === 'tampered') payload.Data.Invoice.Id = '100002';
      const call = request(app).post(webhookPath);
      if (kind !== 'missing')
        call.set(
          'MyFatoorah-Signature',
          kind === 'invalid' ? 'a'.repeat(43) + '=' : original,
        );
      expect((await call.send(payload)).status).toBe(401);
      expect(metric).toHaveBeenCalledWith('webhook', 'invalid_signature');
      expect(fetch).not.toHaveBeenCalled();
      expect((await stored()).status).toBe('PENDING');
    },
  );
  it('ignores unsigned tenant and amount fields; authoritative provider data alone changes state', async () => {
    await initiate();
    const signed = event();
    const payload = {
      ...signed,
      Data: {
        ...signed.Data,
        Amount: { BaseCurrency: 'USD', ValueInBaseCurrency: '0.01' },
      },
      tenantId: otherTenantId,
    };
    expect((await deliver(payload)).status).toBe(200);
    expect((await stored()).status).toBe('PAID');
  });
  it('deduplicates success and unsigned event-reference changes; commits stock once', async () => {
    const metric = vi.spyOn(metrics, 'payment');
    await initiate();
    await deliver();
    await deliver();
    await deliver(event('SUCCESS', 'WH-altered-reference'));
    expect(metric).toHaveBeenCalledWith('webhook', 'duplicate');
    expect(await stock()).toMatchObject({ quantity: 9, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE' },
      }),
    ).toBe(1);
    expect(
      await testPrisma.myFatoorahWebhookEvent.count({ where: { paymentId } }),
    ).toBe(1);
  });
  it('deduplicates terminal failure and releases stock once', async () => {
    await initiate();
    state = 'failed';
    await deliver(event('FAILED'));
    await deliver(event('FAILED'));
    expect(await stored()).toMatchObject({ status: 'FAILED' });
    expect(await stock()).toMatchObject({ quantity: 10, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE' },
      }),
    ).toBe(1);
  });
  it('never applies failure after success; records reconciliation', async () => {
    await initiate();
    await deliver();
    state = 'failed';
    const response = await deliver(event('FAILED', 'WH-late-failure'));
    expect(response.status).toBe(200);
    expect(response.body.data.reconciliationRequired).toBe(true);
    expect(await stored()).toMatchObject({
      status: 'PAID',
      reconciliationRequired: true,
    });
    expect((await stock()).quantity).toBe(9);
  });
  it('never resurrects success after failure or re-commits released inventory', async () => {
    await initiate();
    state = 'failed';
    await deliver(event('FAILED'));
    state = 'paid';
    const response = await deliver(event('SUCCESS', 'WH-late-success'));
    expect(response.body.data.reconciliationRequired).toBe(true);
    expect(await stored()).toMatchObject({
      status: 'FAILED',
      reconciliationRequired: true,
    });
    expect(await stock()).toMatchObject({ quantity: 10, reservedQuantity: 0 });
  });
  it('serializes concurrent signed deliveries', async () => {
    await initiate();
    const results = await Promise.all([deliver(), deliver(), deliver()]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(
      await testPrisma.myFatoorahWebhookEvent.count({ where: { paymentId } }),
    ).toBe(1);
    expect((await stock()).quantity).toBe(9);
  });
  it('rejects an unknown invoice/customer reference', async () => {
    customerReference = randomUUID();
    expect((await deliver()).status).toBe(404);
    expect((await stored()).status).toBe('PENDING');
  });
  it.each([
    'amount',
    'currency',
    'pay-currency',
    'identity',
    'transaction',
  ] as const)(
    'refuses authoritative %s mismatch without committing stock',
    async (kind) => {
      await initiate();
      if (kind === 'amount') amount = '10.260';
      if (kind === 'currency') currency = 'USD';
      if (kind === 'pay-currency') paidCurrency = 'USD';
      if (kind === 'identity') remoteInvoiceId = '100002';
      if (kind === 'transaction') remoteTransactionPaymentId = '0707999999';
      await deliver();
      expect((await stored()).status).toBe('REQUIRES_ACTION');
      expect((await stock()).reservedQuantity).toBe(1);
    },
  );
  it('customer verification uses persisted invoice identity and returns the existing payment shape', async () => {
    await initiate();
    const response = await request(app)
      .post(`/api/v1/payments/${paymentId}/verify`)
      .set('X-Tenant-Slug', fixture)
      .auth(token, { type: 'bearer' })
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: paymentId,
      status: 'PAID',
      amount: '10.25',
      currency: 'KWD',
    });
    expect(response.body.data).not.toHaveProperty('reconciliationRequired');
  });
  it('customer status endpoint rejects client success assertions', async () => {
    const response = await request(app)
      .post(`/api/v1/payments/${paymentId}/verify`)
      .set('X-Tenant-Slug', fixture)
      .auth(token, { type: 'bearer' })
      .send({ status: 'PAID', invoiceId: '1' });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['pending', 'attempt-failed', 'authorized'] as const)(
    'preserves reservations for %s invoices',
    async (next) => {
      await initiate();
      state = next;
      const result = await verification.verifyForUser(
        tenantId,
        userId,
        paymentId,
      );
      expect(result.status).toBe(
        next === 'authorized' ? 'AUTHORIZED' : 'REQUIRES_ACTION',
      );
      expect((await stock()).reservedQuantity).toBe(1);
    },
  );
  it('reconciles a signed late event after an UNKNOWN initiation using trusted provider references', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('reply lost'));
    await expect(initiate()).rejects.toMatchObject({
      code: 'MYFATOORAH_OUTCOME_UNKNOWN',
    });
    expect((await deliver()).status).toBe(200);
    expect(await stored()).toMatchObject({
      status: 'PAID',
      initiationState: 'INITIATED',
      providerPaymentId: invoiceId,
    });
  });
  it('flags late success after order expiration without altering terminal history', async () => {
    await initiate();
    await new OrderService().expirePendingOrder(tenantId, orderId);
    const response = await deliver();
    expect(response.body.data.reconciliationRequired).toBe(true);
    expect(await stored()).toMatchObject({
      status: 'CANCELLED',
      reconciliationRequired: true,
    });
    expect(await stock()).toMatchObject({ quantity: 10, reservedQuantity: 0 });
  });
  it('rejects cross-tenant and other-customer access before querying MyFatoorah', async () => {
    for (const { slug, auth } of [
      { slug: `${fixture}-other`, auth: token },
      { slug: fixture, auth: strangerToken },
    ]) {
      const response = await request(app)
        .post(`/api/v1/payments/${paymentId}/verify`)
        .set('X-Tenant-Slug', slug)
        .auth(auth, { type: 'bearer' })
        .send({});
      expect(response.status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('callback and error redirects cannot mark payment paid', async () => {
    for (const path of ['callback', 'error']) {
      const response = await request(app).get(
        `/api/v1/payment-providers/myfatoorah/${path}?paymentId=${paymentId}&status=PAID`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.verified).toBe(false);
    }
    expect((await stored()).status).toBe('PENDING');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('enforces a 32kb webhook body limit and controlled malformed JSON', async () => {
    expect(
      (
        await request(app)
          .post(webhookPath)
          .send({ padding: 'x'.repeat(40000) })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(app)
          .post(webhookPath)
          .set('Content-Type', 'application/json')
          .send('{')
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps NONE payments functional when the remote provider is configured', async () => {
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { provider: 'NONE', method: 'CASH_ON_DELIVERY' },
    });
    expect(await initiate()).toMatchObject({
      provider: 'NONE',
      status: 'PENDING',
      initiationState: 'INITIATED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unsigned event-reference collisions with a different signed identity', async () => {
    await initiate();
    await deliver();
    state = 'failed';
    const response = await deliver(event('FAILED'));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('MYFATOORAH_EVENT_REFERENCE_CONFLICT');
    expect((await stored()).status).toBe('PAID');
    expect(
      await testPrisma.myFatoorahWebhookEvent.count({ where: { paymentId } }),
    ).toBe(1);
  });
  it('requires customer authentication for authoritative verification', async () => {
    const response = await request(app)
      .post(`/api/v1/payments/${paymentId}/verify`)
      .set('X-Tenant-Slug', fixture)
      .send({});
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('never initiates a mismatched local order/payment amount', async () => {
    await testPrisma.order.update({
      where: { id: orderId },
      data: { totalAmount: '11.25' },
    });
    await expect(initiate()).rejects.toMatchObject({
      code: 'PAYMENT_ORDER_MISMATCH',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses an untrusted hosted URL while retaining an uncertain outcome', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        IsSuccess: true,
        Data: {
          InvoiceId: 100001,
          InvoiceURL: 'https://attacker.example/checkout',
          CustomerReference: paymentId,
        },
      }),
    );
    await expect(initiate()).rejects.toMatchObject({
      code: 'MYFATOORAH_INVALID_RESPONSE',
    });
    expect((await stored()).initiationState).toBe('UNKNOWN');
  });
  it('customer verification applies terminal failure once without a webhook', async () => {
    await initiate();
    state = 'failed';
    await verification.verifyForUser(tenantId, userId, paymentId);
    await verification.verifyForUser(tenantId, userId, paymentId);
    expect((await stored()).status).toBe('FAILED');
    expect(await stock()).toMatchObject({ quantity: 10, reservedQuantity: 0 });
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE' },
      }),
    ).toBe(1);
  });
  it('matches an independently computed UTF-8 HMAC vector including ExternalIdentifier', () => {
    const payload = {
      Event: {
        Code: 1,
        Name: 'PAYMENT_STATUS_CHANGED',
        CountryIsoCode: 'KWT',
        Reference: 'WH-vector',
      },
      Data: {
        Invoice: {
          Id: '123456',
          Status: 'PAID',
          ExternalIdentifier: 'merchant-1',
        },
        Transaction: { Status: 'SUCCESS', PaymentId: '0707123456' },
      },
    };
    expect(
      verifyMyFatoorahWebhook(
        payload,
        '/18izBtQFt1ODgoQ6QD236e94FIxa6p5cGMEtSDrDzk=',
        'test-webhook-key',
      ).invoiceId,
    ).toBe('123456');
    payload.Data.Invoice.ExternalIdentifier = 'merchant-2';
    expect(() =>
      verifyMyFatoorahWebhook(
        payload,
        '/18izBtQFt1ODgoQ6QD236e94FIxa6p5cGMEtSDrDzk=',
        'test-webhook-key',
      ),
    ).toThrow('Invalid MyFatoorah signature');
  });
  it('handles a signed success before the initiation reply is persisted without downgrading state', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await verification.processWebhook(event(), signature(event()));
      return Response.json({
        IsSuccess: true,
        Data: {
          InvoiceId: 100001,
          InvoiceURL: url,
          CustomerReference: paymentId,
        },
      });
    });
    expect(await initiate()).toMatchObject({
      status: 'PAID',
      initiationState: 'INITIATED',
    });
    expect((await stock()).quantity).toBe(9);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE' },
      }),
    ).toBe(1);
  });
  it('flags an authoritative late paid polling result after expiration without changing terminal history', async () => {
    await initiate();
    await new OrderService().expirePendingOrder(tenantId, orderId);
    await expect(
      verification.verifyForUser(tenantId, userId, paymentId),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await stored()).toMatchObject({
      status: 'CANCELLED',
      reconciliationRequired: true,
    });
    expect(await stock()).toMatchObject({ quantity: 10, reservedQuantity: 0 });
  });
  it.each(['Pending', 'Canceled'])(
    'never releases stock for contradictory %s invoices reporting successful money collection',
    async (invoiceStatus) => {
      await initiate();
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          IsSuccess: true,
          Data: { ...statusData(), InvoiceStatus: invoiceStatus },
        }),
      );
      await expect(
        verification.verifyForUser(tenantId, userId, paymentId),
      ).rejects.toMatchObject({ code: 'MYFATOORAH_STATUS_UNVERIFIED' });
      expect(await stored()).toMatchObject({
        status: 'REQUIRES_ACTION',
        reconciliationRequired: true,
      });
      expect((await stock()).reservedQuantity).toBe(1);
      expect(
        await testPrisma.inventoryTransaction.count({
          where: { inventoryId, type: 'RELEASE' },
        }),
      ).toBe(0);
    },
  );
  it('never releases stock for a canceled invoice with an open authorization', async () => {
    await initiate();
    state = 'authorized';
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        IsSuccess: true,
        Data: { ...statusData(), InvoiceStatus: 'Canceled' },
      }),
    );
    await expect(
      verification.verifyForUser(tenantId, userId, paymentId),
    ).rejects.toMatchObject({ code: 'MYFATOORAH_STATUS_UNVERIFIED' });
    expect((await stock()).reservedQuantity).toBe(1);
    expect((await stored()).reconciliationRequired).toBe(true);
  });
  it('still persists the hosted URL when an early webhook only confirms a pending invoice', async () => {
    state = 'attempt-failed';
    vi.mocked(fetch).mockImplementationOnce(async () => {
      const payload = event('FAILED');
      await verification.processWebhook(payload, signature(payload));
      return Response.json({
        IsSuccess: true,
        Data: {
          InvoiceId: 100001,
          InvoiceURL: url,
          CustomerReference: paymentId,
        },
      });
    });
    const result = await initiate();
    expect(result).toMatchObject({
      status: 'REQUIRES_ACTION',
      initiationState: 'INITIATED',
      metadata: { checkoutUrl: url },
    });
    expect((await stock()).reservedQuantity).toBe(1);
  });
  it('checkout selects the configured provider without HTTP and replays the same committed order', async () => {
    await testPrisma.cartItem.create({
      data: { cartId, variantId, quantity: 1 },
    });
    const checkout = new CheckoutService();
    const input = {
      shippingAddressId: addressId,
      shippingMethodId: methodId,
      paymentMethod: 'CARD' as const,
    };
    const context = { tenantId, userId, idempotencyKey: 'myfatoorah-checkout' };
    const first = await checkout.checkout(input, context);
    const second = await checkout.checkout(input, context);
    expect(first.payment?.provider).toBe('MYFATOORAH');
    expect(second.order.id).toBe(first.order.id);
    expect(second.idempotent).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
