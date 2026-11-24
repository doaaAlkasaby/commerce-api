import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { validateAmount } from '../../../common/pricing/money.js';
import { prisma } from '../../../config/database.js';
import {
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import type { PaymentProviderAdapter } from './payment-provider.js';
import type {
  PaymentProviderCreateInput,
  PaymentProviderCreateResult,
  ProviderRefundInput,
  ProviderRefundResult,
  VerifiedProviderPayment,
} from '../payment.types.js';

export type MockRefundBehavior =
  | ((input: ProviderRefundInput) => Promise<ProviderRefundResult> | ProviderRefundResult)
  | ProviderRefundResult
  | { throwError: Error };

interface MockInvoiceRecord {
  invoiceId: string;
  paymentId: string;
  orderId: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
}

export class MockMyFatoorahProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.MYFATOORAH;
  readonly supportsIdempotentInitiation = true;
  readonly supportsRefunds = true;

  private static readonly mockInvoices = new Map<string, MockInvoiceRecord>();
  private static readonly mockRefundedTotals = new Map<string, Prisma.Decimal>();
  private static readonly refundCallCounts = new Map<string, number>();
  private static readonly refundBehaviors = new Map<string, MockRefundBehavior[]>();

  private static getSecret(): string {
    const secret = process.env.MOCK_CHECKOUT_SECRET;
    if (!secret || secret.trim().length < 32) {
      throw new AppError('Mock checkout secret configuration missing or weak (MOCK_CHECKOUT_SECRET must be at least 32 characters)', 500, 'MOCK_SECRET_MISSING');
    }
    return secret;
  }

  static generateSessionToken(paymentId: string): string {
    const secret = MockMyFatoorahProvider.getSecret();
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes TTL
    const payload = `${paymentId}:${expiresAt}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}:${sig}`;
  }

  static verifySessionToken(paymentId: string, token: string | undefined): boolean {
    const secret = process.env.MOCK_CHECKOUT_SECRET;
    if (!secret || secret.trim().length < 32 || !token) return false;
    const parts = token.split(':');
    if (parts.length !== 3) return false;

    const [tokenPaymentId, expiresAtStr, sig] = parts;
    if (tokenPaymentId !== paymentId || !sig) return false;

    const expiresAt = Number(expiresAtStr);
    const now = Date.now();
    if (isNaN(expiresAt) || now > expiresAt || expiresAt > now + 30 * 60 * 1000 + 5000) {
      return false;
    }

    const expectedSig = createHmac('sha256', secret).update(`${tokenPaymentId}:${expiresAtStr}`).digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const receivedBuf = Buffer.from(sig, 'utf8');

    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  static setMockInvoiceStatus(invoiceId: string, status: PaymentStatus): void {
    const record = MockMyFatoorahProvider.mockInvoices.get(invoiceId);
    if (record) {
      record.status = status;
    }
  }

  static getMockInvoice(invoiceId: string): MockInvoiceRecord | undefined {
    return MockMyFatoorahProvider.mockInvoices.get(invoiceId);
  }

  static clearMockInvoices(): void {
    MockMyFatoorahProvider.mockInvoices.clear();
    MockMyFatoorahProvider.resetRefundState();
  }

  static resetRefundState(): void {
    MockMyFatoorahProvider.mockRefundedTotals.clear();
    MockMyFatoorahProvider.refundCallCounts.clear();
    MockMyFatoorahProvider.refundBehaviors.clear();
  }

  static enqueueRefundBehavior(
    invoiceId: string,
    behavior: MockRefundBehavior,
  ): void {
    const queue = MockMyFatoorahProvider.refundBehaviors.get(invoiceId) ?? [];
    queue.push(behavior);
    MockMyFatoorahProvider.refundBehaviors.set(invoiceId, queue);
  }

  static getRefundCallCount(invoiceId: string): number {
    return MockMyFatoorahProvider.refundCallCounts.get(invoiceId) ?? 0;
  }

  validatePayment(input: Pick<PaymentProviderCreateInput, 'amount' | 'currency'>): void {
    if (input.currency !== 'KWD') {
      throw new AppError(
        'Kuwait sandbox payments require KWD; currency conversion is disabled',
        400,
        'PAYMENT_CURRENCY_NOT_SUPPORTED',
      );
    }
  }

  async createPayment(input: PaymentProviderCreateInput): Promise<PaymentProviderCreateResult> {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Mock payment provider is prohibited in production', 500, 'MOCK_PAYMENT_PROHIBITED_IN_PRODUCTION');
    }

    this.validatePayment(input);

    const baseUrl = process.env.MOCK_CHECKOUT_BASE_URL || 'http://localhost:3000';
    const invoiceId = `mock-inv-${input.paymentId}`;
    const token = MockMyFatoorahProvider.generateSessionToken(input.paymentId);
    const checkoutUrl = `${baseUrl}/api/v1/payments/mock/checkout/${input.paymentId}?token=${token}`;

    MockMyFatoorahProvider.mockInvoices.set(invoiceId, {
      invoiceId,
      paymentId: input.paymentId,
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      status: PaymentStatus.REQUIRES_ACTION,
    });

    return {
      status: PaymentStatus.REQUIRES_ACTION,
      providerPaymentId: invoiceId,
      checkoutUrl,
      metadata: { apiVersion: 'v2', environment: 'mock', mockStatus: PaymentStatus.REQUIRES_ACTION },
    };
  }

  async getPaymentStatus(invoiceId: string): Promise<VerifiedProviderPayment> {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Mock payment provider is prohibited in production', 500, 'MOCK_PAYMENT_PROHIBITED_IN_PRODUCTION');
    }

    let dbPayment: any = null;
    try {
      dbPayment = await prisma.payment.findFirst({
        where: { providerPaymentId: invoiceId },
        include: { order: true },
      });
    } catch (_) {
      // Ignore DB connectivity errors in isolated non-DB unit tests
    }

    if (dbPayment) {
      const meta = dbPayment.metadata as Record<string, unknown> | null;
      const providerMeta = (meta?.providerMetadata as Record<string, unknown> | null) ?? meta;
      if (providerMeta?.environment !== 'mock' && meta?.environment !== 'mock') {
        throw new AppError('Payment is not a valid mock payment', 400, 'PAYMENT_NOT_MOCK_ENVIRONMENT');
      }
      const mockStatusStr = providerMeta?.mockStatus?.toString() || meta?.mockStatus?.toString();
      if (!mockStatusStr || !Object.values(PaymentStatus).includes(mockStatusStr as PaymentStatus)) {
        throw new AppError('Mock payment metadata status is missing or invalid', 404, 'MYFATOORAH_INVOICE_NOT_FOUND');
      }

      return {
        invoiceId,
        transactionPaymentIds: [`tx-${invoiceId}`],
        customerReference: dbPayment.id,
        orderReference: dbPayment.orderId,
        amount: dbPayment.amount.toString(),
        currency: dbPayment.currency,
        status: mockStatusStr as PaymentStatus,
        transactionId: `tx-${invoiceId}`,
        transactionPaymentId: `tx-${invoiceId}`,
      };
    }

    const record = MockMyFatoorahProvider.mockInvoices.get(invoiceId);
    if (!record) {
      throw new AppError('Mock payment invoice not found', 404, 'MYFATOORAH_INVOICE_NOT_FOUND');
    }

    return {
      invoiceId,
      transactionPaymentIds: [`tx-${invoiceId}`],
      customerReference: record.paymentId,
      orderReference: record.orderId,
      amount: record.amount,
      currency: record.currency,
      status: record.status,
      transactionId: `tx-${invoiceId}`,
      transactionPaymentId: `tx-${invoiceId}`,
    };
  }

  async cancelPayment(invoiceId: string): Promise<{ status: PaymentStatus }> {
    const record = MockMyFatoorahProvider.mockInvoices.get(invoiceId);
    if (record) {
      record.status = PaymentStatus.CANCELLED;
    }
    return { status: PaymentStatus.CANCELLED };
  }

  async executeRefund(
    input: ProviderRefundInput,
  ): Promise<ProviderRefundResult> {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(
        'Mock payment provider is prohibited in production',
        500,
        'MOCK_PAYMENT_PROHIBITED_IN_PRODUCTION',
      );
    }

    const previousCalls =
      MockMyFatoorahProvider.refundCallCounts.get(input.providerPaymentId) ?? 0;
    MockMyFatoorahProvider.refundCallCounts.set(
      input.providerPaymentId,
      previousCalls + 1,
    );

    const queue = MockMyFatoorahProvider.refundBehaviors.get(
      input.providerPaymentId,
    );
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (typeof next === 'function') {
        return next(input);
      }
      if ('throwError' in next) {
        throw next.throwError;
      }
      return next;
    }

    const amountDecimal = validateAmount(input.amount, input.currency);
    if (amountDecimal.lte(0)) {
      return {
        outcome: 'FAILED',
        definitiveFailure: true,
        refundId: input.refundId,
        originalProviderPaymentId: input.providerPaymentId,
        amount: input.amount,
        currency: input.currency,
        failureCode: 'MOCK_INVALID_REFUND_AMOUNT',
        failureMessage: 'Refund amount must be positive',
      };
    }

    const record = MockMyFatoorahProvider.mockInvoices.get(
      input.providerPaymentId,
    );
    const alreadyRefunded =
      MockMyFatoorahProvider.mockRefundedTotals.get(input.providerPaymentId) ??
      new Prisma.Decimal(0);
    if (record) {
      const captured = new Prisma.Decimal(record.amount);
      if (alreadyRefunded.add(amountDecimal).gt(captured)) {
        return {
          outcome: 'FAILED',
          definitiveFailure: true,
          refundId: input.refundId,
          originalProviderPaymentId: input.providerPaymentId,
          amount: input.amount,
          currency: input.currency,
          failureCode: 'MOCK_REFUND_EXCEEDS_CAPTURED',
          failureMessage: 'Requested refund exceeds captured invoice amount',
        };
      }
      const nextTotal = alreadyRefunded.add(amountDecimal);
      MockMyFatoorahProvider.mockRefundedTotals.set(
        input.providerPaymentId,
        nextTotal,
      );
      record.status = nextTotal.equals(captured)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    } else {
      MockMyFatoorahProvider.mockRefundedTotals.set(
        input.providerPaymentId,
        alreadyRefunded.add(amountDecimal),
      );
    }

    return {
      outcome: 'SUCCEEDED',
      refundId: input.refundId,
      originalProviderPaymentId: input.providerPaymentId,
      amount: input.amount,
      currency: input.currency,
      providerRefundId: `mock-ref-${input.refundId}`,
      providerRefundReference: `mock-ref-no-${input.refundId.slice(0, 8)}`,
      providerRefundInvoiceId: input.providerPaymentId,
      metadata: {
        environment: 'mock',
        apiVersion: 'v2',
      },
    };
  }

  async refundPayment(
    invoiceId: string,
    amount: string,
  ): Promise<{ status: PaymentStatus; providerTransactionId: string }> {
    const result = await this.executeRefund({
      refundId: `legacy-${invoiceId}`,
      idempotencyKey: `legacy-${invoiceId}-${amount}`,
      providerPaymentId: invoiceId,
      amount,
      currency: 'KWD',
      reason: 'Legacy mock refund',
    });
    const record = MockMyFatoorahProvider.mockInvoices.get(invoiceId);
    return {
      status: record?.status ?? PaymentStatus.REFUNDED,
      providerTransactionId: result.providerRefundId ?? `ref-${invoiceId}`,
    };
  }
}
