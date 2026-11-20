import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationPushWorker } from './notification-push.worker.js';
import { EXPECTED_FIREBASE_PROJECT_ID } from '../../common/services/firebase-admin.service.js';

describe('NotificationPushWorker', () => {
  let mockPushRepo: any;
  let mockFirebaseService: any;
  let worker: NotificationPushWorker;

  beforeEach(() => {
    mockPushRepo = {
      claimJobs: vi.fn(),
      completeJob: vi.fn(),
      retryJob: vi.fn(),
      postponeUnconfiguredJob: vi.fn(),
      recordDeliveredTokens: vi.fn(),
      markJobFailed: vi.fn(),
      findActiveUserTokens: vi.fn(),
      deactivateTokens: vi.fn(),
    };

    mockFirebaseService = {
      sendMulticastNotification: vi.fn(),
    };

    worker = new NotificationPushWorker(mockPushRepo, mockFirebaseService);
  });

  it('1. Successfully processes job and sends FCM multicast notification', async () => {
    const job = {
      id: 'job-101',
      claimToken: 'token-abc',
      attempts: 1,
      deliveredTokens: [],
      notification: {
        id: 'notif-1',
        tenantId: 'tenant-1',
        userId: 'user-123',
        type: 'ORDER',
        title: 'Order Placed: #1001',
        body: 'Your order #1001 has been placed successfully.',
        data: {
          eventType: 'ORDER_PLACED',
          orderId: 'order-999',
          orderNumber: '1001',
          tenantSlug: 'kuwait-fashion',
        },
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue(['fcm-token-android-1']);
    mockFirebaseService.sendMulticastNotification.mockResolvedValue({
      isDryRun: false,
      successCount: 1,
      failureCount: 0,
      invalidTokens: [],
      successfulTokens: ['fcm-token-android-1'],
    });

    const processed = await worker.processBatch();

    expect(processed).toBe(1);
    expect(mockPushRepo.findActiveUserTokens).toHaveBeenCalledWith('user-123');
    expect(mockFirebaseService.sendMulticastNotification).toHaveBeenCalledWith({
      tokens: ['fcm-token-android-1'],
      title: 'Order Placed: #1001',
      body: 'Your order #1001 has been placed successfully.',
      data: {
        notificationId: 'notif-1',
        eventType: 'ORDER_PLACED',
        orderId: 'order-999',
        orderNumber: '1001',
        tenantSlug: 'kuwait-fashion',
        title: 'Order Placed: #1001',
        body: 'Your order #1001 has been placed successfully.',
      },
    });
    expect(mockPushRepo.recordDeliveredTokens).toHaveBeenCalledWith('job-101', [
      'fcm-token-android-1',
    ]);
    expect(mockPushRepo.completeJob).toHaveBeenCalledWith('job-101', 'token-abc');
  });

  it('2. Automatically deactivates invalid or unregistered FCM tokens', async () => {
    const job = {
      id: 'job-102',
      claimToken: 'token-def',
      attempts: 1,
      deliveredTokens: [],
      notification: {
        id: 'notif-2',
        userId: 'user-456',
        title: 'Order Shipped',
        body: 'Your order is on its way.',
        data: { eventType: 'ORDER_SHIPPED' },
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue([
      'valid-fcm-token',
      'invalid-stale-fcm-token',
    ]);
    mockFirebaseService.sendMulticastNotification.mockResolvedValue({
      isDryRun: false,
      successCount: 1,
      failureCount: 1,
      invalidTokens: ['invalid-stale-fcm-token'],
      successfulTokens: ['valid-fcm-token'],
    });

    await worker.processBatch();

    expect(mockPushRepo.deactivateTokens).toHaveBeenCalledWith(['invalid-stale-fcm-token']);
    expect(mockPushRepo.recordDeliveredTokens).toHaveBeenCalledWith('job-102', ['valid-fcm-token']);
    expect(mockPushRepo.completeJob).toHaveBeenCalledWith('job-102', 'token-def');
  });

  it('3. Schedules retry on transient Firebase network failure', async () => {
    const job = {
      id: 'job-103',
      claimToken: 'token-ghi',
      attempts: 2,
      deliveredTokens: [],
      notification: {
        id: 'notif-3',
        userId: 'user-789',
        title: 'Order Placed',
        body: 'Order created',
        data: {},
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue(['fcm-token-1']);
    mockFirebaseService.sendMulticastNotification.mockRejectedValue(
      new Error('FCM server connection timeout'),
    );

    await worker.processBatch();

    expect(mockPushRepo.retryJob).toHaveBeenCalledWith(
      'job-103',
      'token-ghi',
      'FCM server connection timeout',
      2000,
    );
  });

  it('4. Marks job FAILED when retries reach max attempts limit', async () => {
    const job = {
      id: 'job-104',
      claimToken: 'token-jkl',
      attempts: 5,
      deliveredTokens: [],
      notification: {
        id: 'notif-4',
        userId: 'user-789',
        title: 'Order Placed',
        body: 'Order created',
        data: {},
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue(['fcm-token-1']);
    mockFirebaseService.sendMulticastNotification.mockRejectedValue(
      new Error('Persistent internal error'),
    );

    await worker.processBatch();

    expect(mockPushRepo.markJobFailed).toHaveBeenCalledWith(
      'job-104',
      'token-jkl',
      'Persistent internal error',
    );
  });

  it('5. Operates in Dry-Run mode gracefully when Firebase credentials are missing in test mode', async () => {
    const job = {
      id: 'job-105',
      claimToken: 'token-mno',
      attempts: 1,
      deliveredTokens: [],
      notification: {
        id: 'notif-5',
        userId: 'user-000',
        title: 'Order Placed',
        body: 'Order created',
        data: {},
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue(['token-1']);
    mockFirebaseService.sendMulticastNotification.mockResolvedValue({
      isDryRun: true,
      successCount: 1,
      failureCount: 0,
      invalidTokens: [],
      successfulTokens: ['token-1'],
    });

    await worker.processBatch();

    expect(mockPushRepo.completeJob).toHaveBeenCalledWith('job-105', 'token-mno');
  });

  it('6. Completes job cleanly if customer has no active devices registered', async () => {
    const job = {
      id: 'job-106',
      claimToken: 'token-pqr',
      attempts: 1,
      deliveredTokens: [],
      notification: {
        id: 'notif-6',
        userId: 'user-no-device',
        title: 'Order Placed',
        body: 'Order created',
        data: {},
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue([]);

    await worker.processBatch();

    expect(mockFirebaseService.sendMulticastNotification).not.toHaveBeenCalled();
    expect(mockPushRepo.completeJob).toHaveBeenCalledWith('job-106', 'token-pqr');
  });

  it('7. Reschedules retry when partial FCM delivery has remaining transient device errors', async () => {
    const job = {
      id: 'job-107',
      claimToken: 'token-partial',
      attempts: 1,
      deliveredTokens: [],
      notification: {
        id: 'notif-7',
        userId: 'user-multi-device',
        title: 'Order Placed',
        body: 'Order created',
        data: {},
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue([
      'dev-1-success',
      'dev-2-invalid',
      'dev-3-transient-fail',
    ]);
    mockFirebaseService.sendMulticastNotification.mockResolvedValue({
      isDryRun: false,
      successCount: 1,
      failureCount: 2,
      invalidTokens: ['dev-2-invalid'],
      successfulTokens: ['dev-1-success'],
    });

    await worker.processBatch();

    expect(mockPushRepo.recordDeliveredTokens).toHaveBeenCalledWith('job-107', [
      'dev-1-success',
    ]);
    expect(mockPushRepo.deactivateTokens).toHaveBeenCalledWith(['dev-2-invalid']);
    expect(mockPushRepo.retryJob).toHaveBeenCalledWith(
      'job-107',
      'token-partial',
      'PARTIAL_FCM_DELIVERY_FAILURE',
      1000,
    );
    expect(mockPushRepo.completeJob).not.toHaveBeenCalled();
  });

  it('8. Excludes previously delivered tokens on retried attempts to prevent duplicate push sends', async () => {
    const job = {
      id: 'job-108',
      claimToken: 'token-retry-dedup',
      attempts: 2,
      deliveredTokens: ['dev-1-already-received'],
      notification: {
        id: 'notif-8',
        userId: 'user-dedup',
        title: 'Order Placed',
        body: 'Order created',
        data: {},
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue([
      'dev-1-already-received',
      'dev-2-pending-retry',
    ]);
    mockFirebaseService.sendMulticastNotification.mockResolvedValue({
      isDryRun: false,
      successCount: 1,
      failureCount: 0,
      invalidTokens: [],
      successfulTokens: ['dev-2-pending-retry'],
    });

    await worker.processBatch();

    // Verify only 'dev-2-pending-retry' was sent (dev-1 was excluded)!
    expect(mockFirebaseService.sendMulticastNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['dev-2-pending-retry'],
      }),
    );
    expect(mockPushRepo.completeJob).toHaveBeenCalledWith('job-108', 'token-retry-dedup');
  });

  it('9. Postpones unconfigured Firebase jobs with 10-minute backoff without burning retry attempts', async () => {
    const job = {
      id: 'job-109',
      claimToken: 'token-unconfig',
      attempts: 1,
      deliveredTokens: [],
      notification: {
        id: 'notif-9',
        userId: 'user-unconfig',
        title: 'Order Placed',
        body: 'Order created',
        data: {},
      },
    };

    mockPushRepo.claimJobs.mockResolvedValue([job]);
    mockPushRepo.findActiveUserTokens.mockResolvedValue(['fcm-token-1']);
    mockFirebaseService.sendMulticastNotification.mockRejectedValue(
      new Error('Firebase credentials unconfigured'),
    );

    await worker.processBatch();

    expect(mockPushRepo.postponeUnconfiguredJob).toHaveBeenCalledWith(
      'job-109',
      'token-unconfig',
      600000, // 10 minutes backoff
    );
    expect(mockPushRepo.markJobFailed).not.toHaveBeenCalled();
    expect(mockPushRepo.completeJob).not.toHaveBeenCalled();
  });

  it('10. Enforces that expected Firebase project ID is e-commerce-2da8f', () => {
    expect(EXPECTED_FIREBASE_PROJECT_ID).toBe('e-commerce-2da8f');
  });
});
