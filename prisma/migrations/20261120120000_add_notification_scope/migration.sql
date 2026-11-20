-- CreateEnum
CREATE TYPE "NotificationScope" AS ENUM ('TENANT', 'ACCOUNT');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "scope" "NotificationScope" NOT NULL DEFAULT 'TENANT',
ALTER COLUMN "tenantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "NotificationPushJob" ALTER COLUMN "tenantId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Notification_userId_scope_createdAt_idx" ON "Notification"("userId", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_scope_isRead_idx" ON "Notification"("userId", "scope", "isRead");

-- Add Check Constraint
ALTER TABLE "Notification" ADD CONSTRAINT "notification_scope_tenant_id_check" CHECK (
  ("scope" = 'TENANT' AND "tenantId" IS NOT NULL) OR
  ("scope" = 'ACCOUNT' AND "tenantId" IS NULL)
);
