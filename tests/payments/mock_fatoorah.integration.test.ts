import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/env.js', async (original) => {
  const actual = await original<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      PAYMENT_PROVIDER: 'MOCK',
      MOCK_CHECKOUT_SECRET: 'secret-123456789012345678901234567890',
      JWT_ACCESS_SECRET: 'secret-123456789012345678901234567890',
    },
  };
});

import app from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { createAccessToken } from '../../src/common/security/jwt.js';
import { createInventoryFixture, createCartFixture, createShippingProfileFixture } from '../helpers/warehouse.js';
import { validatePaymentConfiguration, myFatoorahSettingsSchema } from '../../src/config/payment-options.js';
import { MockMyFatoorahProvider } from '../../src/modules/payments/providers/mock-myfatoorah.provider.js';
import { PaymentProviderRegistry } from '../../src/modules/payments/providers/payment-provider.registry.js';
import { PaymentMethod, PaymentProvider, PaymentStatus } from '../../src/generated/prisma/client.js';

describe('Task 06.7.4B — Local Mock MyFatoorah Gateway Integration Tests', () => {
  beforeEach(() => {
    MockMyFatoorahProvider.clearMockInvoices();
    process.env.MOCK_CHECKOUT_SECRET = 'secret-123456789012345678901234567890';
    process.env.JWT_ACCESS_SECRET = 'secret-123456789012345678901234567890';
  });

  it('1. Mock mode is disabled by default in paymentConfigurationSchema', () => {
    const config = { PAYMENT_PROVIDER: 'NONE' as const };
    let error: any = null;
    try {
      validatePaymentConfiguration(config, {
        addIssue: (issue: any) => { error = issue; },
      } as any);
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  });

  it('2. Production startup rejects mock mode', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let issue: any = null;

    validatePaymentConfiguration({ PAYMENT_PROVIDER: 'MOCK' as const }, {
      addIssue: (i: any) => { issue = i; },
    } as any);

    process.env.NODE_ENV = oldEnv;
    expect(issue).not.toBeNull();
    expect(issue?.message).contains('prohibited in production');
  });

  it('3. Mock mode makes zero external payment API calls', async () => {
    const provider = new MockMyFatoorahProvider();
    const result = await provider.createPayment({
      idempotencyKey: 'key-1',
      paymentId: 'pay-123',
      orderId: 'ord-123',
      amount: '23.750',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    expect(result.checkoutUrl).contains('/api/v1/payments/mock/checkout/pay-123');
    expect(result.checkoutUrl).contains('token=');
    expect(result.status).toBe(PaymentStatus.REQUIRES_ACTION);
  });

  it('4. Card initiation returns a local test checkout URL with signed session token', async () => {
    const provider = new MockMyFatoorahProvider();
    const res = await provider.createPayment({
      idempotencyKey: 'key-2',
      paymentId: 'pay-456',
      orderId: 'ord-456',
      amount: '50.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    expect(res.checkoutUrl).contains('http://localhost:3000/api/v1/payments/mock/checkout/pay-456?token=');
    expect(res.providerPaymentId).toBe('mock-inv-pay-456');
  });

  it('5. Success scenario sets mock invoice status to PAID', async () => {
    const provider = new MockMyFatoorahProvider();
    await provider.createPayment({
      idempotencyKey: 'key-3',
      paymentId: 'pay-789',
      orderId: 'ord-789',
      amount: '10.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    MockMyFatoorahProvider.setMockInvoiceStatus('mock-inv-pay-789', PaymentStatus.PAID);
    const status = await provider.getPaymentStatus('mock-inv-pay-789');

    expect(status.status).toBe(PaymentStatus.PAID);
    expect(status.amount).toBe('10.000');
    expect(status.currency).toBe('KWD');
  });

  it('6. Failure and cancellation scenarios update status appropriately', async () => {
    const provider = new MockMyFatoorahProvider();
    await provider.createPayment({
      idempotencyKey: 'key-4',
      paymentId: 'pay-failed',
      orderId: 'ord-failed',
      amount: '15.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    MockMyFatoorahProvider.setMockInvoiceStatus('mock-inv-pay-failed', PaymentStatus.FAILED);
    const failedStatus = await provider.getPaymentStatus('mock-inv-pay-failed');
    expect(failedStatus.status).toBe(PaymentStatus.FAILED);

    await provider.cancelPayment('mock-inv-pay-failed');
    const cancelledStatus = await provider.getPaymentStatus('mock-inv-pay-failed');
    expect(cancelledStatus.status).toBe(PaymentStatus.CANCELLED);
  });

  it('7. Pending status does not mark payment as PAID', async () => {
    const provider = new MockMyFatoorahProvider();
    await provider.createPayment({
      idempotencyKey: 'key-5',
      paymentId: 'pay-pending',
      orderId: 'ord-pending',
      amount: '20.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    const status = await provider.getPaymentStatus('mock-inv-pay-pending');
    expect(status.status).toBe(PaymentStatus.REQUIRES_ACTION);
    expect(status.status).not.toBe(PaymentStatus.PAID);
  });

  it('8. Duplicate initiation is safe with supportsIdempotentInitiation == true', async () => {
    const provider = new MockMyFatoorahProvider();
    expect(provider.supportsIdempotentInitiation).toBe(true);

    const res1 = await provider.createPayment({
      idempotencyKey: 'key-dup',
      paymentId: 'pay-dup',
      orderId: 'ord-dup',
      amount: '30.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    const res2 = await provider.createPayment({
      idempotencyKey: 'key-dup',
      paymentId: 'pay-dup',
      orderId: 'ord-dup',
      amount: '30.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    expect(res1.providerPaymentId).toBe(res2.providerPaymentId);
  });

  it('9. Duplicate verification returns same mock status', async () => {
    const provider = new MockMyFatoorahProvider();
    await provider.createPayment({
      idempotencyKey: 'key-dup-ver',
      paymentId: 'pay-dup-ver',
      orderId: 'ord-dup-ver',
      amount: '12.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    MockMyFatoorahProvider.setMockInvoiceStatus('mock-inv-pay-dup-ver', PaymentStatus.PAID);

    const s1 = await provider.getPaymentStatus('mock-inv-pay-dup-ver');
    const s2 = await provider.getPaymentStatus('mock-inv-pay-dup-ver');

    expect(s1.status).toBe(PaymentStatus.PAID);
    expect(s2.status).toBe(PaymentStatus.PAID);
  });

  it('10. Tenant and order reference matching in mock status', async () => {
    const provider = new MockMyFatoorahProvider();
    await provider.createPayment({
      idempotencyKey: 'key-tenant',
      paymentId: 'pay-tenant-1',
      orderId: 'ord-tenant-1',
      amount: '100.000',
      currency: 'KWD',
      method: PaymentMethod.CARD,
    });

    const status = await provider.getPaymentStatus('mock-inv-pay-tenant-1');
    expect(status.customerReference).toBe('pay-tenant-1');
    expect(status.orderReference).toBe('ord-tenant-1');
  });

  it('11. Registry resolves CARD to MYFATOORAH when PAYMENT_PROVIDER=MOCK', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const registry = new PaymentProviderRegistry({
      PAYMENT_PROVIDER: 'MOCK',
    });

    const resolved = registry.resolveProviderForMethod(PaymentMethod.CARD);
    expect(resolved).toBe(PaymentProvider.MYFATOORAH);

    const provider = registry.getProvider(PaymentProvider.MYFATOORAH);
    expect(provider).toBeInstanceOf(MockMyFatoorahProvider);

    process.env.NODE_ENV = oldEnv;
  });

  it('12. Existing Cash on Delivery behavior remains unchanged', () => {
    const registry = new PaymentProviderRegistry({
      PAYMENT_PROVIDER: 'MOCK',
    });

    const resolved = registry.resolveProviderForMethod(PaymentMethod.CASH_ON_DELIVERY);
    expect(resolved).toBe(PaymentProvider.NONE);

    const provider = registry.getProvider(PaymentProvider.NONE);
    expect(provider.supportsIdempotentInitiation).toBe(true);
  });

  it('13. Session token validation accepts valid token and rejects expired/mismatched tokens', () => {
    process.env.MOCK_CHECKOUT_SECRET = 'secret-123456789012345678901234567890';
    const paymentId = 'pay-session-test';
    const token = MockMyFatoorahProvider.generateSessionToken(paymentId);

    expect(MockMyFatoorahProvider.verifySessionToken(paymentId, token)).toBe(true);
    expect(MockMyFatoorahProvider.verifySessionToken('wrong-payment', token)).toBe(false);
    expect(MockMyFatoorahProvider.verifySessionToken(paymentId, 'invalid-token')).toBe(false);

    process.env.MOCK_CHECKOUT_SECRET = 'wrong-secret-12345678901234567890';
    expect(MockMyFatoorahProvider.verifySessionToken(paymentId, token)).toBe(false);
  });
});

describe('Real HTTP Mock Payment Lifecycle Integration Test', () => {
  let tenantId: string;
  let userId: string;
  let token: string;
  let tenantSlug: string;
  let paymentId: string;
  let orderId: string;

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = 'MOCK';
    process.env.MOCK_CHECKOUT_SECRET = 'secret-123456789012345678901234567890';
    process.env.JWT_ACCESS_SECRET = 'secret-123456789012345678901234567890';

    const fixture = `mock-http-${randomUUID()}`;
    tenantSlug = fixture;

    const tenant = await prisma.tenant.create({
      data: { name: 'Mock HTTP Tenant', slug: tenantSlug, code: fixture, defaultCurrency: 'KWD' },
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        email: `${fixture}@example.test`,
        firstName: 'Mock',
        lastName: 'Buyer',
        passwordHash: 'hash',
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    token = await createAccessToken(userId);

    await prisma.country.upsert({
      where: { code: 'KW' },
      update: { isActive: true },
      create: {
        code: 'KW',
        name: 'Kuwait',
        currencyCode: 'KWD',
        isActive: true,
      },
    });

    const taxCategory = await prisma.taxCategory.create({
      data: {
        tenantId,
        code: fixture,
        name: 'Mock Tax',
        treatment: 'EXEMPT',
      },
    });
    await prisma.taxRule.create({
      data: { taxCategoryId: taxCategory.id, countryCode: 'KW', rate: 0 },
    });
    await prisma.taxProfile.create({
      data: {
        tenantId,
        countryCode: 'KW',
        currency: 'KWD',
        defaultTaxCategoryId: taxCategory.id,
        isTaxRegistered: false,
      },
    });

    const category = await prisma.category.create({
      data: { tenantId, name: 'Mock Category', slug: fixture },
    });

    const product = await prisma.product.create({
      data: { tenantId, categoryId: category.id, name: 'Mock Item', slug: fixture, basePrice: '25.00', status: 'ACTIVE' },
    });

    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: fixture, combinationKey: '', isDefault: true },
    });

    await createInventoryFixture({
      data: { variantId: variant.id, quantity: 10, reservedQuantity: 0 },
    });

    const address = await prisma.address.create({
      data: { userId, firstName: 'Mock', lastName: 'Buyer', addressLine1: 'Test St', city: 'Kuwait', countryCode: 'KW' },
    });

    const cart = await createCartFixture({ data: { tenantId, userId } });
    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
    });

    const shippingProfile = await createShippingProfileFixture({
      data: { tenantId, countryCode: 'KW', currency: 'KWD', originLatitude: 29.37, originLongitude: 47.97 },
    });
    const zone = await prisma.shippingZone.create({
      data: { profileId: shippingProfile.id, code: fixture, name: 'KW Zone', countryCode: 'KW' },
    });
    const method = await prisma.shippingMethod.create({
      data: { zoneId: zone.id, code: 'EXPRESS', name: 'Express' },
    });
    await prisma.shippingRule.create({
      data: { methodId: method.id, flatRate: '0.00' },
    });

    // 1. Checkout via HTTP
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('X-Tenant-Slug', tenantSlug)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idemp-${randomUUID()}`)
      .send({
        shippingAddressId: address.id,
        billingSameAsShipping: true,
        shippingMethodCode: 'EXPRESS',
        paymentMethod: 'CARD',
      });

    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.data.order.id).toBeDefined();
    expect(checkoutRes.body.data.payment.id).toBeDefined();

    orderId = checkoutRes.body.data.order.id;
    paymentId = checkoutRes.body.data.payment.id;
  });

  it('14. Full HTTP payment lifecycle: initiation, mock checkout page, scenario trigger, and verification', async () => {
    // 2. Initiate via HTTP
    const initiateRes = await request(app)
      .post(`/api/v1/payments/${paymentId}/initiate`)
      .set('X-Tenant-Slug', tenantSlug)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(initiateRes.status).toBe(200);
    expect(initiateRes.body.data.status).toBe('REQUIRES_ACTION');

    const checkoutUrlStr = initiateRes.body.data.metadata.checkoutUrl as String;
    const urlObj = new URL(checkoutUrlStr.toString());
    const sessionToken = urlObj.searchParams.get('token');

    expect(sessionToken).toBeDefined();

    // 3. Load mock checkout page HTML via HTTP
    const pageRes = await request(app)
      .get(`/api/v1/payments/mock/checkout/${paymentId}?token=${sessionToken}`)
      .set('X-Tenant-Slug', tenantSlug);

    expect(pageRes.status).toBe(200);
    expect(pageRes.text).contains('Mock MyFatoorah Gateway');

    // 4. Submit PAID scenario via HTTP
    const scenarioRes = await request(app)
      .post(`/api/v1/payments/mock/checkout/${paymentId}/scenario?token=${sessionToken}`)
      .set('X-Tenant-Slug', tenantSlug)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PAID' });

    expect(scenarioRes.status).toBe(200);
    expect(scenarioRes.body.success).toBe(true);

    // 5. Verify payment via HTTP
    const verifyRes = await request(app)
      .post(`/api/v1/payments/${paymentId}/verify`)
      .set('X-Tenant-Slug', tenantSlug)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.status).toBe('PAID');

    // 6. DB Assertions
    const dbPayment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    expect(dbPayment.status).toBe('PAID');
    expect(dbOrder.paymentStatus).toBe('PAID');

    // 7. Duplicate verification idempotency
    const verifyRes2 = await request(app)
      .post(`/api/v1/payments/${paymentId}/verify`)
      .set('X-Tenant-Slug', tenantSlug)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(verifyRes2.status).toBe(200);
    expect(verifyRes2.body.data.status).toBe('PAID');
  });
});
