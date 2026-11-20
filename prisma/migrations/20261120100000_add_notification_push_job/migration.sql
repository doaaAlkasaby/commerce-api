-- CreateEnum
CREATE TYPE "PushJobState" AS ENUM ('READY', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "NotificationPushJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "state" "PushJobState" NOT NULL DEFAULT 'READY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "claimToken" TEXT,
    "lastErrorCode" TEXT,
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPushJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPushJob_notificationId_key" ON "NotificationPushJob"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationPushJob_state_availableAt_idx" ON "NotificationPushJob"("state", "availableAt");

-- CreateIndex
CREATE INDEX "NotificationPushJob_state_leaseUntil_idx" ON "NotificationPushJob"("state", "leaseUntil");

-- CreateIndex
CREATE INDEX "NotificationPushJob_tenantId_state_idx" ON "NotificationPushJob"("tenantId", "state");

-- AddForeignKey
ALTER TABLE "NotificationPushJob" ADD CONSTRAINT "NotificationPushJob_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
