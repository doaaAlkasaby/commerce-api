import { logger } from '../../common/logger/logger.js';
import {
  metrics,
  observePayment,
  classifyFailure,
} from '../../common/observability/metrics.js';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { PaymentStatus, Prisma } from '../../generated/prisma/client.js';
import type {
  Payment,
  MyFatoorahWebhookEvent,
} from '../../generated/prisma/client.js';
import { PaymentRepository } from './payment.repository.js';
import { PaymentService } from './payment.service.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';
import {
  verifyMyFatoorahWebhook,
  type MyFatoorahEvent,
} from './myfatoorah.webhook.js';
import type { VerifiedProviderPayment } from './payment.types.js';

type OwnedPayment = NonNullable<
  Awaited<ReturnType<PaymentRepository['findForUser']>>
>;
function conflict(
  code: string,
  message = 'Provider payment requires reconciliation',
) {
  return new AppError(message, 409, code);
}

export class PaymentVerificationService {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly lifecycle = new PaymentService(),
    private readonly providers = new PaymentProviderRegistry(),
  ) {}

  async verifyForUser(
    tenantId: string,
    userId: string,
    paymentId: string,
  ): Promise<Payment> {
    const payment = await this.repository.findForUser(
      tenantId,
      userId,
      paymentId,
    );
    if (!payment)
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    if (payment.provider !== 'MYFATOORAH' || !payment.providerPaymentId)
      throw conflict('PAYMENT_RECONCILIATION_REQUIRED');
    const verified = await this.fetchStatus(payment.providerPaymentId, payment);
    return this.applyVerified(payment, verified);
  }

  async verifyForRecovery(
    tenantId: string,
    userId: string,
    paymentId: string,
    guard: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<{
    payment: Payment;
    providerStatus: VerifiedProviderPayment['status'];
  }> {
    const payment = await this.repository.findForUser(
      tenantId,
      userId,
      paymentId,
    );
    if (
      !payment ||
      payment.provider !== 'MYFATOORAH' ||
      !payment.providerPaymentId
    )
      throw conflict('PAYMENT_RECONCILIATION_REQUIRED');
    const verified = await this.fetchStatus(
      payment.providerPaymentId,
      payment,
      guard,
    );
    return {
      payment: await this.applyVerified(payment, verified, undefined, guard),
      providerStatus: verified.status,
    };
  }

  async processWebhook(payload: unknown, signature: string | undefined) {
    return observePayment('webhook', () =>
      this.processWebhookObserved(payload, signature),
    );
  }
  private async processWebhookObserved(
    payload: unknown,
    signature: string | undefined,
  ) {
    if (env.PAYMENT_PROVIDER !== 'MYFATOORAH' || !env.MYFATOORAH_WEBHOOK_SECRET)
      throw new AppError(
        'MyFatoorah webhook is not configured',
        503,
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
      );
    const event = verifyMyFatoorahWebhook(
      payload,
      signature,
      env.MYFATOORAH_WEBHOOK_SECRET,
    );
    const existing = await this.repository.findWebhookEvent(
      event.eventReference,
      event.canonicalHash,
    );
    if (existing) return this.acknowledge(existing, event);
    const mapping = await this.repository.findMyFatoorahInvoice(
      event.invoiceId,
    );
    // Network IO happens before any order lock/transaction, even for webhook recovery.
    const verified = await this.fetchStatus(event.invoiceId, mapping?.payment);
    const payment =
      mapping?.payment ??
      (await this.repository.findMyFatoorahCustomerReference(
        verified.customerReference,
      ));
    if (!payment)
      throw new AppError(
        'Unknown MyFatoorah invoice',
        404,
        'MYFATOORAH_INVOICE_UNKNOWN',
      );
    if (!verified.transactionPaymentIds.includes(event.transactionPaymentId))
      throw conflict('MYFATOORAH_IDENTITY_MISMATCH');
    try {
      await this.applyVerified(payment, verified, event);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) {
        // applyVerified rolled back first. Persist an audit flag in a fresh transaction.
        const recorded = await prisma.$transaction(async (tx) => {
          await this.repository.lockOrderForUser(
            tx,
            payment.order.tenantId,
            payment.order.userId,
            payment.id,
          );
          const previous = await this.repository.findWebhookEvent(
            event.eventReference,
            event.canonicalHash,
            tx,
          );
          if (previous) {
            this.acknowledge(previous, event);
            return previous;
          }
          await this.repository.flagReconciliation(
            tx,
            payment.order.tenantId,
            payment.id,
            error.code,
          );
          return this.repository.recordWebhookEvent(tx, {
            ...event,
            paymentId: payment.id,
            state: 'RECONCILIATION_REQUIRED',
            reason: error.code,
          });
        });
        return this.acknowledge(recorded, event);
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const previous = await this.repository.findWebhookEvent(
          event.eventReference,
          event.canonicalHash,
        );
        if (previous) return this.acknowledge(previous, event);
        throw conflict('MYFATOORAH_REFERENCE_CONFLICT');
      }
      throw error;
    }
    metrics.payment('webhook', 'success');
    return { received: true, reconciliationRequired: false };
  }

  private async fetchStatus(
    invoiceId: string,
    payment?: OwnedPayment,
    guard?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const adapter = this.providers.getProvider('MYFATOORAH');
    const getPaymentStatus = adapter.getPaymentStatus?.bind(adapter);
    if (!getPaymentStatus) throw conflict('PAYMENT_VERIFICATION_UNAVAILABLE');
    try {
      return await observePayment('reconciliation', () =>
        getPaymentStatus(invoiceId),
      );
    } catch (error) {
      if (
        payment &&
        error instanceof AppError &&
        [
          'MYFATOORAH_STATUS_UNVERIFIED',
          'MYFATOORAH_AMOUNT_OR_CURRENCY_MISMATCH',
          'MYFATOORAH_CURRENCY_MISMATCH',
          'MYFATOORAH_IDENTITY_MISMATCH',
        ].includes(error.code)
      ) {
        await prisma.$transaction(async (tx) => {
          await this.repository.lockOrderForUser(
            tx,
            payment.order.tenantId,
            payment.order.userId,
            payment.id,
          );
          await guard?.(tx);
          await this.repository.flagReconciliation(
            tx,
            payment.order.tenantId,
            payment.id,
            error.code,
          );
        });
      }
      throw error;
    }
  }

  private validateIdentity(
    payment: OwnedPayment,
    verified: VerifiedProviderPayment,
  ) {
    if (
      payment.provider !== 'MYFATOORAH' ||
      verified.customerReference !== payment.id ||
      verified.orderReference !== payment.orderId ||
      (payment.providerPaymentId &&
        verified.invoiceId !== payment.providerPaymentId)
    )
      throw conflict('MYFATOORAH_IDENTITY_MISMATCH');
    if (
      verified.currency !== payment.currency ||
      payment.currency !== payment.order.currency
    )
      throw conflict('MYFATOORAH_CURRENCY_MISMATCH');
    if (
      !new Prisma.Decimal(verified.amount).equals(payment.amount) ||
      !payment.amount.equals(payment.order.totalAmount)
    )
      throw conflict('MYFATOORAH_AMOUNT_MISMATCH');
  }

  private async applyVerified(
    payment: OwnedPayment,
    verified: VerifiedProviderPayment,
    event?: MyFatoorahEvent,
    guard?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<Payment> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const tenantId = payment.order.tenantId;
        await this.repository.lockOrderForUser(
          tx,
          tenantId,
          payment.order.userId,
          payment.id,
        );
        await guard?.(tx);
        const current = await this.repository.findForUser(
          tenantId,
          payment.order.userId,
          payment.id,
          tx,
        );
        if (!current)
          throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
        this.validateIdentity(current, verified);
        if (event) {
          const existing = await this.repository.findWebhookEvent(
            event.eventReference,
            event.canonicalHash,
            tx,
          );
          if (existing) {
            this.acknowledge(existing, event);
            return current;
          }
        }
        await this.repository.bindMyFatoorahInvoice(
          tx,
          tenantId,
          payment.id,
          verified.invoiceId,
        );
        if (!current.providerPaymentId)
          await this.repository.setMyFatoorahInvoiceId(
            tx,
            tenantId,
            current.id,
            verified.invoiceId,
          );
        // A verified late PAID observation on a payment that has already entered
        // the refund lifecycle must NOT attempt to regress aggregate status to
        // PAID or falsely flag reconciliationRequired. Preserve current status,
        // provider IDs, PaymentRefund rows, and any existing reconciliation flag.
        const isPostCaptureRefundStatus =
          current.status === PaymentStatus.REFUND_PENDING ||
          current.status === PaymentStatus.PARTIALLY_REFUNDED ||
          current.status === PaymentStatus.REFUNDED;
        if (isPostCaptureRefundStatus && verified.status === PaymentStatus.PAID) {
          if (
            current.providerTransactionId &&
            verified.transactionId &&
            current.providerTransactionId !== verified.transactionId
          ) {
            throw conflict('MYFATOORAH_IDENTITY_MISMATCH');
          }
          const observed =
            current.initiationState === 'INITIATED'
              ? current
              : await this.repository.setInitiationState(
                  tx,
                  tenantId,
                  payment.order.userId,
                  payment.id,
                  'INITIATED',
                );
          if (event) {
            await this.repository.recordWebhookEvent(tx, {
              ...event,
              paymentId: payment.id,
              state: 'PROCESSED',
            });
          }
          return observed;
        }
        // Pending is an observation, never a request to resurrect a terminal state.
        if (verified.status !== 'PENDING') {
          await this.lifecycle.applyPaymentStatusWithClient(
            tenantId,
            payment.id,
            {
              status: verified.status,
              providerPaymentId: verified.invoiceId,
              ...(verified.transactionId
                ? { providerTransactionId: verified.transactionId }
                : {}),
            },
            tx,
            {
              transition: {
                kind: 'PROVIDER_VERIFICATION',
                provider: current.provider,
                providerPaymentId: verified.invoiceId,
              },
            },
          );
        }
        const updated = await this.repository.setInitiationState(
          tx,
          tenantId,
          payment.order.userId,
          payment.id,
          'INITIATED',
        );
        if (event)
          await this.repository.recordWebhookEvent(tx, {
            ...event,
            paymentId: payment.id,
            state: 'PROCESSED',
          });
        return updated;
      });
      logger.info(
        {
          operation: 'reconciliation',
          tenantId: payment.order.tenantId,
          paymentId: payment.id,
          outcome: verified.status,
        },
        'Verified payment observed',
      );
      const outcome = verified.status.toLowerCase();
      if (
        outcome === 'paid' ||
        outcome === 'failed' ||
        outcome === 'pending' ||
        outcome === 'cancelled' ||
        outcome === 'refunded' ||
        outcome === 'authorized'
      )
        metrics.payment('reconciliation', outcome);
      return result;
    } catch (error) {
      if (!event && error instanceof AppError && error.statusCode === 409) {
        await prisma.$transaction(async (tx) => {
          await this.repository.lockOrderForUser(
            tx,
            payment.order.tenantId,
            payment.order.userId,
            payment.id,
          );
          await guard?.(tx);
          await this.repository.flagReconciliation(
            tx,
            payment.order.tenantId,
            payment.id,
            error.code,
          );
        });
      }
      metrics.payment('reconciliation', classifyFailure(error));
      throw error;
    }
  }

  private acknowledge(
    existing: MyFatoorahWebhookEvent,
    event: MyFatoorahEvent,
  ) {
    if (
      existing.canonicalHash !== event.canonicalHash ||
      existing.invoiceId !== event.invoiceId
    )
      throw conflict('MYFATOORAH_EVENT_REFERENCE_CONFLICT');
    metrics.payment('webhook', 'duplicate');
    if (existing.state === 'RECONCILIATION_REQUIRED')
      metrics.payment('webhook', 'conflict');
    return {
      received: true,
      reconciliationRequired: existing.state === 'RECONCILIATION_REQUIRED',
    };
  }
}
export const paymentVerificationService = new PaymentVerificationService();
