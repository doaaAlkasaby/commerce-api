-- CreateEnum
CREATE TYPE "SpecialOrderFulfillmentMethod" AS ENUM ('HOME_DELIVERY', 'STORE_PICKUP');

-- CreateEnum
CREATE TYPE "SpecialOrderState" AS ENUM ('PENDING_SOURCING');

-- AlterTable
ALTER TABLE "SpecialOrderAcceptance" ADD COLUMN     "consumedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SpecialOrderQuotation" ADD COLUMN     "paymentTerms" JSONB;

-- CreateTable
CREATE TABLE "SpecialOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "acceptanceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "state" "SpecialOrderState" NOT NULL DEFAULT 'PENDING_SOURCING',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillmentMethod" "SpecialOrderFulfillmentMethod" NOT NULL,
    "customerFirstName" TEXT NOT NULL,
    "customerLastName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "deliveryAddress" JSONB,
    "pickupLocation" JSONB,
    "shippingMethod" JSONB,
    "financials" JSONB NOT NULL,
    "grandTotal" DECIMAL(20,4) NOT NULL,
    "paymentTerms" JSONB NOT NULL,
    "initialPayment" DECIMAL(20,4) NOT NULL,
    "remainingBalance" DECIMAL(20,4) NOT NULL,
    "commercialTerms" JSONB NOT NULL,
    "sourcingDays" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quotationItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "specifications" TEXT,
    "notes" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "pricesIncludeTax" BOOLEAN NOT NULL,
    "tax" JSONB NOT NULL,
    "subtotalBeforeTax" DECIMAL(20,4) NOT NULL,
    "taxAmount" DECIMAL(20,4) NOT NULL,
    "totalIncludingTax" DECIMAL(20,4) NOT NULL,
    "hasImage" BOOLEAN NOT NULL,

    CONSTRAINT "SpecialOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrder_requestId_key" ON "SpecialOrder"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrder_acceptanceId_key" ON "SpecialOrder"("acceptanceId");

-- CreateIndex
CREATE INDEX "SpecialOrder_tenantId_customerId_createdAt_idx" ON "SpecialOrder"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SpecialOrder_tenantId_state_createdAt_idx" ON "SpecialOrder"("tenantId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "SpecialOrder_tenantId_createdAt_idx" ON "SpecialOrder"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrder_tenantId_customerId_requestId_key" ON "SpecialOrder"("tenantId", "customerId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrder_tenantId_number_key" ON "SpecialOrder"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrder_tenantId_customerId_idempotencyKey_key" ON "SpecialOrder"("tenantId", "customerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderItem_quotationItemId_key" ON "SpecialOrderItem"("quotationItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderItem_orderId_position_key" ON "SpecialOrderItem"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderRequest_tenantId_customerId_id_key" ON "SpecialOrderRequest"("tenantId", "customerId", "id");

-- AddForeignKey
ALTER TABLE "SpecialOrder" ADD CONSTRAINT "SpecialOrder_tenantId_customerId_requestId_fkey" FOREIGN KEY ("tenantId", "customerId", "requestId") REFERENCES "SpecialOrderRequest"("tenantId", "customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrder" ADD CONSTRAINT "SpecialOrder_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "SpecialOrderAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderItem" ADD CONSTRAINT "SpecialOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SpecialOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderItem" ADD CONSTRAINT "SpecialOrderItem_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "SpecialOrderQuotationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve valid financial splits and fulfillment snapshots at the database boundary.
ALTER TABLE "SpecialOrder"
    ADD CONSTRAINT "SpecialOrder_payment_split_check" CHECK (
        "initialPayment" >= 0 AND "remainingBalance" >= 0
        AND "grandTotal" = "initialPayment" + "remainingBalance"
    ),
    ADD CONSTRAINT "SpecialOrder_fulfillment_snapshot_check" CHECK (
        ("fulfillmentMethod" = 'HOME_DELIVERY' AND "deliveryAddress" IS NOT NULL
         AND "shippingMethod" IS NOT NULL AND "pickupLocation" IS NULL)
        OR ("fulfillmentMethod" = 'STORE_PICKUP' AND "deliveryAddress" IS NULL
            AND "shippingMethod" IS NULL AND "pickupLocation" IS NOT NULL)
    );

ALTER TABLE "SpecialOrderItem"
    ADD CONSTRAINT "SpecialOrderItem_amounts_check" CHECK (
        "quantity" > 0 AND "unitPrice" >= 0 AND "subtotalBeforeTax" >= 0 AND "taxAmount" >= 0
        AND "totalIncludingTax" = "subtotalBeforeTax" + "taxAmount"
    );
