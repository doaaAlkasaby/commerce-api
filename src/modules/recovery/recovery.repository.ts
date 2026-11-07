import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database.js';
import type { Prisma, RecoveryJob } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';

export class RecoveryRepository {
  constructor(private readonly client = prisma) {}

  async enqueue(limit: number): Promise<number> {
    const candidates = await this.client.$queryRaw<
      Array<{ id: string; tenantId: string }>
    >`
      SELECT candidates."id", candidates."tenantId" FROM (
        (SELECT o."id", o."tenantId" FROM "Order" o
          WHERE o."status" = 'PENDING' AND o."reservationExpiresAt" <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM "RecoveryJob" j WHERE j."orderId" = o."id")
          ORDER BY o."reservationExpiresAt", o."id" LIMIT ${limit})
        UNION
        (SELECT o."id", o."tenantId" FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId"
          WHERE p."provider" = 'MYFATOORAH' AND p."status" IN ('PENDING','REQUIRES_ACTION','AUTHORIZED','FAILED','CANCELLED')
          AND (p."initiationState" <> 'NOT_STARTED' OR p."providerPaymentId" IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM "RecoveryJob" j WHERE j."orderId" = o."id")
          ORDER BY p."id" LIMIT ${limit})
        UNION
        (SELECT o."id", o."tenantId" FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId"
          WHERE p."provider" = 'NONE' AND p."status" = 'PENDING' AND p."initiationState" IN ('IN_PROGRESS','UNKNOWN')
          AND NOT EXISTS (SELECT 1 FROM "RecoveryJob" j WHERE j."orderId" = o."id")
          ORDER BY p."id" LIMIT ${limit})
      ) candidates ORDER BY candidates."id" LIMIT ${limit}
    `;
    if (!candidates.length) return 0;
    const result = await this.client.recoveryJob.createMany({
      data: candidates.map((order) => ({
        id: randomUUID(),
        tenantId: order.tenantId,
        orderId: order.id,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  claim(limit: number, leaseMs: number): Promise<RecoveryJob[]> {
    const token = randomUUID();
    return this.client.$queryRaw<RecoveryJob[]>`
      WITH due AS (
        SELECT "id" FROM "RecoveryJob"
        WHERE ("state" = 'READY' AND "availableAt" <= clock_timestamp())
          OR ("state" = 'RUNNING' AND "leaseUntil" <= clock_timestamp())
        ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT ${limit}
      ) UPDATE "RecoveryJob" j SET "state" = 'RUNNING', "attempts" = j."attempts" + 1,
          "claimToken" = ${token}, "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond',
          "updatedAt" = clock_timestamp()
        FROM due WHERE j."id" = due."id" RETURNING j.*
    `;
  }

  async guard(tx: Prisma.TransactionClient, job: RecoveryJob): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "RecoveryJob" WHERE "id" = ${job.id} AND "tenantId" = ${job.tenantId}
        AND "orderId" = ${job.orderId} AND "state" = 'RUNNING' AND "claimToken" = ${job.claimToken}
        AND "leaseUntil" > clock_timestamp() FOR UPDATE
    `;
    if (!rows.length)
      throw new AppError(
        'Recovery lease is no longer owned',
        409,
        'WORKER_LEASE_LOST',
      );
  }

  async locked<T>(
    job: RecoveryJob,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${job.orderId} AND "tenantId" = ${job.tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT p."id" FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId"
        WHERE o."id" = ${job.orderId} AND o."tenantId" = ${job.tenantId} ORDER BY p."id" FOR UPDATE OF p`;
      await this.guard(tx, job);
      return operation(tx);
    });
  }

  async inspect(job: RecoveryJob) {
    return this.locked(job, async (tx) => {
      const order = await tx.order.findFirstOrThrow({
        where: { id: job.orderId, tenantId: job.tenantId },
        include: { payments: true },
      });
      const [row] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      if (!row) throw new Error('Database time unavailable');
      return { order, now: row.now };
    });
  }

  async markUnknown(
    job: RecoveryJob,
    paymentId: string,
    graceMs: number,
  ): Promise<void> {
    await this.locked(job, async (tx) => {
      // Recheck staleness under the same order lock; a webhook or reply may have won.
      await tx.$executeRaw`UPDATE "Payment" SET "initiationState" = 'UNKNOWN', "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
        WHERE "id" = ${paymentId} AND "orderId" = ${job.orderId} AND "initiationState" = 'IN_PROGRESS'
          AND ("updatedAt" AT TIME ZONE 'UTC') <= clock_timestamp() - ${graceMs} * interval '1 millisecond'`;
    });
  }

  async finish(
    job: RecoveryJob,
    state: 'DONE' | 'READY' | 'MANUAL',
    category: string | null = null,
    delayMs = 0,
    atDeadline = false,
  ) {
    await this.locked(job, async (tx) => {
      if (state === 'MANUAL')
        await tx.payment.updateMany({
          where: { orderId: job.orderId, order: { tenantId: job.tenantId } },
          data: {
            reconciliationRequired: true,
            reconciliationReason: category,
          },
        });
      await tx.$executeRaw`UPDATE "RecoveryJob" SET "state" = ${state}::"RecoveryJobState",
        "lastErrorCode" = ${category}, "claimToken" = NULL, "leaseUntil" = NULL,
        "availableAt" = CASE WHEN ${atDeadline} THEN
          (SELECT COALESCE("reservationExpiresAt", clock_timestamp()) FROM "Order" WHERE "id" = ${job.orderId} AND "tenantId" = ${job.tenantId})
          ELSE clock_timestamp() + ${delayMs} * interval '1 millisecond' END,
        "finishedAt" = CASE WHEN ${state} = 'READY' THEN NULL ELSE clock_timestamp() END,
        "updatedAt" = clock_timestamp() WHERE "id" = ${job.id} AND "tenantId" = ${job.tenantId}
      `;
    });
  }
}
