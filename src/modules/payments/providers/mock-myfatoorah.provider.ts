import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { prisma } from '../../../config/database.js';
import {
  PaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/client.js';
import type { PaymentProviderAdapter } from './payment-provider.js';
import type {
  PaymentProviderCreateInput,
  PaymentProviderCreateResult,
  VerifiedProviderPayment,
} from '../payment.types.js';

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

  private static readonly mockInvoices = new Map<string, MockInvoiceRecord>();

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

  async refundPayment(invoiceId: string): Promise<{ status: PaymentStatus; providerTransactionId: string }> {
    const record = MockMyFatoorahProvider.mockInvoices.get(invoiceId);
    if (record) {
      record.status = PaymentStatus.REFUNDED;
    }
    return { status: PaymentStatus.REFUNDED, providerTransactionId: `ref-${invoiceId}` };
  }
}
