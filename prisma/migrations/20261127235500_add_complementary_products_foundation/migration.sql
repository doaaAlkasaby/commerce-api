-- PR.2A: Automatic Complementary Products Foundation
-- 1. Composite unique identity on Category for tenant-safe foreign keys
-- 2. Directional CategoryComplementaryRelation table with DB-enforced tenant/self/sortOrder invariants
-- 3. Composite indexes supporting bounded tenant co-purchase analysis

-- CreateIndex
CREATE UNIQUE INDEX "Category_tenantId_id_key" ON "Category"("tenantId", "id");

-- CreateTable
CREATE TABLE "CategoryComplementaryRelation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceCategoryId" TEXT NOT NULL,
    "targetCategoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryComplementaryRelation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CategoryComplementaryRelation_no_self_check" CHECK ("sourceCategoryId" <> "targetCategoryId"),
    CONSTRAINT "CategoryComplementaryRelation_sortOrder_non_negative_check" CHECK ("sortOrder" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryComplementaryRelation_tenantId_sourceCategoryId_tar_key"
    ON "CategoryComplementaryRelation"("tenantId", "sourceCategoryId", "targetCategoryId");

-- CreateIndex
CREATE INDEX "CategoryComplementaryRelation_tenantId_sourceCategoryId_sor_idx"
    ON "CategoryComplementaryRelation"("tenantId", "sourceCategoryId", "sortOrder", "targetCategoryId");

-- CreateIndex
CREATE INDEX "CategoryComplementaryRelation_tenantId_targetCategoryId_idx"
    ON "CategoryComplementaryRelation"("tenantId", "targetCategoryId");

-- CreateIndex
CREATE INDEX "Order_tenantId_paymentStatus_createdAt_status_idx"
    ON "Order"("tenantId", "paymentStatus", "createdAt" DESC, "status");

-- CreateIndex
CREATE INDEX "OrderItem_productId_orderId_idx"
    ON "OrderItem"("productId", "orderId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_productId_idx"
    ON "OrderItem"("orderId", "productId");

-- AddForeignKey
ALTER TABLE "CategoryComplementaryRelation"
    ADD CONSTRAINT "CategoryComplementaryRelation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryComplementaryRelation"
    ADD CONSTRAINT "CategoryComplementaryRelation_tenantId_sourceCategoryId_fkey"
    FOREIGN KEY ("tenantId", "sourceCategoryId") REFERENCES "Category"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryComplementaryRelation"
    ADD CONSTRAINT "CategoryComplementaryRelation_tenantId_targetCategoryId_fkey"
    FOREIGN KEY ("tenantId", "targetCategoryId") REFERENCES "Category"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
