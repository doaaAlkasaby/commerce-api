-- CreateEnum
CREATE TYPE "ShippingRateType" AS ENUM ('FLAT', 'FREE');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingMethodCode" TEXT,
ADD COLUMN     "shippingMethodId" TEXT,
ADD COLUMN     "shippingMethodName" TEXT,
ADD COLUMN     "shippingProfileSnapshot" JSONB,
ADD COLUMN     "shippingRuleId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultCountryCode" TEXT;

-- CreateTable
CREATE TABLE "ShippingProfile" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "shippingProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regionCode" TEXT,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingMethod" (
    "id" TEXT NOT NULL,
    "shippingZoneId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rateType" "ShippingRateType" NOT NULL DEFAULT 'FLAT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRule" (
    "id" TEXT NOT NULL,
    "shippingMethodId" TEXT NOT NULL,
    "minOrderAmount" DECIMAL(12,2),
    "maxOrderAmount" DECIMAL(12,2),
    "shippingAmount" DECIMAL(12,2) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingProfile_scopeKey_key" ON "ShippingProfile"("scopeKey");

-- CreateIndex
CREATE INDEX "ShippingProfile_isActive_idx" ON "ShippingProfile"("isActive");

-- CreateIndex
CREATE INDEX "ShippingZone_shippingProfileId_idx" ON "ShippingZone"("shippingProfileId");

-- CreateIndex
CREATE INDEX "ShippingZone_countryCode_idx" ON "ShippingZone"("countryCode");

-- CreateIndex
CREATE INDEX "ShippingZone_countryCode_regionCode_idx" ON "ShippingZone"("countryCode", "regionCode");

-- CreateIndex
CREATE INDEX "ShippingZone_countryCode_regionCode_city_idx" ON "ShippingZone"("countryCode", "regionCode", "city");

-- CreateIndex
CREATE INDEX "ShippingZone_isActive_idx" ON "ShippingZone"("isActive");

-- CreateIndex
CREATE INDEX "ShippingMethod_shippingZoneId_idx" ON "ShippingMethod"("shippingZoneId");

-- CreateIndex
CREATE INDEX "ShippingMethod_isActive_idx" ON "ShippingMethod"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingMethod_shippingZoneId_code_key" ON "ShippingMethod"("shippingZoneId", "code");

-- CreateIndex
CREATE INDEX "ShippingRule_shippingMethodId_idx" ON "ShippingRule"("shippingMethodId");

-- CreateIndex
CREATE INDEX "ShippingRule_isActive_idx" ON "ShippingRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE INDEX "Country_isActive_idx" ON "Country"("isActive");

-- CreateIndex
CREATE INDEX "Country_currencyCode_idx" ON "Country"("currencyCode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultCountryCode_fkey" FOREIGN KEY ("defaultCountryCode") REFERENCES "Country"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingZone" ADD CONSTRAINT "ShippingZone_shippingProfileId_fkey" FOREIGN KEY ("shippingProfileId") REFERENCES "ShippingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingMethod" ADD CONSTRAINT "ShippingMethod_shippingZoneId_fkey" FOREIGN KEY ("shippingZoneId") REFERENCES "ShippingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRule" ADD CONSTRAINT "ShippingRule_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "ShippingMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
