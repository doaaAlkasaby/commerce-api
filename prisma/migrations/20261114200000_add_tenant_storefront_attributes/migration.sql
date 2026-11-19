-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "isPubliclyListed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Tenant_status_isPubliclyListed_idx" ON "Tenant"("status", "isPubliclyListed");
