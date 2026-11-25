-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SpecialOrderState" ADD VALUE 'SOURCING';
ALTER TYPE "SpecialOrderState" ADD VALUE 'READY_FOR_FULFILLMENT';

-- AlterTable
ALTER TABLE "SpecialOrder" ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "sourcingStartedAt" TIMESTAMP(3),
ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "SpecialOrderSourcingOperation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderSourcingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderSourcingEntry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "inventoryId" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "SpecialOrderSourcingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderSourcingOperation_orderId_id_key" ON "SpecialOrderSourcingOperation"("orderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderSourcingOperation_orderId_key_key" ON "SpecialOrderSourcingOperation"("orderId", "key");

-- CreateIndex
CREATE INDEX "SpecialOrderSourcingEntry_orderId_itemId_idx" ON "SpecialOrderSourcingEntry"("orderId", "itemId");

-- CreateIndex
CREATE INDEX "SpecialOrderSourcingEntry_inventoryId_idx" ON "SpecialOrderSourcingEntry"("inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderSourcingEntry_operationId_itemId_key" ON "SpecialOrderSourcingEntry"("operationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderItem_orderId_id_key" ON "SpecialOrderItem"("orderId", "id");

-- AddForeignKey
ALTER TABLE "SpecialOrder" ADD CONSTRAINT "SpecialOrder_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderSourcingOperation" ADD CONSTRAINT "SpecialOrderSourcingOperation_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "SpecialOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderSourcingEntry" ADD CONSTRAINT "SpecialOrderSourcingEntry_orderId_operationId_fkey" FOREIGN KEY ("orderId", "operationId") REFERENCES "SpecialOrderSourcingOperation"("orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderSourcingEntry" ADD CONSTRAINT "SpecialOrderSourcingEntry_orderId_itemId_fkey" FOREIGN KEY ("orderId", "itemId") REFERENCES "SpecialOrderItem"("orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderSourcingEntry" ADD CONSTRAINT "SpecialOrderSourcingEntry_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SpecialOrderSourcingOperation"
  ADD CONSTRAINT "SpecialOrderSourcingOperation_action_check" CHECK (
    action IN ('START', 'RESERVE', 'RECEIVE', 'SECURE', 'READY')
  );

ALTER TABLE "SpecialOrderSourcingEntry"
  ADD CONSTRAINT "SpecialOrderSourcingEntry_quantity_check" CHECK (quantity > 0);

-- Inventory evidence must belong to this operation, tenant, warehouse and item.
CREATE FUNCTION check_special_sourcing_entry() RETURNS trigger LANGUAGE plpgsql AS $$
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
      NEW.quantity + COALESCE((SELECT SUM(quantity) FROM "SpecialOrderSourcingEntry" WHERE "orderId" = NEW."orderId" AND "itemId" = NEW."itemId"), 0) > selected_item.quantity THEN
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
CREATE TRIGGER "SpecialOrderSourcingEntry_evidence"
BEFORE INSERT ON "SpecialOrderSourcingEntry"
FOR EACH ROW EXECUTE FUNCTION check_special_sourcing_entry();

ALTER TABLE "SpecialOrder"
  ADD CONSTRAINT "SpecialOrder_sourcing_state_check" CHECK (
    (state::text = 'PENDING_SOURCING' AND "sourcingStartedAt" IS NULL AND "readyAt" IS NULL)
    OR (state::text = 'SOURCING' AND "warehouseId" IS NOT NULL AND "sourcingStartedAt" IS NOT NULL AND "readyAt" IS NULL)
    OR (state::text = 'READY_FOR_FULFILLMENT' AND "warehouseId" IS NOT NULL AND "readyAt" >= "sourcingStartedAt"
        AND "sourcingStartedAt" IS NOT NULL AND "readyAt" IS NOT NULL)
  );

CREATE FUNCTION keep_special_sourcing_warehouse() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."warehouseId" IS DISTINCT FROM OLD."warehouseId"
    AND EXISTS (SELECT 1 FROM "SpecialOrderSourcingEntry" WHERE "orderId" = OLD.id) THEN
    RAISE check_violation USING MESSAGE = 'Special Order warehouse cannot change after stock is secured';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SpecialOrder_sourcing_warehouse_fixed"
BEFORE UPDATE OF "warehouseId" ON "SpecialOrder"
FOR EACH ROW EXECUTE FUNCTION keep_special_sourcing_warehouse();
