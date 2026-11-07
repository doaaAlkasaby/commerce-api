import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';

const digits = z.string().regex(/^\d{1,64}$/);
const webhook = z.object({
  Event: z.object({
    Code: z.literal(1),
    Name: z.literal('PAYMENT_STATUS_CHANGED'),
    CountryIsoCode: z.literal('KWT'),
    Reference: z.string().min(1).max(255),
  }),
  Data: z.object({
    Invoice: z.object({
      Id: digits,
      Status: z.enum(['PAID', 'PENDING']),
      ExternalIdentifier: z.string().max(500).nullable().optional(),
    }),
    Transaction: z.object({
      Status: z.enum(['SUCCESS', 'FAILED', 'AUTHORIZE', 'CANCELED']),
      PaymentId: digits,
    }),
  }),
});
export function verifyMyFatoorahWebhook(
  payload: unknown,
  signature: string | undefined,
  secret: string,
) {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature))
    throw new AppError(
      'Invalid MyFatoorah signature',
      401,
      'MYFATOORAH_SIGNATURE_INVALID',
    );
  const parsed = webhook.safeParse(payload);
  if (!parsed.success)
    throw new AppError(
      'Invalid MyFatoorah payment event',
      400,
      'MYFATOORAH_WEBHOOK_INVALID',
    );
  const { Invoice, Transaction } = parsed.data.Data;
  // Exact ordered PAYMENT_STATUS_CHANGED Webhook V2 fields, UTF-8, null -> empty.
  const canonical = `Invoice.Id=${Invoice.Id},Invoice.Status=${Invoice.Status},Transaction.Status=${Transaction.Status},Transaction.PaymentId=${Transaction.PaymentId},Invoice.ExternalIdentifier=${Invoice.ExternalIdentifier ?? ''}`;
  const expected = createHmac('sha256', secret)
    .update(canonical, 'utf8')
    .digest();
  const received = Buffer.from(signature, 'base64');
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new AppError(
      'Invalid MyFatoorah signature',
      401,
      'MYFATOORAH_SIGNATURE_INVALID',
    );
  return {
    eventReference: parsed.data.Event.Reference,
    canonicalHash: createHash('sha256').update(canonical).digest('hex'),
    invoiceId: Invoice.Id,
    transactionPaymentId: Transaction.PaymentId,
  };
}
export type MyFatoorahEvent = ReturnType<typeof verifyMyFatoorahWebhook>;
