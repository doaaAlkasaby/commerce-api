import { prisma as defaultPrisma } from '../../config/database.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';

export interface ClaimedPushJob {
  id: string;
  tenantId: string;
  notificationId: string;
  attempts: number;
  deliveredTokens: string[];
  claimToken: string;
  notification: {
    id: string;
    tenantId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    data: unknown;
  };
}

export class NotificationPushRepository {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async claimJobs(
    batchSize: number,
    leaseMs: number,
  ): Promise<ClaimedPushJob[]> {
    const claimToken = randomUUID();
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);

    const eligible = await this.prisma.notificationPushJob.findMany({
      where: {
        OR: [
          { state: 'READY', availableAt: { lte: now } },
          { state: 'PROCESSING', leaseUntil: { lte: now } },
        ],
      },
      select: { id: true },
      take: batchSize,
      orderBy: { availableAt: 'asc' },
    });

    if (!eligible.length) {
      return [];
    }

    const ids = eligible.map((j) => j.id);

    const updated = await this.prisma.notificationPushJob.updateMany({
      where: {
        id: { in: ids },
        OR: [
          { state: 'READY', availableAt: { lte: now } },
          { state: 'PROCESSING', leaseUntil: { lte: now } },
        ],
      },
      data: {
        state: 'PROCESSING',
        claimToken,
        leaseUntil,
        attempts: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      return [];
    }

    const claimed = await this.prisma.notificationPushJob.findMany({
      where: {
        id: { in: ids },
        claimToken,
      },
      select: {
        id: true,
        tenantId: true,
        notificationId: true,
        attempts: true,
        deliveredTokens: true,
        claimToken: true,
        notification: {
          select: {
            id: true,
            tenantId: true,
            userId: true,
            type: true,
            title: true,
            body: true,
            data: true,
          },
        },
      },
    });

    return claimed as ClaimedPushJob[];
  }

  async recordDeliveredTokens(
    jobId: string,
    newlyDeliveredTokens: string[],
  ): Promise<void> {
    if (!newlyDeliveredTokens.length) return;

    const currentJob = await this.prisma.notificationPushJob.findUnique({
      where: { id: jobId },
      select: { deliveredTokens: true },
    });

    if (!currentJob) return;

    const mergedTokens = Array.from(
      new Set([...currentJob.deliveredTokens, ...newlyDeliveredTokens]),
    );

    await this.prisma.notificationPushJob.update({
      where: { id: jobId },
      data: { deliveredTokens: mergedTokens },
    });
  }

  async completeJob(jobId: string, claimToken: string): Promise<void> {
    await this.prisma.notificationPushJob.updateMany({
      where: { id: jobId, claimToken },
      data: {
        state: 'COMPLETED',
        leaseUntil: null,
        claimToken: null,
        finishedAt: new Date(),
      },
    });
  }

  async retryJob(
    jobId: string,
    claimToken: string,
    errorCode: string,
    backoffMs: number,
  ): Promise<void> {
    const availableAt = new Date(Date.now() + backoffMs);

    await this.prisma.notificationPushJob.updateMany({
      where: { id: jobId, claimToken },
      data: {
        state: 'READY',
        leaseUntil: null,
        claimToken: null,
        lastErrorCode: errorCode.substring(0, 128),
        availableAt,
      },
    });
  }

  async postponeUnconfiguredJob(
    jobId: string,
    claimToken: string,
    backoffMs: number,
  ): Promise<void> {
    const availableAt = new Date(Date.now() + backoffMs);

    await this.prisma.notificationPushJob.updateMany({
      where: { id: jobId, claimToken },
      data: {
        state: 'READY',
        leaseUntil: null,
        claimToken: null,
        lastErrorCode: 'FIREBASE_CREDENTIALS_UNCONFIGURED',
        availableAt,
        attempts: { decrement: 1 },
      },
    });
  }

  async markJobFailed(
    jobId: string,
    claimToken: string,
    errorCode: string,
  ): Promise<void> {
    await this.prisma.notificationPushJob.updateMany({
      where: { id: jobId, claimToken },
      data: {
        state: 'FAILED',
        leaseUntil: null,
        claimToken: null,
        lastErrorCode: errorCode.substring(0, 128),
        finishedAt: new Date(),
      },
    });
  }

  async findActiveUserTokens(userId: string): Promise<string[]> {
    const devices = await this.prisma.userDevice.findMany({
      where: {
        userId,
        isActive: true,
      },
      select: { token: true },
    });

    return devices.map((d) => d.token);
  }

  async deactivateTokens(tokens: string[]): Promise<void> {
    if (!tokens.length) return;

    await this.prisma.userDevice.updateMany({
      where: { token: { in: tokens } },
      data: { isActive: false },
    });
  }
}

export const notificationPushRepository = new NotificationPushRepository();
