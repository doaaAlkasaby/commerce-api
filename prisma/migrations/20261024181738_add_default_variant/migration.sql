-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isDefault_idx" ON "ProductVariant"("productId", "isDefault");
