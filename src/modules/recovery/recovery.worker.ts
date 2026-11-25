import { metrics } from '../../common/observability/metrics.js';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { env } from '../../config/env.js';
import type { WorkerConfiguration } from '../../config/worker-options.js';
import { logger } from '../../common/logger/logger.js';
import { recoverSpecialPaymentAttempts } from '../special-orders/special-order-payments.service.js';
import { RecoveryService } from './recovery.service.js';

export class RecoveryWorker {
  constructor(
    private readonly service = new RecoveryService(),
    private readonly configuration: WorkerConfiguration = env,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    metrics.gauge('commerce_worker_running', 1);
    metrics.gauge('commerce_worker_last_successful_cycle_timestamp_seconds', 0);
    try {
      while (!signal.aborted) {
        try {
          await this.service.repository.enqueue(
            this.configuration.WORKER_SCAN_BATCH,
          );
          if (signal.aborted) break;
          const jobs = await this.service.repository.claim(
            this.configuration.WORKER_CONCURRENCY,
            this.configuration.WORKER_LEASE_MS,
          );
          metrics.increment('commerce_worker_claimed_total', '', jobs.length);
          let successful = true;
          await Promise.all(
            jobs.map(async (job) => {
              const started = performance.now();
              try {
                const outcome = await this.service.process(job);
                const category = [
                  'DONE',
                  'EXPIRED',
                  'RECONCILED',
                  'LOCAL_RECOVERED',
                  'RETRY',
                  'MANUAL',
                  'LEASE_LOST',
                  'AWAITING_DEADLINE',
                ].includes(outcome)
                  ? outcome
                  : 'OTHER';
                metrics.increment(
                  'commerce_worker_jobs_total',
                  `outcome="${category}"`,
                );
                if (outcome === 'EXPIRED')
                  metrics.increment('commerce_reservations_expired_total');
                logger.info(
                  {
                    jobId: job.id,
                    tenantId: job.tenantId,
                    orderId: job.orderId,
                    attempt: job.attempts,
                    outcome,
                  },
                  'Recovery job processed',
                );
              } catch {
                successful = false;
                metrics.increment(
                  'commerce_worker_jobs_total',
                  'outcome="ERROR"',
                );
                // The durable lease survives database/network failures; another claim recovers it.
                logger.error(
                  { jobId: job.id, category: 'RECOVERY_PROCESSING_ERROR' },
                  'Recovery job interrupted',
                );
              } finally {
                metrics.observe(
                  'commerce_worker_processing_duration_seconds',
                  (performance.now() - started) / 1000,
                );
              }
            }),
          );
          if (successful)
            metrics.gauge(
              'commerce_worker_last_successful_cycle_timestamp_seconds',
              Date.now() / 1000,
            );
          try {
            if (!signal.aborted)
              await recoverSpecialPaymentAttempts(
                this.configuration.WORKER_CONCURRENCY,
                signal,
              );
          } catch {
            logger.error(
              { category: 'SPECIAL_PAYMENT_RECOVERY_FAILED' },
              'Special order payment recovery polling failed',
            );
          }
        } catch {
          metrics.increment(
            'commerce_database_connectivity_failures_total',
            'source="worker"',
          );
          logger.error(
            { category: 'RECOVERY_DATABASE_UNAVAILABLE' },
            'Recovery polling failed',
          );
        }
        try {
          await pause(this.configuration.WORKER_POLL_MS, undefined, { signal });
        } catch {
          if (!signal.aborted) throw new Error('Worker polling interrupted');
        }
      }
    } finally {
      metrics.gauge('commerce_worker_running', 0);
    }
  }
}
