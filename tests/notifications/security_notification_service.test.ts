import { describe, expect, it } from 'vitest';
import { SecurityNotificationService } from '../../src/modules/notifications/security-notification.service.js';
import type { NotificationRepository } from '../../src/modules/notifications/notification.repository.js';

describe('Phase NOTIF-8E: Security Notification Service Unit Tests', () => {
  const userId = 'user-sec-99';
  const inMemoryStore: any[] = [];

  const mockRepo = {
    createIdempotent: async (input: any) => {
      if (
        input.eventKey &&
        inMemoryStore.some((n) => n.eventKey === input.eventKey)
      ) {
        return null;
      }
      const notif = {
        id: `notif-${inMemoryStore.length + 1}`,
        scope: input.scope,
        tenantId: input.tenantId ?? null,
        userId: input.userId,
        eventKey: input.eventKey ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? null,
        isRead: false,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      inMemoryStore.push(notif);
      return notif;
    },
  } as unknown as NotificationRepository;

  const mockTx = {
    notificationPushJob: { create: async () => undefined },
  } as any;

  const securityNotifService = new SecurityNotificationService(mockRepo);

  it('1. Successfully creates PASSWORD_CHANGED notification with ACCOUNT scope and null tenantId', async () => {
    const result = await securityNotifService.createSecurityNotification({
      eventType: 'PASSWORD_CHANGED',
      userId,
      operationId: 'op-change-1',
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification).not.toBeNull();
    expect(result.notification!.scope).toBe('ACCOUNT');
    expect(result.notification!.tenantId).toBeNull();
    expect(result.notification!.type).toBe('SYSTEM');
    expect(result.notification!.title).toContain('Security Alert: Password Changed');
  });

  it('2. Successfully creates PASSWORD_RESET_COMPLETED notification with resetTokenId', async () => {
    const result = await securityNotifService.createSecurityNotification({
      eventType: 'PASSWORD_RESET_COMPLETED',
      userId,
      resetTokenId: 'reset-tok-123',
      tx: mockTx,
    });

    expect(result.status).toBe('CREATED');
    expect(result.notification!.title).toContain('Security Alert: Password Reset');
    expect(result.notification!.scope).toBe('ACCOUNT');
  });

  it('3. Reused password reset token ID yields ALREADY_EXISTS idempotency result', async () => {
    const duplicateResult = await securityNotifService.createSecurityNotification({
      eventType: 'PASSWORD_RESET_COMPLETED',
      userId,
      resetTokenId: 'reset-tok-123',
      tx: mockTx,
    });

    expect(duplicateResult.status).toBe('ALREADY_EXISTS');
    expect(duplicateResult.notification).toBeNull();
  });
});
