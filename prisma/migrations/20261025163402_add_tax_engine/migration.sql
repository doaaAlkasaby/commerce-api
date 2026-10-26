/*
  Warnings:

  - Added the required column `taxAmount` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taxableAmount` to the `OrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxCountryCode" TEXT,
ADD COLUMN     "taxProfileSnapshot" JSONB,
ADD COLUMN     "taxRegionCode" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "taxAmount" DECIMAL(12,2),
ADD COLUMN     "taxCategoryCode" TEXT,
ADD COLUMN     "taxRate" DECIMAL(5,2),
ADD COLUMN     "taxTreatment" "TaxTreatment",
ADD COLUMN     "taxableAmount" DECIMAL(12,2);

-- Backfill existing order items as untaxed, using their stored total as taxable value.
UPDATE "OrderItem"
SET "taxAmount" = 0,
    "taxableAmount" = "totalPrice";

ALTER TABLE "OrderItem"
ALTER COLUMN "taxAmount" SET NOT NULL,
ALTER COLUMN "taxableAmount" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxCategoryId" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "taxCategoryId" TEXT;

-- CreateTable
CREATE TABLE "TaxCategory" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "treatment" "TaxTreatment" NOT NULL DEFAULT 'STANDARD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "taxCategoryId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regionCode" TEXT,
    "rate" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regionCode" TEXT,
    "taxRegistrationNumber" TEXT,
    "isTaxRegistered" BOOLEAN NOT NULL DEFAULT false,
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true,
    "defaultTaxCategoryId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxCategory_scopeKey_idx" ON "TaxCategory"("scopeKey");

-- CreateIndex
CREATE INDEX "TaxCategory_isActive_idx" ON "TaxCategory"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCategory_scopeKey_code_key" ON "TaxCategory"("scopeKey", "code");

-- CreateIndex
CREATE INDEX "TaxRule_taxCategoryId_idx" ON "TaxRule"("taxCategoryId");

-- CreateIndex
CREATE INDEX "TaxRule_countryCode_idx" ON "TaxRule"("countryCode");

-- CreateIndex
CREATE INDEX "TaxRule_countryCode_regionCode_idx" ON "TaxRule"("countryCode", "regionCode");

-- CreateIndex
CREATE INDEX "TaxRule_isActive_idx" ON "TaxRule"("isActive");

-- CreateIndex
CREATE INDEX "TaxRule_effectiveFrom_effectiveTo_idx" ON "TaxRule"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "TaxProfile_scopeKey_key" ON "TaxProfile"("scopeKey");

-- CreateIndex
CREATE INDEX "TaxProfile_countryCode_idx" ON "TaxProfile"("countryCode");

-- CreateIndex
CREATE INDEX "TaxProfile_isActive_idx" ON "TaxProfile"("isActive");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_defaultTaxCategoryId_fkey" FOREIGN KEY ("defaultTaxCategoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
