-- AlterTable
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "eventKey" TEXT;

-- Safety Guard: Ensure no unmapped notifications exist before making tenantId NOT NULL
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Notification" WHERE "tenantId" IS NULL) THEN
        RAISE EXCEPTION 'Cannot set NOT NULL on Notification.tenantId: unmapped notification records exist.';
    END IF;
END $$;

-- Make tenantId NOT NULL
ALTER TABLE "Notification" ALTER COLUMN "tenantId" SET NOT NULL;

-- Drop old single-column indexes if present
DROP INDEX IF EXISTS "Notification_userId_createdAt_idx";
DROP INDEX IF EXISTS "Notification_userId_isRead_idx";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX IF NOT EXISTS "Notification_tenantId_userId_createdAt_idx" ON "Notification"("tenantId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_tenantId_userId_isRead_idx" ON "Notification"("tenantId", "userId", "isRead");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Notification_tenantId_fkey'
    ) THEN
        ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
