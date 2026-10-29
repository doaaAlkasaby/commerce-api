-- Preserve legacy records. Never invent fingerprints from current mutable data.
ALTER TABLE "CheckoutRequest" ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

UPDATE "CheckoutRequest" r SET "tenantId" = o."tenantId"
FROM "Order" o WHERE r."orderId" = o."id" AND r."userId" = o."userId";

CREATE UNIQUE INDEX "CheckoutRequest_tenantId_userId_idempotencyKey_key"
  ON "CheckoutRequest"("tenantId", "userId", "idempotencyKey");
DROP INDEX "CheckoutRequest_userId_idempotencyKey_key";
ALTER TABLE "CheckoutRequest" ADD CONSTRAINT "CheckoutRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
