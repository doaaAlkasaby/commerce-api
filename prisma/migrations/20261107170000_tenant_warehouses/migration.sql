BEGIN;

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "countryCode" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Warehouse_tenantId_isActive_priority_idx" ON "Warehouse"("tenantId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "Warehouse_countryCode_idx" ON "Warehouse"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenantId_id_key" ON "Warehouse"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenantId_code_key" ON "Warehouse"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express partial uniqueness or paired-coordinate checks.
CREATE UNIQUE INDEX "Warehouse_one_default_per_tenant" ON "Warehouse" ("tenantId") WHERE "isDefault";
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_active_default_check" CHECK (NOT "isDefault" OR "isActive");
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_priority_check" CHECK ("priority" >= 0);
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_coordinates_check" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL) OR
  ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND
   "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);

COMMIT;
