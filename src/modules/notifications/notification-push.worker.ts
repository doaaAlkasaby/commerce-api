import { setTimeout as pause } from 'node:timers/promises';
import {
  type ClaimedPushJob,
  NotificationPushRepository,
  notificationPushRepository as defaultPushRepo,
} from './notification-push.repository.js';
import {
  FirebaseAdminService,
  firebaseAdminService as defaultFirebaseService,
} from '../../common/services/firebase-admin.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../common/logger/logger.js';

export class NotificationPushWorker {
  constructor(
    private readonly pushRepo: NotificationPushRepository = defaultPushRepo,
    private readonly firebaseService: FirebaseAdminService = defaultFirebaseService,
  ) {}

  async processBatch(): Promise<number> {
    const jobs = await this.pushRepo.claimJobs(
      env.NOTIFICATION_WORKER_CONCURRENCY,
      env.NOTIFICATION_WORKER_LEASE_MS,
    );

    if (!jobs.length) {
      return 0;
    }

    for (const job of jobs) {
      await this.processSingleJob(job);
    }

    return jobs.length;
  }

  private async processSingleJob(job: ClaimedPushJob): Promise<void> {
    const { id: jobId, claimToken, attempts, deliveredTokens = [], notification } = job;

    try {
      const allActiveTokens = await this.pushRepo.findActiveUserTokens(
        notification.userId,
      );

      const pendingTokens = allActiveTokens.filter(
        (t) => !deliveredTokens.includes(t),
      );

      if (!pendingTokens.length) {
        logger.info(
          {
            category: 'PUSH_WORKER',
            jobId,
            userId: notification.userId,
            deliveredTokenCount: deliveredTokens.length,
          },
          'No pending undelivered active devices found for customer. Completing push job.',
        );
        await this.pushRepo.completeJob(jobId, claimToken);
        return;
      }

      const rawData = (notification.data as Record<string, unknown>) ?? {};
      const payloadData: Record<string, string> = {
        notificationId: notification.id,
        eventType: String(rawData.eventType ?? 'ORDER_PLACED'),
        ...(rawData.orderId ? { orderId: String(rawData.orderId) } : {}),
        ...(rawData.orderNumber
          ? { orderNumber: String(rawData.orderNumber) }
          : {}),
        ...(rawData.refundId ? { refundId: String(rawData.refundId) } : {}),
        ...(rawData.tenantSlug ? { tenantSlug: String(rawData.tenantSlug) } : {}),
        title: notification.title,
        body: notification.body,
      };

      const result = await this.firebaseService.sendMulticastNotification({
        tokens: pendingTokens,
        title: notification.title,
        body: notification.body,
        data: payloadData,
      });

      if (result.successfulTokens.length) {
        await this.pushRepo.recordDeliveredTokens(
          jobId,
          result.successfulTokens,
        );
      }

      if (result.invalidTokens.length) {
        logger.info(
          {
            category: 'PUSH_WORKER',
            jobId,
            invalidTokenCount: result.invalidTokens.length,
          },
          'Deactivating invalid FCM tokens',
        );
        await this.pushRepo.deactivateTokens(result.invalidTokens);
      }

      const transientFailures =
        result.failureCount - result.invalidTokens.length;

      if (transientFailures > 0 && attempts < env.NOTIFICATION_WORKER_MAX_RETRIES) {
        const backoffMs = Math.min(
          1000 * Math.pow(2, attempts - 1),
          30000,
        );
        logger.warn(
          {
            category: 'PUSH_WORKER_PARTIAL_RETRY',
            jobId,
            attempts,
            transientFailures,
            backoffMs,
          },
          'Partial FCM delivery failure with remaining transient device errors. Scheduling retry.',
        );
        await this.pushRepo.retryJob(
          jobId,
          claimToken,
          'PARTIAL_FCM_DELIVERY_FAILURE',
          backoffMs,
        );
        return;
      }

      logger.info(
        {
          category: 'PUSH_WORKER_SUCCESS',
          jobId,
          successCount: result.successCount,
          failureCount: result.failureCount,
          isDryRun: result.isDryRun,
        },
        'Successfully processed notification push job',
      );

      await this.pushRepo.completeJob(jobId, claimToken);
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message : 'PUSH_DISPATCH_FAILED';

      if (errorCode === 'Firebase credentials unconfigured') {
        const unconfigBackoffMs = 10 * 60 * 1000; // 10 minutes
        logger.warn(
          {
            category: 'PUSH_WORKER_UNCONFIGURED_POSTPONE',
            jobId,
            backoffMs: unconfigBackoffMs,
          },
          'Postponing push job while Firebase credentials remain unconfigured',
        );
        await this.pushRepo.postponeUnconfiguredJob(
          jobId,
          claimToken,
          unconfigBackoffMs,
        );
        return;
      }

      if (attempts >= env.NOTIFICATION_WORKER_MAX_RETRIES) {
        logger.error(
          {
            category: 'PUSH_WORKER_TERMINAL_FAILURE',
            jobId,
            attempts,
            error,
          },
          'Push notification job failed terminal retries',
        );
        await this.pushRepo.markJobFailed(jobId, claimToken, errorCode);
      } else {
        const backoffMs = Math.min(
          1000 * Math.pow(2, attempts - 1),
          30000,
        );
        logger.warn(
          {
            category: 'PUSH_WORKER_RETRY',
            jobId,
            attempts,
            backoffMs,
            error,
          },
          'Transient error during push dispatch. Scheduling job retry.',
        );
        await this.pushRepo.retryJob(jobId, claimToken, errorCode, backoffMs);
      }
    }
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    try {
      await pause(ms, undefined, { signal });
    } catch (error) {
      if (
        signal.aborted &&
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        return;
      }
      throw error;
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    logger.info(
      { category: 'PUSH_WORKER_START' },
      'NotificationPushWorker loop started',
    );

    while (!signal.aborted) {
      try {
        const processed = await this.processBatch();
        if (processed === 0 && !signal.aborted) {
          await this.sleep(2000, signal);
        }
      } catch (error) {
        if (signal.aborted) break;
        logger.error(
          { category: 'PUSH_WORKER_LOOP_ERROR', error },
          'Error in NotificationPushWorker main loop',
        );
        await this.sleep(3000, signal);
      }
    }

    logger.info(
      { category: 'PUSH_WORKER_STOP' },
      'NotificationPushWorker loop stopped',
    );
  }
}

export const notificationPushWorker = new NotificationPushWorker();
