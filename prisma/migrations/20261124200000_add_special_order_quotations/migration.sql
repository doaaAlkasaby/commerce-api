-- CreateEnum
CREATE TYPE "SpecialOrderQuotationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "SpecialOrderQuotationItemType" AS ENUM ('AVAILABLE', 'SUGGESTED');

-- CreateTable
CREATE TABLE "SpecialOrderQuotation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "status" "SpecialOrderQuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "taxCountryCode" TEXT NOT NULL,
    "sourcingDays" INTEGER NOT NULL,
    "validityHours" INTEGER NOT NULL DEFAULT 48,
    "notes" TEXT,
    "sourcingFee" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "sourcingFeeDescription" TEXT,
    "sourcingFeeTax" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "SpecialOrderQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderQuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "type" "SpecialOrderQuotationItemType" NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "specifications" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "requestedItemId" TEXT,
    "offeredQuantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "pricesIncludeTax" BOOLEAN NOT NULL,
    "tax" JSONB NOT NULL,
    "notes" TEXT,
    "image" BYTEA,
    "imageContentType" TEXT,

    CONSTRAINT "SpecialOrderQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderAcceptance" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "selectionKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderQuotation_requestId_isDraft_key" ON "SpecialOrderQuotation"("requestId", "isDraft");

-- CreateIndex
CREATE INDEX "SpecialOrderQuotationItem_quotationId_position_idx" ON "SpecialOrderQuotationItem"("quotationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderAcceptance_quotationId_key" ON "SpecialOrderAcceptance"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderRequest_tenantId_id_key" ON "SpecialOrderRequest"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "SpecialOrderQuotation" ADD CONSTRAINT "SpecialOrderQuotation_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "SpecialOrderRequest"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderQuotationItem" ADD CONSTRAINT "SpecialOrderQuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SpecialOrderQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderAcceptance" ADD CONSTRAINT "SpecialOrderAcceptance_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SpecialOrderQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the draft slot and publication metadata consistent.
ALTER TABLE "SpecialOrderQuotation"
  ADD CONSTRAINT "SpecialOrderQuotation_state_check" CHECK (
    ("isDraft" AND "status" = 'DRAFT' AND "publishedAt" IS NULL AND "expiresAt" IS NULL)
    OR (NOT "isDraft" AND "status" IN ('PUBLISHED', 'ACCEPTED') AND "publishedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "publishedAt")
  ),
  ADD CONSTRAINT "SpecialOrderQuotation_terms_check" CHECK (
    "version" > 0 AND "sourcingFee" >= 0 AND "sourcingDays" BETWEEN 0 AND 365 AND "validityHours" BETWEEN 1 AND 720
  );

ALTER TABLE "SpecialOrderQuotationItem"
  ADD CONSTRAINT "SpecialOrderQuotationItem_terms_check" CHECK (
    "offeredQuantity" BETWEEN 1 AND 10000 AND "unitPrice" >= 0 AND "position" >= 0
  );
