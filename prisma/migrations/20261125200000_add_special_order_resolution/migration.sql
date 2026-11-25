-- CreateEnum
CREATE TYPE "SpecialOrderCancellationStatus" AS ENUM ('NONE', 'UNDER_REVIEW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SpecialOrderReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "SpecialOrderRefundState" AS ENUM ('DUE', 'IN_PROGRESS', 'UNKNOWN', 'SETTLED', 'UNSUPPORTED');

-- AlterTable
ALTER TABLE "SpecialOrder" ADD COLUMN     "cancellationStatus" "SpecialOrderCancellationStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "SpecialOrderResolutionEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderResolutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderSourcingCorrection" (
    "eventId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "SpecialOrderSourcingCorrection_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "SpecialOrderReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "SpecialOrderReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "items" JSONB NOT NULL,
    "receipt" JSONB,
    "warehouseReturn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "state" "SpecialOrderRefundState" NOT NULL DEFAULT 'DUE',
    "providerRefundId" TEXT,
    "outcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialOrderRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialOrderResolutionEvent_orderId_createdAt_idx" ON "SpecialOrderResolutionEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderResolutionEvent_orderId_key_key" ON "SpecialOrderResolutionEvent"("orderId", "key");

-- CreateIndex
CREATE INDEX "SpecialOrderSourcingCorrection_entryId_idx" ON "SpecialOrderSourcingCorrection"("entryId");

-- CreateIndex
CREATE INDEX "SpecialOrderReturn_orderId_status_idx" ON "SpecialOrderReturn"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderRefund_providerRefundId_key" ON "SpecialOrderRefund"("providerRefundId");

-- CreateIndex
CREATE INDEX "SpecialOrderRefund_orderId_state_idx" ON "SpecialOrderRefund"("orderId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderRefund_settlementId_sourceKey_key" ON "SpecialOrderRefund"("settlementId", "sourceKey");

-- AddForeignKey
ALTER TABLE "SpecialOrderResolutionEvent" ADD CONSTRAINT "SpecialOrderResolutionEvent_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "SpecialOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderSourcingCorrection" ADD CONSTRAINT "SpecialOrderSourcingCorrection_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SpecialOrderResolutionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderSourcingCorrection" ADD CONSTRAINT "SpecialOrderSourcingCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "SpecialOrderSourcingEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderReturn" ADD CONSTRAINT "SpecialOrderReturn_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "SpecialOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderRefund" ADD CONSTRAINT "SpecialOrderRefund_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "SpecialOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderRefund" ADD CONSTRAINT "SpecialOrderRefund_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "SpecialOrderPaymentSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SpecialOrderSourcingCorrection"
  ADD CONSTRAINT "SpecialOrderSourcingCorrection_positive_check" CHECK (quantity > 0);
ALTER TABLE "SpecialOrderRefund"
  ADD CONSTRAINT "SpecialOrderRefund_amount_check" CHECK (amount > 0);

CREATE FUNCTION guard_special_sourcing_correction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original "SpecialOrderSourcingEntry"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT original FROM "SpecialOrderSourcingEntry" WHERE id = NEW."entryId" FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM "SpecialOrderResolutionEvent" WHERE id = NEW."eventId"
    AND "orderId" = original."orderId" AND action = 'CORRECT_SOURCING')
    OR NEW.quantity + COALESCE((SELECT SUM(quantity) FROM "SpecialOrderSourcingCorrection" WHERE "entryId" = NEW."entryId"), 0) > original.quantity
  THEN RAISE check_violation USING MESSAGE = 'Correction exceeds its Special Order sourcing evidence';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SpecialOrderSourcingCorrection_capacity"
BEFORE INSERT ON "SpecialOrderSourcingCorrection"
FOR EACH ROW EXECUTE FUNCTION guard_special_sourcing_correction();

CREATE FUNCTION guard_special_refund_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original "SpecialOrderPaymentSettlement"%ROWTYPE;
  settlement_order text;
BEGIN
  SELECT * INTO STRICT original FROM "SpecialOrderPaymentSettlement" WHERE id = NEW."settlementId" FOR UPDATE;
  IF original."attemptId" IS NOT NULL THEN
    SELECT p."orderId" INTO settlement_order FROM "SpecialOrderPaymentAttempt" a
    JOIN "SpecialOrderPayment" p ON p.id = a."obligationId" AND p."tenantId" = a."tenantId"
    WHERE a.id = original."attemptId";
  ELSE
    SELECT "orderId" INTO settlement_order FROM "SpecialOrderPayment" WHERE id = original."cashObligationId";
  END IF;
  IF settlement_order IS DISTINCT FROM NEW."orderId" OR original."tenantId" <> NEW."tenantId"
    OR original.currency <> NEW.currency OR NOT original.attributable
    OR NEW.amount + COALESCE((SELECT SUM(amount) FROM "SpecialOrderRefund" WHERE "settlementId" = NEW."settlementId" AND id <> NEW.id), 0) > original.amount
  THEN RAISE check_violation USING MESSAGE = 'Refund exceeds its attributable Special Order settlement';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SpecialOrderRefund_capacity"
BEFORE INSERT OR UPDATE OF "settlementId", "orderId", "tenantId", amount, currency ON "SpecialOrderRefund"
FOR EACH ROW EXECUTE FUNCTION guard_special_refund_capacity();

-- Historical unsuccessful handover evidence remains intact. The order lock and
-- state transition still allow just one physical handover.
DROP INDEX "SpecialOrderFulfillmentEvent_single_milestone";
CREATE UNIQUE INDEX "SpecialOrderFulfillmentEvent_single_milestone"
ON "SpecialOrderFulfillmentEvent" ("orderId", action)
WHERE action NOT IN ('DELIVERY_ATTEMPT', 'DELIVER', 'PICK_UP', 'AVAILABLE_FOR_PICKUP');
ALTER TABLE "SpecialOrderFulfillmentEvent" DROP CONSTRAINT "SpecialOrderFulfillmentEvent_action_check";
ALTER TABLE "SpecialOrderFulfillmentEvent" ADD CONSTRAINT "SpecialOrderFulfillmentEvent_action_check" CHECK (
  action IN ('DISPATCH', 'AVAILABLE_FOR_PICKUP', 'DELIVER', 'PICK_UP', 'DELIVERY_ATTEMPT', 'REMIT_CASH', 'COMPLETE', 'RECONCILE_CASH')
);

CREATE OR REPLACE FUNCTION check_special_sourcing_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  selected_item "SpecialOrderItem"%ROWTYPE;
  selected_order "SpecialOrder"%ROWTYPE;
  operation_action text;
  movement_reference text;
BEGIN
  SELECT * INTO STRICT selected_order FROM "SpecialOrder" WHERE id = NEW."orderId" FOR UPDATE;
  SELECT * INTO STRICT selected_item FROM "SpecialOrderItem" WHERE id = NEW."itemId" AND "orderId" = NEW."orderId";
  SELECT action INTO STRICT operation_action FROM "SpecialOrderSourcingOperation" WHERE id = NEW."operationId" AND "orderId" = NEW."orderId";
  IF selected_order.state <> 'SOURCING' OR selected_order."warehouseId" IS NULL OR
      NEW.quantity + COALESCE((SELECT SUM(e.quantity - COALESCE((SELECT SUM(c.quantity) FROM "SpecialOrderSourcingCorrection" c WHERE c."entryId" = e.id), 0)) FROM "SpecialOrderSourcingEntry" e WHERE e."orderId" = NEW."orderId" AND e."itemId" = NEW."itemId"), 0) > selected_item.quantity THEN
    RAISE check_violation USING MESSAGE = 'Invalid Special Order sourcing quantity or state';
  END IF;
  IF NEW."inventoryId" IS NULL THEN
    IF operation_action <> 'SECURE' OR selected_item."productId" IS NOT NULL OR selected_item."variantId" IS NOT NULL THEN
      RAISE check_violation USING MESSAGE = 'Invalid non-catalog sourcing entry';
    END IF;
  ELSE
    movement_reference := 'special-sourcing:' || NEW."operationId" || ':' || NEW."itemId";
    IF operation_action NOT IN ('START', 'RESERVE', 'RECEIVE') OR NOT EXISTS (
      SELECT 1 FROM "Inventory" i JOIN "ProductVariant" v ON v.id = i."variantId"
      WHERE i.id = NEW."inventoryId" AND i."tenantId" = selected_order."tenantId"
        AND i."warehouseId" = selected_order."warehouseId"
        AND (selected_item."productId" IS NULL OR v."productId" = selected_item."productId")
        AND (v.id = selected_item."variantId" OR (selected_item."variantId" IS NULL AND selected_item."productId" IS NOT NULL AND v."isDefault"))
    ) OR NOT EXISTS (
      SELECT 1 FROM "InventoryTransaction" WHERE "inventoryId" = NEW."inventoryId"
        AND "referenceId" = movement_reference AND type = 'RESERVATION' AND quantity = NEW.quantity
    ) OR (operation_action = 'RECEIVE' AND NOT EXISTS (
      SELECT 1 FROM "InventoryTransaction" WHERE "inventoryId" = NEW."inventoryId"
        AND "referenceId" = movement_reference AND type = 'STOCK_IN' AND quantity = NEW.quantity
    )) THEN
      RAISE check_violation USING MESSAGE = 'Invalid Special Order inventory ownership or movement evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION check_special_cash_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."cashObligationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "SpecialOrderPayment" p
    JOIN "SpecialOrderFulfillmentEvent" e ON e."tenantId" = p."tenantId" AND e."orderId" = p."orderId"
    WHERE p."tenantId" = NEW."tenantId" AND p.id = NEW."cashObligationId" AND e.id = NEW."cashEventId"
      AND p.method = 'CASH' AND p.kind = 'BALANCE' AND p.amount = NEW.amount AND p.currency = NEW.currency
      AND (e.action IN ('DELIVER', 'PICK_UP') OR (e.action = 'RECONCILE_CASH' AND EXISTS (
        SELECT 1 FROM "SpecialOrderFulfillmentEvent" original WHERE original.id = e.evidence->>'originalEventId'
          AND original."orderId" = e."orderId" AND original.action IN ('DELIVER', 'PICK_UP')
          AND original.evidence->>'handedOver' = 'true'
      ))) AND e.evidence->>'handedOver' = 'true'
      AND e.evidence->'cash'->>'currency' = NEW.currency
      AND (e.evidence->'cash'->>'observedAmount')::numeric = NEW.amount
      AND e."occurredAt" = NEW."verifiedAt"
  ) THEN
    RAISE check_violation USING MESSAGE = 'Cash settlement does not match the Special Order handover';
  END IF;
  RETURN NEW;
END;
$$;
