-- CreateEnum
CREATE TYPE "SpecialOrderRequestStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'ORDER_CREATED');

-- CreateTable
CREATE TABLE "SpecialOrderRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "notes" TEXT,
    "status" "SpecialOrderRequestStatus" NOT NULL DEFAULT 'NEW',
    "rejectionReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialOrderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "specifications" TEXT,
    "productId" TEXT,
    "variantId" TEXT,

    CONSTRAINT "SpecialOrderRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialOrderRequest_tenantId_customerId_createdAt_idx" ON "SpecialOrderRequest"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SpecialOrderRequest_tenantId_status_createdAt_idx" ON "SpecialOrderRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SpecialOrderRequest_tenantId_createdAt_idx" ON "SpecialOrderRequest"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderRequest_tenantId_number_key" ON "SpecialOrderRequest"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderRequest_tenantId_customerId_idempotencyKey_key" ON "SpecialOrderRequest"("tenantId", "customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SpecialOrderRequestItem_productId_idx" ON "SpecialOrderRequestItem"("productId");

-- CreateIndex
CREATE INDEX "SpecialOrderRequestItem_variantId_idx" ON "SpecialOrderRequestItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderRequestItem_requestId_id_key" ON "SpecialOrderRequestItem"("requestId", "id");

-- CreateIndex
CREATE INDEX "SpecialOrderAttachment_requestId_itemId_idx" ON "SpecialOrderAttachment"("requestId", "itemId");

-- AddForeignKey
ALTER TABLE "SpecialOrderRequest" ADD CONSTRAINT "SpecialOrderRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderRequest" ADD CONSTRAINT "SpecialOrderRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderRequestItem" ADD CONSTRAINT "SpecialOrderRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SpecialOrderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderRequestItem" ADD CONSTRAINT "SpecialOrderRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderRequestItem" ADD CONSTRAINT "SpecialOrderRequestItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderAttachment" ADD CONSTRAINT "SpecialOrderAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SpecialOrderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderAttachment" ADD CONSTRAINT "SpecialOrderAttachment_requestId_itemId_fkey" FOREIGN KEY ("requestId", "itemId") REFERENCES "SpecialOrderRequestItem"("requestId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SpecialOrderRequest"
    ADD CONSTRAINT "SpecialOrderRequest_positive_number_check" CHECK ("number" > 1000),
    ADD CONSTRAINT "SpecialOrderRequest_history_array_check" CHECK (jsonb_typeof("history") = 'array');

ALTER TABLE "SpecialOrderRequestItem"
    ADD CONSTRAINT "SpecialOrderRequestItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 10000),
    ADD CONSTRAINT "SpecialOrderRequestItem_position_check" CHECK ("position" BETWEEN 0 AND 19);

ALTER TABLE "SpecialOrderAttachment"
    ADD CONSTRAINT "SpecialOrderAttachment_size_check" CHECK ("byteSize" BETWEEN 1 AND 3145728 AND "byteSize" = octet_length("content")),
    ADD CONSTRAINT "SpecialOrderAttachment_type_check" CHECK (
        "contentType" IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
        OR ("itemId" IS NULL AND "contentType" = 'application/pdf')
    );
