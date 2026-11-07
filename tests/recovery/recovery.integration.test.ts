import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { randomUUID, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
import { testPrisma } from '../../src/config/test-database.js';
import { RecoveryRepository } from '../../src/modules/recovery/recovery.repository.js';
import { RecoveryService } from '../../src/modules/recovery/recovery.service.js';
import { RecoveryWorker } from '../../src/modules/recovery/recovery.worker.js';
import { workerConfigurationSchema } from '../../src/config/worker-options.js';
import { PaymentVerificationService } from '../../src/modules/payments/payment-verification.service.js';
import { OrderService } from '../../src/modules/orders/order.service.js';
import type { RecoveryJob } from '../../src/generated/prisma/client.js';

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
      MYFATOORAH_WEBHOOK_SECRET: 'mock-worker-secret',
      MYFATOORAH_CALLBACK_URL: 'https://shop.example.test/return',
      MYFATOORAH_ERROR_URL: 'https://shop.example.test/error',
      MYFATOORAH_TIMEOUT_MS: 100,
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const configuration = workerConfigurationSchema.parse({
  WORKER_MAX_ATTEMPTS: 3,
  WORKER_RETRY_BASE_MS: 1000,
});
const repository = new RecoveryRepository(testPrisma);
const service = new RecoveryService(
  repository,
  configuration,
  undefined,
  undefined,
  undefined,
  () => 0.5,
);
const fixture = `worker-${randomUUID()}`;
let tenantId: string,
  otherTenantId: string,
  userId: string,
  productId: string,
  variantId: string,
  inventoryId: string,
  orderId: string,
  paymentId: string;
let amount = '0.001',
  invoiceStatus = 'Paid',
  transactionStatus = 'Succss',
  remoteCurrency = 'KD',
  remoteInvoice = '100001';

function response() {
  return Response.json({
    IsSuccess: true,
    Data: {
      InvoiceId: remoteInvoice,
      InvoiceStatus: invoiceStatus,
      CustomerReference: paymentId,
      UserDefinedField: orderId,
      InvoiceValue: amount,
      InvoiceDisplayValue: `${amount} ${remoteCurrency}`,
      InvoiceTransactions: [
        {
          TransactionId: '90001',
          PaymentId: '0707001',
          TransactionStatus: transactionStatus,
          Currency: remoteCurrency,
          TransationValue: amount,
          PaidCurrency: remoteCurrency,
          PaidCurrencyValue: amount,
        },
      ],
    },
  });
}
async function job(): Promise<RecoveryJob> {
  return testPrisma.recoveryJob.create({
    data: { tenantId, orderId, availableAt: new Date(0) },
  });
}
async function claim() {
  await job();
  const rows = await repository.claim(1, 60000);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}
async function stored() {
  return testPrisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
}
async function inventory() {
  return testPrisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
}
async function dueAgain(id: string) {
  await testPrisma.$executeRaw`UPDATE "RecoveryJob" SET "availableAt" = clock_timestamp() - interval '1 second' WHERE "id"=${id}`;
}
async function expired(provider: 'NONE' | 'MYFATOORAH' = 'NONE') {
  await testPrisma.$executeRaw`UPDATE "Order" SET "reservationExpiresAt" = clock_timestamp() - interval '1 second' WHERE "id"=${orderId}`;
  await testPrisma.payment.update({
    where: { id: paymentId },
    data: {
      provider,
      initiationState: 'NOT_STARTED',
      providerPaymentId: null,
      method: 'CARD',
    },
  });
}
async function webhook() {
  const canonical =
    'Invoice.Id=100001,Invoice.Status=PAID,Transaction.Status=SUCCESS,Transaction.PaymentId=0707001,Invoice.ExternalIdentifier=';
  const signature = createHmac('sha256', 'mock-worker-secret')
    .update(canonical)
    .digest('base64');
  return new PaymentVerificationService().processWebhook(
    {
      Event: {
        Code: 1,
        Name: 'PAYMENT_STATUS_CHANGED',
        CountryIsoCode: 'KWT',
        Reference: 'worker-event',
      },
      Data: {
        Invoice: { Id: '100001', Status: 'PAID', ExternalIdentifier: null },
        Transaction: { Status: 'SUCCESS', PaymentId: '0707001' },
      },
    },
    signature,
  );
}

describe('PostgreSQL recovery worker', () => {
  beforeAll(async () => {
    const tenant = await testPrisma.tenant.create({
      data: {
        name: 'Worker',
        slug: fixture,
        code: fixture,
        defaultCurrency: 'KWD',
      },
    });
    tenantId = tenant.id;
    otherTenantId = (
      await testPrisma.tenant.create({
        data: {
          name: 'Other',
          slug: `${fixture}-other`,
          code: `${fixture}-other`,
          defaultCurrency: 'USD',
        },
      })
    ).id;
    userId = (
      await testPrisma.user.create({
        data: {
          email: `${fixture}@example.test`,
          passwordHash: 'not-a-login',
          firstName: 'Worker',
          lastName: 'Test',
        },
      })
    ).id;
    const category = await testPrisma.category.create({
      data: { tenantId, name: 'Worker', slug: fixture },
    });
    productId = (
      await testPrisma.product.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: 'Worker',
          slug: fixture,
          basePrice: '0.001',
        },
      })
    ).id;
    variantId = (
      await testPrisma.productVariant.create({
        data: { productId, sku: fixture, combinationKey: 'default' },
      })
    ).id;
    inventoryId = (
      await testPrisma.inventory.create({ data: { variantId, quantity: 10 } })
    ).id;
  });
  beforeEach(async () => {
    amount = '0.001';
    invoiceStatus = 'Paid';
    transactionStatus = 'Succss';
    remoteCurrency = 'KD';
    remoteInvoice = '100001';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    );
    const order = await testPrisma.order.create({
      data: {
        tenantId,
        userId,
        orderNumber: randomUUID(),
        currency: 'KWD',
        subtotal: '0.001',
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        totalAmount: '0.001',
        shippingAddress: {},
        billingAddress: {},
        items: {
          create: {
            productId,
            variantId,
            productName: 'Worker',
            sku: fixture,
            quantity: 1,
            unitPrice: '0.001',
            finalUnitPrice: '0.001',
            totalPrice: '0.001',
            itemDiscountAmount: 0,
            taxableAmount: '0.001',
            taxAmount: 0,
            variantSnapshot: {},
          },
        },
      },
    });
    orderId = order.id;
    paymentId = (
      await testPrisma.payment.create({
        data: {
          orderId,
          provider: 'MYFATOORAH',
          method: 'CARD',
          amount: '0.001',
          currency: 'KWD',
          initiationState: 'INITIATED',
          providerPaymentId: '100001',
        },
      })
    ).id;
    await testPrisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: 10, reservedQuantity: 1 },
    });
    await testPrisma.inventoryTransaction.create({
      data: {
        inventoryId,
        type: 'RESERVATION',
        quantity: 1,
        referenceId: orderId,
      },
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await testPrisma.myFatoorahWebhookEvent.deleteMany({
      where: { paymentId },
    });
    await testPrisma.myFatoorahInvoice.deleteMany({ where: { paymentId } });
    await testPrisma.payment.deleteMany({ where: { orderId } });
    await testPrisma.order.deleteMany({ where: { id: orderId } });
    await testPrisma.inventoryTransaction.deleteMany({
      where: { inventoryId },
    });
  });
  afterAll(async () => {
    await testPrisma.product.deleteMany({ where: { tenantId } });
    await testPrisma.category.deleteMany({ where: { tenantId } });
    await testPrisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await testPrisma.user.delete({ where: { id: userId } });
    await testPrisma.$disconnect();
  });

  it('expires an unpaid local reservation exactly once', async () => {
    await expired();
    const j = await claim();
    expect(await service.process(j)).toBe('EXPIRED');
    expect((await inventory()).reservedQuantity).toBe(0);
    expect((await inventory()).quantity).toBe(10);
    expect(await service.process(j)).toBe('LEASE_LOST');
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'RELEASE' },
      }),
    ).toBe(1);
  });
  it('does not expire an unexpired local reservation', async () => {
    await expired();
    await testPrisma.$executeRaw`UPDATE "Order" SET "reservationExpiresAt"=clock_timestamp()+interval '1 hour' WHERE "id"=${orderId}`;
    expect(await service.process(await claim())).toBe('AWAITING_DEADLINE');
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('does not infer an expiry for legacy or COD orders', async () => {
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: {
        provider: 'NONE',
        method: 'CASH_ON_DELIVERY',
        initiationState: 'NOT_STARTED',
        providerPaymentId: null,
      },
    });
    expect(await repository.enqueue(10)).toBe(0);
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('does not release a paid reservation', async () => {
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { status: 'PAID' },
    });
    await testPrisma.order.update({
      where: { id: orderId },
      data: { paymentStatus: 'PAID' },
    });
    expect(await service.process(await claim())).toBe('DONE');
    expect((await inventory()).reservedQuantity).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves stock for a pending external invoice after expiration', async () => {
    invoiceStatus = 'Pending';
    transactionStatus = 'InProgress';
    await testPrisma.$executeRaw`UPDATE "Order" SET "reservationExpiresAt"=clock_timestamp()-interval '1 minute' WHERE "id"=${orderId}`;
    expect(await service.process(await claim())).toBe('RETRY');
    expect((await inventory()).reservedQuantity).toBe(1);
    expect((await stored()).status).toBe('PENDING');
  });
  it('preserves UNKNOWN without an invoice and flags manual intervention', async () => {
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { initiationState: 'UNKNOWN', providerPaymentId: null },
    });
    expect(await service.process(await claim())).toBe('MANUAL');
    expect((await stored()).initiationState).toBe('UNKNOWN');
    expect((await stored()).reconciliationRequired).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('reconciles known UNKNOWN invoices without creating another invoice', async () => {
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { initiationState: 'UNKNOWN' },
    });
    expect(await service.process(await claim())).toBe('RECONCILED');
    expect((await stored()).status).toBe('PAID');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('GetPaymentStatus');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('commits verified successful inventory once', async () => {
    expect(await service.process(await claim())).toBe('RECONCILED');
    expect((await inventory()).quantity).toBe(9);
    expect((await inventory()).reservedQuantity).toBe(0);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE' },
      }),
    ).toBe(1);
  });
  it('does not double-commit when the same claimed work executes concurrently', async () => {
    const barrier = deferred<void>();
    let requests = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      requests++;
      if (requests === 2) barrier.resolve();
      await barrier.promise;
      return response();
    });
    const j = await claim();
    await Promise.all([service.process(j), service.process(j)]);
    expect((await inventory()).quantity).toBe(9);
    expect((await inventory()).reservedQuantity).toBe(0);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE' },
      }),
    ).toBe(1);
  });
  it('releases verified failed inventory once', async () => {
    invoiceStatus = 'Canceled';
    transactionStatus = 'Failed';
    expect(await service.process(await claim())).toBe('RECONCILED');
    expect((await stored()).status).toBe('FAILED');
    expect((await inventory()).quantity).toBe(10);
    expect((await inventory()).reservedQuantity).toBe(0);
  });
  it('retries provider timeout without changing financial state', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new DOMException('secret payload', 'TimeoutError'),
    );
    const j = await claim();
    expect(await service.process(j)).toBe('RETRY');
    const saved = await testPrisma.recoveryJob.findUniqueOrThrow({
      where: { id: j.id },
    });
    expect(saved.lastErrorCode).toBe('PROVIDER_TIMEOUT');
    expect(saved.availableAt.getTime()).toBeGreaterThan(
      saved.updatedAt.getTime(),
    );
    expect(JSON.stringify(saved)).not.toContain('secret');
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('honors provider rate limiting with a durable next attempt', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
    );
    const j = await claim();
    expect(await service.process(j)).toBe('RETRY');
    const saved = await testPrisma.recoveryJob.findUniqueOrThrow({
      where: { id: j.id },
    });
    expect(saved.lastErrorCode).toBe('PROVIDER_RATE_LIMITED');
    expect(
      saved.availableAt.getTime() - saved.updatedAt.getTime(),
    ).toBeGreaterThanOrEqual(119000);
  });
  it('does not retry earlier than an excessive provider Retry-After', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 429, headers: { 'Retry-After': '172800' } }),
    );
    const j = await claim();
    expect(await service.process(j)).toBe('MANUAL');
    expect(
      (await testPrisma.recoveryJob.findUniqueOrThrow({ where: { id: j.id } }))
        .lastErrorCode,
    ).toBe('PROVIDER_RATE_LIMIT_REQUIRES_REVIEW');
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('does not claim a backoff job before database time makes it eligible', async () => {
    const j = await job();
    await testPrisma.$executeRaw`UPDATE "RecoveryJob" SET "availableAt"=clock_timestamp()+interval '1 hour' WHERE "id"=${j.id}`;
    expect(await repository.claim(1, 60000)).toEqual([]);
    await dueAgain(j.id);
    expect(await repository.claim(1, 60000)).toHaveLength(1);
  });
  it.each(['rejected', 'timeout'])(
    'persists %s initiation outcome for manual recovery without a second invoice',
    async (kind) => {
      await testPrisma.payment.update({
        where: { id: paymentId },
        data: { initiationState: 'NOT_STARTED', providerPaymentId: null },
      });
      if (kind === 'timeout')
        vi.mocked(fetch).mockRejectedValue(
          new DOMException('not persisted', 'TimeoutError'),
        );
      else
        vi.mocked(fetch).mockResolvedValue(
          Response.json({
            IsSuccess: false,
            Data: null,
            Message: 'not persisted',
          }),
        );
      await expect(
        new PaymentService().initiatePayment(tenantId, userId, paymentId),
      ).rejects.toMatchObject({
        code: kind === 'timeout' ? 'MYFATOORAH_TIMEOUT' : 'MYFATOORAH_REJECTED',
      });
      const queued = await testPrisma.recoveryJob.findUniqueOrThrow({
        where: { orderId },
      });
      const expected =
        kind === 'timeout' ? 'INITIATION_TIMEOUT' : 'INITIATION_REJECTED';
      expect(queued.lastErrorCode).toBe(expected);
      await dueAgain(queued.id);
      const [claimed] = await repository.claim(1, 60000);
      expect(await service.process(claimed!)).toBe('MANUAL');
      expect(
        (
          await testPrisma.recoveryJob.findUniqueOrThrow({
            where: { id: queued.id },
          })
        ).lastErrorCode,
      ).toBe(expected);
      expect((await stored()).initiationState).toBe('UNKNOWN');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await inventory()).reservedQuantity).toBe(1);
    },
  );
  it('deduplicates scheduling and job identity', async () => {
    await Promise.all([repository.enqueue(10), repository.enqueue(10)]);
    expect(await testPrisma.recoveryJob.count({ where: { orderId } })).toBe(1);
  });
  it('claims a logical job on only one concurrent instance', async () => {
    await job();
    const batches = await Promise.all([
      repository.claim(1, 60000),
      new RecoveryRepository(testPrisma).claim(1, 60000),
    ]);
    expect(batches.flat()).toHaveLength(1);
  });
  it('recovers a crashed lease and fences its old claim', async () => {
    const old = await claim();
    await testPrisma.$executeRaw`UPDATE "RecoveryJob" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "id"=${old.id}`;
    const [current] = await repository.claim(1, 60000);
    expect(current?.attempts).toBe(2);
    expect(current?.claimToken).not.toBe(old.claimToken);
    expect(await service.process(old)).toBe('LEASE_LOST');
    expect(await service.process(current!)).toBe('RECONCILED');
    expect((await inventory()).quantity).toBe(9);
  });
  it('fences an expired claim while the provider HTTP call is in flight', async () => {
    const started = deferred<void>(),
      release = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return response();
    });
    const old = await claim();
    const processing = service.process(old);
    await started.promise;
    await testPrisma.$executeRaw`UPDATE "RecoveryJob" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "id"=${old.id}`;
    const [current] = await repository.claim(1, 60000);
    release.resolve();
    expect(await processing).toBe('LEASE_LOST');
    expect((await stored()).status).toBe('PENDING');
    expect(await service.process(current!)).toBe('RECONCILED');
    expect((await inventory()).quantity).toBe(9);
  });
  it('handles webhook and worker success concurrently without a double sale', async () => {
    await testPrisma.myFatoorahInvoice.create({
      data: { paymentId, invoiceId: '100001' },
    });
    const started = deferred<void>(),
      release = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return response();
    });
    const processing = service.process(await claim());
    await started.promise;
    try {
      await webhook();
    } finally {
      release.resolve();
    }
    await processing;
    expect((await inventory()).quantity).toBe(9);
    expect(
      await testPrisma.inventoryTransaction.count({
        where: { inventoryId, type: 'SALE' },
      }),
    ).toBe(1);
  });
  it.each(['cancelled', 'failed'])(
    'flags late success after %s and never re-reserves inventory',
    async (kind) => {
      if (kind === 'cancelled')
        await new OrderService().expirePendingOrder(tenantId, orderId);
      else {
        invoiceStatus = 'Canceled';
        transactionStatus = 'Failed';
        await new PaymentVerificationService().verifyForUser(
          tenantId,
          userId,
          paymentId,
        );
        invoiceStatus = 'Paid';
        transactionStatus = 'Succss';
      }
      expect((await inventory()).reservedQuantity).toBe(0);
      expect(await service.process(await claim())).toBe('MANUAL');
      expect((await inventory()).quantity).toBe(10);
      expect((await stored()).reconciliationRequired).toBe(true);
    },
  );
  it('does not cancel after a concurrent verified success', async () => {
    await service.process(await claim());
    await expect(
      new OrderService().expirePendingOrder(tenantId, orderId),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await stored()).status).toBe('PAID');
    expect((await inventory()).quantity).toBe(9);
  });
  it('does not downgrade a successful payment when a later worker sees failure', async () => {
    const j = await claim();
    await service.process(j);
    invoiceStatus = 'Canceled';
    transactionStatus = 'Failed';
    await testPrisma.recoveryJob.update({
      where: { id: j.id },
      data: { state: 'READY', availableAt: new Date(0) },
    });
    const [next] = await repository.claim(1, 60000);
    expect(await service.process(next!)).toBe('DONE');
    expect((await stored()).status).toBe('PAID');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['invoice', 'amount', 'currency'])(
    'dead-letters permanent %s identity mismatches',
    async (kind) => {
      if (kind === 'invoice') remoteInvoice = '999999';
      if (kind === 'amount') amount = '0.002';
      if (kind === 'currency') remoteCurrency = 'USD';
      expect(await service.process(await claim())).toBe('MANUAL');
      expect((await stored()).reconciliationRequired).toBe(true);
      expect((await inventory()).reservedQuantity).toBe(1);
    },
  );
  it.each([
    ['KWD', '0.001'],
    ['USD', '12.34'],
    ['JPY', '1234'],
  ])(
    'preserves exact %s amounts in local expiration',
    async (currency, value) => {
      await expired();
      await testPrisma.order.update({
        where: { id: orderId },
        data: { currency, totalAmount: value },
      });
      await testPrisma.payment.update({
        where: { id: paymentId },
        data: { currency, amount: value },
      });
      expect(await service.process(await claim())).toBe('EXPIRED');
      expect((await stored()).amount.equals(value)).toBe(true);
      expect((await stored()).currency).toBe(currency);
    },
  );
  it('bounds retries and flags exhaustion without releasing stock', async () => {
    invoiceStatus = 'Pending';
    transactionStatus = 'InProgress';
    let j = await claim();
    for (let i = 0; i < 3; i++) {
      const outcome = await service.process(j);
      if (i < 2) {
        expect(outcome).toBe('RETRY');
        await dueAgain(j.id);
        j = (await repository.claim(1, 60000))[0]!;
      } else expect(outcome).toBe('MANUAL');
    }
    expect((await stored()).reconciliationRequired).toBe(true);
    expect((await inventory()).reservedQuantity).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('does not retry authentication failures indefinitely', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const j = await claim();
    expect(await service.process(j)).toBe('MANUAL');
    expect(await repository.claim(1, 60000)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps unknown provider invoices manual and preserves stock', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ IsSuccess: false, Message: 'sensitive remote payload' }),
    );
    const j = await claim();
    expect(await service.process(j)).toBe('MANUAL');
    expect(
      JSON.stringify(
        await testPrisma.recoveryJob.findUnique({ where: { id: j.id } }),
      ),
    ).not.toContain('sensitive');
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('protects composite tenant ownership at the database boundary', async () => {
    await expect(
      testPrisma.recoveryJob.create({
        data: { orderId, tenantId: otherTenantId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('rejects a forged tenant scope without provider IO', async () => {
    const j = await claim();
    expect(await service.process({ ...j, tenantId: otherTenantId })).toBe(
      'LEASE_LOST',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps fresh initiation claims pending instead of retrying invoice creation', async () => {
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: { initiationState: 'IN_PROGRESS', providerPaymentId: null },
    });
    expect(await service.process(await claim())).toBe('RETRY');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('moves stale non-idempotent creation to UNKNOWN/manual without another create', async () => {
    await testPrisma.$executeRaw`UPDATE "Payment" SET "initiationState"='IN_PROGRESS',"providerPaymentId"=NULL,"updatedAt"=clock_timestamp()-interval '1 hour' WHERE "id"=${paymentId}`;
    expect(await service.process(await claim())).toBe('MANUAL');
    expect((await stored()).initiationState).toBe('UNKNOWN');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('recovers stale local NONE initiation idempotently', async () => {
    await testPrisma.$executeRaw`UPDATE "Payment" SET "provider"='NONE',"method"='CASH_ON_DELIVERY',"initiationState"='IN_PROGRESS',"providerPaymentId"=NULL,"updatedAt"=clock_timestamp()-interval '1 hour' WHERE "id"=${paymentId}`;
    expect(await service.process(await claim())).toBe('LOCAL_RECOVERED');
    expect((await stored()).initiationState).toBe('INITIATED');
    expect((await inventory()).reservedQuantity).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('expires a definitely uninitiated MyFatoorah reservation without an HTTP call', async () => {
    await expired('MYFATOORAH');
    expect(await service.process(await claim())).toBe('EXPIRED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('drains accepted work and stops new claims on shutdown', async () => {
    const started = deferred<void>(),
      release = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return response();
    });
    const controller = new AbortController();
    const running = new RecoveryWorker(service, configuration).run(
      controller.signal,
    );
    await started.promise;
    controller.abort();
    release.resolve();
    await running;
    expect((await stored()).status).toBe('PAID');
    expect(
      await testPrisma.recoveryJob.count({ where: { orderId, state: 'DONE' } }),
    ).toBe(1);
  });
  it('bounds repeated crash recovery without calling the provider after the budget', async () => {
    let current = await claim();
    for (let i = 0; i < 3; i++) {
      await testPrisma.$executeRaw`UPDATE "RecoveryJob" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "id"=${current.id}`;
      current = (await repository.claim(1, 60000))[0]!;
    }
    expect(await service.process(current)).toBe('MANUAL');
    expect(fetch).not.toHaveBeenCalled();
    expect((await stored()).reconciliationRequired).toBe(true);
  });
  it('preserves reservations for authorized pending capture', async () => {
    invoiceStatus = 'Pending';
    transactionStatus = 'Authorize';
    expect(await service.process(await claim())).toBe('RETRY');
    expect((await stored()).status).toBe('AUTHORIZED');
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('refuses expiration when initiation starts after the initial inspection', async () => {
    await expired('MYFATOORAH');
    const inspect = repository.inspect.bind(repository);
    vi.spyOn(repository, 'inspect').mockImplementationOnce(async (j) => {
      const snapshot = await inspect(j);
      await testPrisma.payment.update({
        where: { id: paymentId },
        data: { initiationState: 'IN_PROGRESS' },
      });
      return snapshot;
    });
    expect(await service.process(await claim())).toBe('RETRY');
    expect((await stored()).status).toBe('PENDING');
    expect((await inventory()).reservedQuantity).toBe(1);
  });
  it('rejects unsafe worker configuration without opening an HTTP listener', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/worker.ts'],
      {
        env: {
          ...process.env,
          PAYMENT_PROVIDER: 'NONE',
          WORKER_CONCURRENCY: '2',
          DB_POOL_MAX: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
  });
  it('bounds accepted work to configured concurrency and leaves additional jobs durable', async () => {
    const extraIds: string[] = [];
    const started = deferred<void>(),
      release = deferred<void>();
    let accepted = 0;
    try {
      for (let i = 0; i < 2; i++) {
        const order = await testPrisma.order.create({
          data: {
            tenantId,
            userId,
            orderNumber: randomUUID(),
            currency: 'KWD',
            subtotal: 0,
            discountAmount: 0,
            shippingAmount: 0,
            taxAmount: 0,
            totalAmount: 0,
            shippingAddress: {},
            billingAddress: {},
          },
        });
        extraIds.push(order.id);
        await testPrisma.recoveryJob.create({
          data: { tenantId, orderId: order.id },
        });
      }
      vi.spyOn(service, 'process').mockImplementation(async () => {
        accepted++;
        if (accepted === 2) started.resolve();
        await release.promise;
        return 'TEST_DRAINED';
      });
      const controller = new AbortController();
      const running = new RecoveryWorker(service, configuration).run(
        controller.signal,
      );
      await started.promise;
      controller.abort();
      release.resolve();
      await running;
      expect(accepted).toBe(2);
      expect(
        await testPrisma.recoveryJob.count({
          where: { tenantId, state: 'READY' },
        }),
      ).toBe(1);
    } finally {
      await testPrisma.order.deleteMany({ where: { id: { in: extraIds } } });
    }
  });
  it('supports standalone SIGTERM shutdown without MyFatoorah credentials', async () => {
    await testPrisma.payment.update({
      where: { id: paymentId },
      data: {
        provider: 'NONE',
        initiationState: 'NOT_STARTED',
        providerPaymentId: null,
      },
    });
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/worker.ts'],
      {
        env: {
          ...process.env,
          PAYMENT_PROVIDER: 'NONE',
          WORKER_CONCURRENCY: '1',
          DB_POOL_MAX: '3',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('Recovery worker ready')) child.kill('SIGTERM');
    });
    try {
      const [code] = await once(child, 'exit');
      expect(code).toBe(0);
      expect(output).toContain('Recovery worker stopped');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
});
