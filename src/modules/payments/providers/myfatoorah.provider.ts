import { ProviderRateLimitError } from './provider-retry.js';
import { validateAmount } from '../../../common/pricing/money.js';
import { z } from 'zod';
import { Prisma, PaymentProvider } from '../../../generated/prisma/client.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { MyFatoorahSettings } from '../../../config/payment-options.js';
import type {
  PaymentProviderCreateInput,
  PaymentProviderCreateResult,
  VerifiedProviderPayment,
} from '../payment.types.js';
import type { PaymentProviderAdapter } from './payment-provider.js';

const id = z
  .union([
    z.string().regex(/^\d{1,64}$/),
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ])
  .transform(String);
const money = z
  .union([z.string().regex(/^\d+(\.\d+)?$/), z.number().finite().nonnegative()])
  .transform(String);
const envelope = z.object({ IsSuccess: z.boolean(), Data: z.unknown() });
const createdInvoice = z.object({
  InvoiceId: id,
  InvoiceURL: z.url(),
  CustomerReference: z.string(),
});
const transaction = z.object({
  TransactionId: z.string(),
  PaymentId: z.string(),
  TransactionStatus: z.enum([
    'InProgress',
    'Succss',
    'Failed',
    'Canceled',
    'Authorize',
  ]),
  Currency: z.string(),
  TransationValue: money,
  PaidCurrency: z.string().optional(),
  PaidCurrencyValue: money.optional(),
});
const invoiceStatus = z.object({
  InvoiceId: id,
  InvoiceStatus: z.enum(['Pending', 'Paid', 'Canceled']),
  CustomerReference: z.string(),
  UserDefinedField: z.string(),
  InvoiceValue: money,
  InvoiceDisplayValue: z.string(),
  InvoiceTransactions: z.array(transaction),
});
function providerError(code: string, status = 502): AppError {
  return new AppError(
    'MyFatoorah payment operation could not be verified',
    status,
    code,
  );
}

/** V2 invoice-link integration only; no V3 calls or client-side card handling. */
export class MyFatoorahProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.MYFATOORAH;
  // SendPayment has no documented idempotency guarantee. Never retry UNKNOWN creates.
  readonly supportsIdempotentInitiation = false;
  constructor(
    private readonly settings: MyFatoorahSettings,
    private readonly http: typeof fetch = (...args) => fetch(...args),
  ) {}

  validatePayment(
    input: Pick<PaymentProviderCreateInput, 'amount' | 'currency'>,
  ): void {
    if (input.currency !== 'KWD')
      throw new AppError(
        'Kuwait sandbox payments require KWD; currency conversion is disabled',
        400,
        'PAYMENT_CURRENCY_NOT_SUPPORTED',
      );
    if (!/^\d+(\.\d+)?$/.test(input.amount))
      throw new AppError(
        'Invalid payment amount',
        400,
        'PAYMENT_AMOUNT_INVALID',
      );
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isFinite() || amount.lte(0) || amount.gt('9999999999.999'))
      throw new AppError(
        'Invalid payment amount',
        400,
        'PAYMENT_AMOUNT_INVALID',
      );
    // Kuwait account supports three fractional digits; never round provider input.
    if (amount.decimalPlaces() > 3)
      throw new AppError(
        'Payment exceeds supported KWD precision',
        409,
        'PAYMENT_CURRENCY_PRECISION_UNSUPPORTED',
      );
    validateAmount(input.amount, input.currency);
  }

  async createPayment(
    input: PaymentProviderCreateInput,
  ): Promise<PaymentProviderCreateResult> {
    this.validatePayment(input);
    const fields = JSON.stringify({
      CustomerName: 'Commerce customer',
      NotificationOption: 'LNK',
      DisplayCurrencyIso: input.currency,
      CallBackUrl: this.settings.MYFATOORAH_CALLBACK_URL,
      ErrorUrl: this.settings.MYFATOORAH_ERROR_URL,
      CustomerReference: input.paymentId,
      UserDefinedField: input.orderId,
      Language: 'EN',
    });
    // Write an exact JSON numeric literal; never scale by 100 or pass through float arithmetic.
    const body = `${fields.slice(0, -1)},"InvoiceValue":${new Prisma.Decimal(input.amount).toFixed(3)}}`;
    const parsed = createdInvoice.safeParse(
      await this.request('/v2/SendPayment', body),
    );
    if (!parsed.success) throw providerError('MYFATOORAH_INVALID_RESPONSE');
    const result = parsed.data;
    const url = new URL(result.InvoiceURL);
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'demo.myfatoorah.com' ||
      url.username ||
      url.password ||
      result.CustomerReference !== input.paymentId
    )
      throw providerError('MYFATOORAH_INVALID_RESPONSE');
    return {
      status: 'REQUIRES_ACTION',
      providerPaymentId: result.InvoiceId,
      checkoutUrl: result.InvoiceURL,
      metadata: { apiVersion: 'v2', environment: 'sandbox' },
    };
  }

  async getPaymentStatus(invoiceId: string): Promise<VerifiedProviderPayment> {
    const parsed = invoiceStatus.safeParse(
      await this.request(
        '/v2/GetPaymentStatus',
        JSON.stringify({ Key: invoiceId, KeyType: 'InvoiceId' }),
      ),
    );
    if (!parsed.success || parsed.data.InvoiceId !== invoiceId)
      throw providerError('MYFATOORAH_IDENTITY_MISMATCH');
    const data = parsed.data;
    try {
      validateAmount(data.InvoiceValue, 'KWD');
    } catch {
      throw providerError('MYFATOORAH_AMOUNT_OR_CURRENCY_MISMATCH');
    }
    const display = /^(\d+(?:\.\d+)?)\s+(KD|KWD)$/.exec(
      data.InvoiceDisplayValue,
    );
    if (!display || !new Prisma.Decimal(display[1]!).equals(data.InvoiceValue))
      throw providerError('MYFATOORAH_CURRENCY_MISMATCH');
    const successful = data.InvoiceTransactions.filter(
      (item) => item.TransactionStatus === 'Succss',
    );
    if (
      (data.InvoiceStatus !== 'Paid' && successful.length > 0) ||
      (data.InvoiceStatus === 'Canceled' &&
        data.InvoiceTransactions.some((item) =>
          ['InProgress', 'Authorize'].includes(item.TransactionStatus),
        ))
    ) {
      throw providerError('MYFATOORAH_STATUS_UNVERIFIED');
    }
    if (data.InvoiceStatus === 'Paid' && successful.length !== 1)
      throw providerError('MYFATOORAH_STATUS_UNVERIFIED');
    const selected =
      data.InvoiceStatus === 'Paid'
        ? successful[0]
        : data.InvoiceTransactions.at(-1);
    if (
      selected &&
      (!['KD', 'KWD'].includes(selected.Currency) ||
        (selected.PaidCurrency !== undefined &&
          !['KD', 'KWD'].includes(selected.PaidCurrency)) ||
        (selected.PaidCurrencyValue !== undefined &&
          !new Prisma.Decimal(selected.PaidCurrencyValue).equals(
            data.InvoiceValue,
          )) ||
        !new Prisma.Decimal(selected.TransationValue).equals(data.InvoiceValue))
    )
      throw providerError('MYFATOORAH_AMOUNT_OR_CURRENCY_MISMATCH');
    // A failed attempt on a still-payable invoice is NOT a terminal failure.
    const status =
      data.InvoiceStatus === 'Paid'
        ? 'PAID'
        : data.InvoiceStatus === 'Canceled'
          ? selected?.TransactionStatus === 'Failed'
            ? 'FAILED'
            : 'CANCELLED'
          : selected?.TransactionStatus === 'Authorize'
            ? 'AUTHORIZED'
            : 'PENDING';
    return {
      invoiceId,
      transactionPaymentIds: data.InvoiceTransactions.map(
        (item) => item.PaymentId,
      ),
      customerReference: data.CustomerReference,
      orderReference: data.UserDefinedField,
      amount: data.InvoiceValue,
      currency: 'KWD',
      status,
      ...(selected
        ? {
            transactionId: selected.TransactionId,
            transactionPaymentId: selected.PaymentId,
          }
        : {}),
    };
  }

  async cancelPayment(): Promise<never> {
    throw new AppError(
      'MyFatoorah cancellation requires an operator reconciliation procedure',
      409,
      'PAYMENT_PROVIDER_OPERATION_NOT_SUPPORTED',
    );
  }
  async refundPayment(): Promise<never> {
    throw new AppError(
      'MyFatoorah refunds are outside this integration',
      409,
      'PAYMENT_PROVIDER_OPERATION_NOT_SUPPORTED',
    );
  }

  private async request(path: string, body: string): Promise<unknown> {
    try {
      const response = await this.http(
        `https://apitest.myfatoorah.com${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.settings.MYFATOORAH_API_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body,
          signal: AbortSignal.timeout(this.settings.MYFATOORAH_TIMEOUT_MS),
          redirect: 'error',
        },
      );
      if (response.status === 429)
        throw new ProviderRateLimitError(response.headers.get('Retry-After'));
      if (response.status === 401 || response.status === 403)
        throw providerError('MYFATOORAH_AUTHENTICATION_FAILED');
      if (!response.ok) throw providerError('MYFATOORAH_UNAVAILABLE', 503);
      const reader = response.body?.getReader();
      if (!reader) throw providerError('MYFATOORAH_INVALID_RESPONSE');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            throw providerError('MYFATOORAH_INVALID_RESPONSE');
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const payload: unknown = JSON.parse(
        Buffer.concat(chunks).toString('utf8'),
      );
      const result = envelope.safeParse(payload);
      if (!result.success) throw providerError('MYFATOORAH_INVALID_RESPONSE');
      if (!result.data.IsSuccess) throw providerError('MYFATOORAH_REJECTED');
      return result.data.Data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (
        error instanceof Error &&
        ['TimeoutError', 'AbortError'].includes(error.name)
      )
        throw providerError('MYFATOORAH_TIMEOUT', 503);
      throw providerError('MYFATOORAH_OUTCOME_UNKNOWN', 503);
    }
  }
}
