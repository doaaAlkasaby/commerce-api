-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SpecialOrderState" ADD VALUE 'SHIPPED';
ALTER TYPE "SpecialOrderState" ADD VALUE 'DELIVERED';
ALTER TYPE "SpecialOrderState" ADD VALUE 'AWAITING_PICKUP';
ALTER TYPE "SpecialOrderState" ADD VALUE 'PICKED_UP';

-- AlterTable
ALTER TABLE "SpecialOrder" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentDiscrepancy" TEXT;

-- AlterTable
ALTER TABLE "SpecialOrderPaymentSettlement" ADD COLUMN     "cashEventId" TEXT,
ADD COLUMN     "cashObligationId" TEXT,
ALTER COLUMN "attemptId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SpecialOrderFulfillmentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderFulfillmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialOrderFulfillmentEvent_orderId_createdAt_idx" ON "SpecialOrderFulfillmentEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderFulfillmentEvent_tenantId_id_key" ON "SpecialOrderFulfillmentEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderFulfillmentEvent_orderId_key_key" ON "SpecialOrderFulfillmentEvent"("orderId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPaymentSettlement_tenantId_cashObligationId_key" ON "SpecialOrderPaymentSettlement"("tenantId", "cashObligationId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPaymentSettlement_tenantId_cashEventId_key" ON "SpecialOrderPaymentSettlement"("tenantId", "cashEventId");

-- AddForeignKey
ALTER TABLE "SpecialOrderPaymentSettlement" ADD CONSTRAINT "SpecialOrderPaymentSettlement_tenantId_cashObligationId_fkey" FOREIGN KEY ("tenantId", "cashObligationId") REFERENCES "SpecialOrderPayment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderPaymentSettlement" ADD CONSTRAINT "SpecialOrderPaymentSettlement_tenantId_cashEventId_fkey" FOREIGN KEY ("tenantId", "cashEventId") REFERENCES "SpecialOrderFulfillmentEvent"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderFulfillmentEvent" ADD CONSTRAINT "SpecialOrderFulfillmentEvent_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "SpecialOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing ready orders while extending the allowed progress states.
ALTER TABLE "SpecialOrder" DROP CONSTRAINT "SpecialOrder_sourcing_state_check";
ALTER TABLE "SpecialOrder" ADD CONSTRAINT "SpecialOrder_sourcing_state_check" CHECK (
  (state::text = 'PENDING_SOURCING' AND "sourcingStartedAt" IS NULL AND "readyAt" IS NULL)
  OR (state::text = 'SOURCING' AND "warehouseId" IS NOT NULL AND "sourcingStartedAt" IS NOT NULL AND "readyAt" IS NULL)
  OR (state::text IN ('READY_FOR_FULFILLMENT', 'SHIPPED', 'DELIVERED', 'AWAITING_PICKUP', 'PICKED_UP')
      AND "warehouseId" IS NOT NULL AND "sourcingStartedAt" IS NOT NULL AND "readyAt" IS NOT NULL
      AND "readyAt" >= "sourcingStartedAt")
);
ALTER TABLE "SpecialOrder" ADD CONSTRAINT "SpecialOrder_fulfillment_state_check" CHECK (
  (state::text NOT IN ('SHIPPED', 'DELIVERED') OR "fulfillmentMethod" = 'HOME_DELIVERY')
  AND (state::text NOT IN ('AWAITING_PICKUP', 'PICKED_UP') OR "fulfillmentMethod" = 'STORE_PICKUP')
  AND ("completedAt" IS NULL OR (state::text IN ('DELIVERED', 'PICKED_UP') AND "fulfillmentDiscrepancy" IS NULL AND "completedAt" >= "readyAt"))
);

ALTER TABLE "SpecialOrderFulfillmentEvent" ADD CONSTRAINT "SpecialOrderFulfillmentEvent_action_check" CHECK (
  action IN ('DISPATCH', 'AVAILABLE_FOR_PICKUP', 'DELIVER', 'PICK_UP', 'DELIVERY_ATTEMPT', 'REMIT_CASH', 'COMPLETE')
);
CREATE UNIQUE INDEX "SpecialOrderFulfillmentEvent_single_milestone"
ON "SpecialOrderFulfillmentEvent" ("orderId", action) WHERE action <> 'DELIVERY_ATTEMPT';

-- Cash is owned directly by its existing obligation and handover evidence.
ALTER TABLE "SpecialOrderPaymentSettlement" ADD CONSTRAINT "SpecialOrderPaymentSettlement_source_check" CHECK (
  ("attemptId" IS NOT NULL AND "cashObligationId" IS NULL AND "cashEventId" IS NULL AND provider = 'MYFATOORAH')
  OR ("attemptId" IS NULL AND "cashObligationId" IS NOT NULL AND "cashEventId" IS NOT NULL AND provider = 'NONE' AND attributable)
);
CREATE FUNCTION check_special_cash_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."cashObligationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "SpecialOrderPayment" p
    JOIN "SpecialOrderFulfillmentEvent" e ON e."tenantId" = p."tenantId" AND e."orderId" = p."orderId"
    WHERE p."tenantId" = NEW."tenantId" AND p.id = NEW."cashObligationId" AND e.id = NEW."cashEventId"
      AND p.method = 'CASH' AND p.kind = 'BALANCE' AND p.amount = NEW.amount AND p.currency = NEW.currency
      AND e.action IN ('DELIVER', 'PICK_UP') AND e.evidence->>'handedOver' = 'true'
      AND e.evidence->'cash'->>'currency' = NEW.currency
      AND (e.evidence->'cash'->>'observedAmount')::numeric = NEW.amount
      AND e."occurredAt" = NEW."verifiedAt"
  ) THEN
    RAISE check_violation USING MESSAGE = 'Cash settlement does not match the Special Order handover';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SpecialOrderPaymentSettlement_cash_evidence"
BEFORE INSERT OR UPDATE ON "SpecialOrderPaymentSettlement"
FOR EACH ROW EXECUTE FUNCTION check_special_cash_settlement();

-- Earlier cash-only orders already disclosed this amount in the order snapshot.
INSERT INTO "SpecialOrderPayment" (id, "tenantId", "orderId", kind, method, amount, currency)
SELECT gen_random_uuid()::text, o."tenantId", o.id, 'BALANCE', 'CASH', o."remainingBalance", o.currency
FROM "SpecialOrder" o
WHERE o."paymentTerms"->>'method' = 'CASH_ON_FULFILLMENT' AND o."initialPayment" = 0
ON CONFLICT ("tenantId", "orderId", kind) DO NOTHING;
