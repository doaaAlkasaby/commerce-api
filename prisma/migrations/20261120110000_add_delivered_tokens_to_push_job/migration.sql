-- AlterTable
ALTER TABLE "NotificationPushJob" ADD COLUMN "deliveredTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
