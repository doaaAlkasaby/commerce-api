import type { Prisma, NotificationType } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { notificationRepository } from './notification.repository.instance.js';
import { mapNotification } from './notification.mapper.js';
import type { NotificationResponse } from './notification.types.js';

export type SecurityEventType =
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_COMPLETED';

export interface CreateSecurityNotificationInput {
  eventType: SecurityEventType;
  userId: string;
  tx: Prisma.TransactionClient;
  operationId?: string;
  resetTokenId?: string;
  tenantSlug?: string;
}

export interface SecurityNotificationResult {
  status: 'CREATED' | 'ALREADY_EXISTS';
  notification: NotificationResponse | null;
}

interface NotificationContent {
  type: NotificationType;
  title: string;
  body: string;
}

export class SecurityNotificationService {
  constructor(private readonly repository = notificationRepository) {}

  private getContent(eventType: SecurityEventType): NotificationContent {
    switch (eventType) {
      case 'PASSWORD_CHANGED':
        return {
          type: 'SYSTEM',
          title: 'Security Alert: Password Changed',
          body: 'The password for your account was recently updated. If you did not make this change, please contact support immediately.',
        };
      case 'PASSWORD_RESET_COMPLETED':
        return {
          type: 'SYSTEM',
          title: 'Security Alert: Password Reset',
          body: 'Your account password was successfully reset. If you did not request this, please contact support immediately.',
        };
    }
  }

  async createSecurityNotification(
    input: CreateSecurityNotificationInput,
  ): Promise<SecurityNotificationResult> {
    const {
      eventType,
      userId,
      tx,
      operationId,
      resetTokenId,
      tenantSlug,
    } = input;

    if (!tx) {
      throw new AppError(
        'Transaction client is required for security notifications',
        500,
        'TRANSACTION_REQUIRED',
      );
    }

    if (!userId || !userId.trim()) {
      throw new AppError(
        'User ID is required for security notifications',
        400,
        'INVALID_SECURITY_NOTIFICATION_CONTEXT',
      );
    }

    let eventKey: string;
    if (eventType === 'PASSWORD_RESET_COMPLETED' && resetTokenId) {
      eventKey = `password_reset_${resetTokenId}`;
    } else {
      eventKey = `password_changed_${userId}_${operationId || crypto.randomUUID()}`;
    }

    const content = this.getContent(eventType);

    const dataPayload = {
      userId,
      eventType,
      ...(tenantSlug ? { tenantSlug } : {}),
    };

    const notificationRecord = await this.repository.createIdempotent(
      {
        scope: 'ACCOUNT',
        tenantId: null,
        userId,
        eventKey,
        type: content.type,
        title: content.title,
        body: content.body,
        data: dataPayload,
      },
      tx,
    );

    if (!notificationRecord) {
      return {
        status: 'ALREADY_EXISTS',
        notification: null,
      };
    }

    await tx.notificationPushJob.create({
      data: {
        tenantId: null,
        notificationId: notificationRecord.id,
        state: 'READY',
      },
    });

    return {
      status: 'CREATED',
      notification: mapNotification(notificationRecord),
    };
  }
}

export const securityNotificationService = new SecurityNotificationService();
