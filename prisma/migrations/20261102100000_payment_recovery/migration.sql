-- Historical orders remain NULL: no retroactive inferred expiration.
ALTER TABLE "Order" ADD COLUMN "reservationExpiresAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "Order_tenantId_id_key" ON "Order"("tenantId", "id");
CREATE INDEX "Order_status_reservationExpiresAt_idx" ON "Order"("status", "reservationExpiresAt");
CREATE INDEX "Payment_provider_status_initiationState_idx" ON "Payment"("provider", "status", "initiationState");
CREATE TYPE "RecoveryJobState" AS ENUM ('READY', 'RUNNING', 'DONE', 'MANUAL');
CREATE TABLE "RecoveryJob" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "orderId" TEXT NOT NULL,
 "state" "RecoveryJobState" NOT NULL DEFAULT 'READY',
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMPTZ(3),
 "claimToken" TEXT,
 "lastErrorCode" TEXT,
 "finishedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "RecoveryJob_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RecoveryJob_orderId_key" ON "RecoveryJob"("orderId");
CREATE UNIQUE INDEX "RecoveryJob_tenantId_orderId_key" ON "RecoveryJob"("tenantId", "orderId");
CREATE INDEX "RecoveryJob_state_availableAt_idx" ON "RecoveryJob"("state", "availableAt");
CREATE INDEX "RecoveryJob_state_leaseUntil_idx" ON "RecoveryJob"("state", "leaseUntil");
CREATE INDEX "RecoveryJob_tenantId_state_idx" ON "RecoveryJob"("tenantId", "state");
