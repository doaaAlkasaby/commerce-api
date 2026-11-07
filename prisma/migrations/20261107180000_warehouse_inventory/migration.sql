BEGIN;

-- DropIndex
DROP INDEX "Inventory_variantId_key";

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "tenantId" TEXT,
ADD COLUMN "warehouseId" TEXT;

-- Existing stock must be explicitly mapped to a real, configured default source.
-- Never invent a physical address or silently choose another tenant's warehouse.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Inventory" i JOIN "ProductVariant" v ON v."id"=i."variantId"
    JOIN "Product" p ON p."id"=v."productId"
    WHERE NOT EXISTS (SELECT 1 FROM "Warehouse" w WHERE w."tenantId"=p."tenantId" AND w."isDefault" AND w."isActive"))
  THEN RAISE EXCEPTION 'Configure an active default warehouse for every tenant with existing inventory before applying warehouse inventory migration'; END IF;
END $$;
UPDATE "Inventory" i SET "tenantId"=p."tenantId", "warehouseId"=w."id"
FROM "ProductVariant" v JOIN "Product" p ON p."id"=v."productId"
JOIN "Warehouse" w ON w."tenantId"=p."tenantId" AND w."isDefault" AND w."isActive"
WHERE i."variantId"=v."id";
ALTER TABLE "Inventory" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "warehouseId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fulfillmentSnapshot" JSONB,
ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "WarehouseCoverage" (
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,

    CONSTRAINT "WarehouseCoverage_pkey" PRIMARY KEY ("warehouseId","countryCode")
);

-- CreateIndex
CREATE INDEX "WarehouseCoverage_tenantId_countryCode_idx" ON "WarehouseCoverage"("tenantId", "countryCode");

-- CreateIndex
CREATE INDEX "Inventory_tenantId_variantId_idx" ON "Inventory"("tenantId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_warehouseId_variantId_key" ON "Inventory"("warehouseId", "variantId");

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCoverage" ADD CONSTRAINT "WarehouseCoverage_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCoverage" ADD CONSTRAINT "WarehouseCoverage_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_available_nonnegative" CHECK ("quantity" >= 0 AND "reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity");
CREATE FUNCTION enforce_inventory_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ProductVariant" v JOIN "Product" p ON p."id"=v."productId" WHERE v."id"=NEW."variantId" AND p."tenantId"=NEW."tenantId") THEN
    RAISE EXCEPTION 'Inventory variant tenant mismatch' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Inventory_tenant_guard" BEFORE INSERT OR UPDATE OF "tenantId", "variantId" ON "Inventory" FOR EACH ROW EXECUTE FUNCTION enforce_inventory_tenant();

CREATE FUNCTION protect_inventory_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."tenantId", NEW."warehouseId", NEW."variantId") IS DISTINCT FROM (OLD."tenantId", OLD."warehouseId", OLD."variantId") THEN
    RAISE EXCEPTION 'Inventory source identity is immutable' USING ERRCODE='23514';
  END IF;
  IF (TG_OP = 'INSERT' AND NEW."reservedQuantity" > 0) OR
     (TG_OP = 'UPDATE' AND NEW."reservedQuantity" > OLD."reservedQuantity") THEN
    PERFORM 1 FROM "Warehouse" WHERE "id"=NEW."warehouseId" AND "tenantId"=NEW."tenantId" AND "isActive" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cannot reserve inactive warehouse inventory' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Inventory_source_guard" BEFORE INSERT OR UPDATE ON "Inventory" FOR EACH ROW EXECUTE FUNCTION protect_inventory_source();

COMMIT;
