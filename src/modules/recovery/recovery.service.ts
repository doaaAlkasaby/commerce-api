import { isFinanciallyCommitted } from '../../common/domain/status-transitions.js';
import { AppError } from '../../common/errors/app-error.js';
import { validateAmount } from '../../common/pricing/money.js';
import type { RecoveryJob } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import type { WorkerConfiguration } from '../../config/worker-options.js';
import { OrderService } from '../orders/order.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { PaymentVerificationService } from '../payments/payment-verification.service.js';
import { ProviderRateLimitError } from '../payments/providers/provider-retry.js';
import { RecoveryRepository } from './recovery.repository.js';

const permanent = new Set([
  'PAYMENT_RECONCILIATION_REQUIRED',
  'PAYMENT_ORDER_MISMATCH',
  'WORKER_PAYMENT_REFERENCE_MISSING',
  'PAYMENT_PROVIDER_NOT_CONFIGURED',
  'MYFATOORAH_AUTHENTICATION_FAILED',
  'MYFATOORAH_REJECTED',
  'MYFATOORAH_INVALID_RESPONSE',
  'MYFATOORAH_INVOICE_UNKNOWN',
  'MYFATOORAH_IDENTITY_MISMATCH',
  'MYFATOORAH_CURRENCY_MISMATCH',
  'MYFATOORAH_AMOUNT_MISMATCH',
  'MYFATOORAH_AMOUNT_OR_CURRENCY_MISMATCH',
  'MYFATOORAH_STATUS_UNVERIFIED',
  'INVALID_PAYMENT_STATUS_TRANSITION',
  'ORDER_INVENTORY_RESERVATION_RELEASED',
  'INVALID_MONETARY_PRECISION',
  'INVALID_MONETARY_AMOUNT',
  'MONETARY_AMOUNT_OUT_OF_RANGE',
  'INVALID_CURRENCY',
  'WORKER_LOCAL_STATE_CONFLICT',
]);
function failure(code: string): AppError {
  return new AppError('Recovery requires review', 409, code);
}

export class RecoveryService {
  constructor(
    readonly repository = new RecoveryRepository(),
    private readonly configuration: WorkerConfiguration = env,
    private readonly verification = new PaymentVerificationService(),
    private readonly payments = new PaymentService(),
    private readonly orders = new OrderService(),
    private readonly random: () => number = Math.random,
  ) {}

  async process(job: RecoveryJob): Promise<string> {
    try {
      const { order, now } = await this.repository.inspect(job);
      if (order.payments.length !== 1)
        throw failure('WORKER_LOCAL_STATE_CONFLICT');
      const payment = order.payments[0]!;
      if (payment.reconciliationRequired)
        throw failure('PAYMENT_RECONCILIATION_REQUIRED');
      validateAmount(payment.amount.toString(), payment.currency);
      if (
        !payment.amount.equals(order.totalAmount) ||
        payment.currency !== order.currency ||
        payment.status !== order.paymentStatus
      )
        throw failure('PAYMENT_ORDER_MISMATCH');
      if (isFinanciallyCommitted(payment.status)) {
        await this.repository.finish(job, 'DONE');
        return 'DONE';
      }
      if (
        (['FAILED', 'CANCELLED'].includes(payment.status) ||
          order.status === 'CANCELLED') &&
        (payment.provider === 'NONE' ||
          (payment.initiationState === 'NOT_STARTED' &&
            !payment.providerPaymentId))
      ) {
        // The existing lifecycle already owns release. Never release again here.
        await this.repository.finish(job, 'DONE');
        return 'DONE';
      }
      if (payment.initiationState === 'IN_PROGRESS') {
        if (
          payment.updatedAt.getTime() >
          now.getTime() - this.configuration.WORKER_INITIATION_GRACE_MS
        )
          return this.retry(job, 'INITIATION_ACTIVE');
        await this.repository.markUnknown(
          job,
          payment.id,
          this.configuration.WORKER_INITIATION_GRACE_MS,
        );
        return this.process(job);
      }
      const safeToExpire =
        payment.provider === 'NONE' ||
        (payment.provider === 'MYFATOORAH' &&
          payment.initiationState === 'NOT_STARTED' &&
          !payment.providerPaymentId);
      if (
        order.status === 'PENDING' &&
        order.reservationExpiresAt &&
        order.reservationExpiresAt <= now &&
        safeToExpire &&
        !['PAID', 'AUTHORIZED'].includes(payment.status)
      ) {
        await this.repository.locked(job, async (tx) => {
          const current = await tx.order.findFirstOrThrow({
            where: { id: job.orderId, tenantId: job.tenantId },
            include: { payments: true },
          });
          const [clock] = await tx.$queryRaw<
            Array<{ now: Date }>
          >`SELECT clock_timestamp() AS now`;
          const p = current.payments[0];
          if (
            !clock ||
            !current.reservationExpiresAt ||
            current.reservationExpiresAt > clock.now ||
            current.payments.length !== 1 ||
            !p ||
            p.reconciliationRequired ||
            p.initiationState === 'IN_PROGRESS' ||
            p.status === 'AUTHORIZED' ||
            isFinanciallyCommitted(p.status) ||
            !(
              p.provider === 'NONE' ||
              (p.provider === 'MYFATOORAH' &&
                p.initiationState === 'NOT_STARTED' &&
                !p.providerPaymentId)
            )
          )
            throw failure('WORKER_STATE_CHANGED');
          await this.orders.applyStatusWithClient(
            job.tenantId,
            job.orderId,
            'CANCELLED',
            tx,
            true,
          );
        });
        await this.repository.finish(job, 'DONE');
        return 'EXPIRED';
      }
      if (job.attempts > this.configuration.WORKER_MAX_ATTEMPTS)
        return this.manual(job, 'RETRY_EXHAUSTED');
      if (payment.provider === 'MYFATOORAH') {
        if (!payment.providerPaymentId) {
          if (
            payment.initiationState === 'NOT_STARTED' &&
            order.reservationExpiresAt
          )
            return this.waitDeadline(job);
          const recorded = new Set([
            'INITIATION_REJECTED',
            'INITIATION_TIMEOUT',
            'INITIATION_AUTHENTICATION_FAILED',
            'INITIATION_INVALID_RESPONSE',
            'INITIATION_UNKNOWN',
          ]);
          return this.manual(
            job,
            job.lastErrorCode && recorded.has(job.lastErrorCode)
              ? job.lastErrorCode
              : 'WORKER_PAYMENT_REFERENCE_MISSING',
          );
        }
        const verified = await this.verification.verifyForRecovery(
          job.tenantId,
          order.userId,
          payment.id,
          (tx) => this.repository.guard(tx, job),
        );
        if (
          ['PAID', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(
            verified.providerStatus,
          )
        ) {
          await this.repository.finish(job, 'DONE');
          return 'RECONCILED';
        }
        return this.retry(job, 'PROVIDER_PENDING');
      }
      if (payment.provider === 'NONE') {
        if (payment.initiationState === 'UNKNOWN')
          await this.payments.initiatePayment(
            job.tenantId,
            order.userId,
            payment.id,
            (tx) => this.repository.guard(tx, job),
          );
        if (order.reservationExpiresAt && payment.status !== 'AUTHORIZED')
          return this.waitDeadline(job);
        await this.repository.finish(job, 'DONE');
        return 'LOCAL_RECOVERED';
      }
      throw failure('PAYMENT_PROVIDER_NOT_CONFIGURED');
    } catch (error) {
      if (error instanceof AppError && error.code === 'WORKER_LEASE_LOST')
        return 'LEASE_LOST';
      if (error instanceof AppError && permanent.has(error.code))
        return this.manual(job, error.code);
      if (error instanceof ProviderRateLimitError)
        return error.retryAfterMs > 86400000
          ? this.manual(job, 'PROVIDER_RATE_LIMIT_REQUIRES_REVIEW')
          : this.retry(job, 'PROVIDER_RATE_LIMITED', error.retryAfterMs);
      const category =
        error instanceof AppError && error.code === 'MYFATOORAH_TIMEOUT'
          ? 'PROVIDER_TIMEOUT'
          : error instanceof AppError &&
              ['MYFATOORAH_UNAVAILABLE', 'MYFATOORAH_OUTCOME_UNKNOWN'].includes(
                error.code,
              )
            ? 'PROVIDER_UNAVAILABLE'
            : 'RECOVERY_TRANSIENT_ERROR';
      return this.retry(job, category);
    }
  }

  private waitDeadline(job: RecoveryJob) {
    return this.repository
      .finish(job, 'READY', 'AWAITING_DEADLINE', 0, true)
      .then(() => 'AWAITING_DEADLINE');
  }
  private async manual(job: RecoveryJob, category: string): Promise<string> {
    try {
      await this.repository.finish(job, 'MANUAL', category);
      return 'MANUAL';
    } catch (error) {
      if (error instanceof AppError && error.code === 'WORKER_LEASE_LOST')
        return 'LEASE_LOST';
      throw error;
    }
  }
  private async retry(
    job: RecoveryJob,
    category: string,
    minimumDelay = 0,
  ): Promise<string> {
    if (job.attempts >= this.configuration.WORKER_MAX_ATTEMPTS)
      return this.manual(
        job,
        category === 'PROVIDER_PENDING'
          ? 'PROVIDER_PENDING_EXHAUSTED'
          : 'RETRY_EXHAUSTED',
      );
    const backoff = Math.min(
      this.configuration.WORKER_RETRY_MAX_MS,
      this.configuration.WORKER_RETRY_BASE_MS *
        2 ** Math.min(job.attempts - 1, 30),
    );
    const delay = Math.max(
      minimumDelay,
      Math.floor(backoff * (0.5 + this.random() * 0.5)),
    );
    try {
      await this.repository.finish(job, 'READY', category, delay);
      return 'RETRY';
    } catch (error) {
      if (error instanceof AppError && error.code === 'WORKER_LEASE_LOST')
        return 'LEASE_LOST';
      throw error;
    }
  }
}
