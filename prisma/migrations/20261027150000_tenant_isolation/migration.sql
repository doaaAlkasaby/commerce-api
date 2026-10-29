-- Scope tenant-owned identifiers and per-user resources to a tenant.
-- Existing carts, wishlists, and collections are assigned from their related
-- products. Ambiguous multi-tenant data aborts the migration for manual review.

CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "TenantMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'CUSTOMER');
CREATE TYPE "TenantMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED');

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "legalName" TEXT,
  "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  "defaultCountryCode" TEXT,
  "defaultCurrency" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "logoStorageKey" TEXT,
  "logoUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
CREATE INDEX "Tenant_defaultCountryCode_idx" ON "Tenant"("defaultCountryCode");
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_defaultCountryCode_fkey"
  FOREIGN KEY ("defaultCountryCode") REFERENCES "Country"("code") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TenantMember" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "TenantMemberRole" NOT NULL DEFAULT 'CUSTOMER',
  "status" "TenantMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenantMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TenantMember_tenantId_userId_key" ON "TenantMember"("tenantId", "userId");
CREATE INDEX "TenantMember_tenantId_idx" ON "TenantMember"("tenantId");
CREATE INDEX "TenantMember_userId_idx" ON "TenantMember"("userId");
CREATE INDEX "TenantMember_tenantId_role_idx" ON "TenantMember"("tenantId", "role");
CREATE INDEX "TenantMember_tenantId_status_idx" ON "TenantMember"("tenantId", "status");

INSERT INTO "Tenant" ("id", "name", "slug", "code", "updatedAt")
VALUES ('legacy-default-tenant', 'Legacy tenant', 'legacy-default', 'LEGACY', CURRENT_TIMESTAMP);

-- Preserve existing access to the legacy tenant while moving authorization
-- from global user roles to tenant memberships.
INSERT INTO "TenantMember" ("id", "tenantId", "userId", "role", "status", "updatedAt")
SELECT
  'legacy-member-' || u."id",
  'legacy-default-tenant',
  u."id",
  CASE u."role"::text
    WHEN 'ADMIN' THEN 'ADMIN'::"TenantMemberRole"
    WHEN 'MANAGER' THEN 'MANAGER'::"TenantMemberRole"
    ELSE 'CUSTOMER'::"TenantMemberRole"
  END,
  'ACTIVE'::"TenantMemberStatus",
  CURRENT_TIMESTAMP
FROM "User" u;

-- Existing tenant-owned rows remain together under a single legacy tenant.
ALTER TABLE "Category" ADD COLUMN "tenantId" TEXT;
UPDATE "Category" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "Category" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Brand" ADD COLUMN "tenantId" TEXT;
UPDATE "Brand" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "Brand" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Product" ADD COLUMN "tenantId" TEXT;
UPDATE "Product" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "Product" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Coupon" ADD COLUMN "tenantId" TEXT;
UPDATE "Coupon" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "Coupon" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Order" ADD COLUMN "tenantId" TEXT;
UPDATE "Order" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "Order" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Order" ADD COLUMN "shippingDistanceKm" DECIMAL(10,2);
ALTER TABLE "OrderItem" ADD COLUMN "taxCategoryId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "taxRuleId" TEXT;
ALTER TABLE "Banner" ADD COLUMN "tenantId" TEXT;
UPDATE "Banner" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "Banner" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "AppSetting" ADD COLUMN "tenantId" TEXT;
UPDATE "AppSetting" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "AppSetting" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "TaxCategory" ADD COLUMN "tenantId" TEXT;
UPDATE "TaxCategory" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "TaxCategory" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "TaxProfile" ADD COLUMN "tenantId" TEXT;
UPDATE "TaxProfile" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "TaxProfile" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ShippingProfile" ADD COLUMN "tenantId" TEXT;
UPDATE "ShippingProfile" SET "tenantId" = 'legacy-default-tenant';
ALTER TABLE "ShippingProfile" ALTER COLUMN "tenantId" SET NOT NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['Category','Brand','Product','Coupon','Banner','AppSetting','TaxCategory','TaxProfile','ShippingProfile'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE', t, t || '_tenantId_fkey');
    EXECUTE format('CREATE INDEX %I ON %I ("tenantId")', t || '_tenantId_idx', t);
  END LOOP;
END $$;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bring tax keys in line with the tenant-owned Prisma schema. Rows from the
-- legacy installation are still assigned to one tenant; duplicate codes or
-- overlapping country/region profiles must be reviewed before migration.
-- Legacy scopeKey columns stay nullable so their existing values are retained.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "TaxCategory" GROUP BY "tenantId", "code" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate TaxCategory codes exist within a tenant. Rename duplicates before retrying.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TaxProfile" GROUP BY "tenantId", "countryCode", "regionCode" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate TaxProfile country/region scopes exist within a tenant. Consolidate them before retrying.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TaxProfile" tp LEFT JOIN "Country" c ON c."code" = tp."countryCode" WHERE c."code" IS NULL
  ) THEN
    RAISE EXCEPTION 'TaxProfile country codes are missing from Country. Seed those countries before retrying.';
  END IF;
END $$;
DROP INDEX "TaxCategory_scopeKey_code_key";
DROP INDEX "TaxCategory_scopeKey_idx";
ALTER TABLE "TaxCategory" ALTER COLUMN "scopeKey" DROP NOT NULL;
DROP INDEX "TaxProfile_scopeKey_key";
ALTER TABLE "TaxProfile" ALTER COLUMN "scopeKey" DROP NOT NULL;
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_countryCode_fkey"
  FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TaxCategory_tenantId_code_key" ON "TaxCategory"("tenantId", "code");
CREATE INDEX "TaxCategory_tenantId_isActive_idx" ON "TaxCategory"("tenantId", "isActive");
CREATE UNIQUE INDEX "TaxProfile_tenantId_countryCode_regionCode_key" ON "TaxProfile"("tenantId", "countryCode", "regionCode");
CREATE INDEX "TaxProfile_tenantId_countryCode_idx" ON "TaxProfile"("tenantId", "countryCode");

-- Shipping profiles in the old schema could contain zones for several
-- countries. The current schema is one profile per tenant/country, so refuse
-- ambiguous profiles and require those rows to be split manually first.
-- Legacy scopeKey/name fields are retained as nullable columns for data review.
ALTER TABLE "ShippingProfile" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "ShippingProfile" ADD COLUMN "originLatitude" DECIMAL(10,7);
ALTER TABLE "ShippingProfile" ADD COLUMN "originLongitude" DECIMAL(10,7);
UPDATE "ShippingProfile" sp
SET "countryCode" = (
  SELECT MIN(sz."countryCode") FROM "ShippingZone" sz
  WHERE sz."shippingProfileId" = sp."id"
  HAVING COUNT(DISTINCT sz."countryCode") = 1
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ShippingProfile" WHERE "countryCode" IS NULL) THEN
    RAISE EXCEPTION 'ShippingProfile rows have no zones or span multiple countries. Split/assign zones and set a profile country before retrying.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ShippingProfile" GROUP BY "tenantId", "countryCode" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple ShippingProfile rows exist for one tenant/country. Consolidate them before retrying.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ShippingProfile" sp LEFT JOIN "Country" c ON c."code" = sp."countryCode" WHERE c."code" IS NULL
  ) THEN
    RAISE EXCEPTION 'ShippingProfile country codes are missing from Country. Seed those countries before retrying.';
  END IF;
END $$;
ALTER TABLE "ShippingProfile" ALTER COLUMN "countryCode" SET NOT NULL;
DROP INDEX "ShippingProfile_scopeKey_key";
ALTER TABLE "ShippingProfile" ALTER COLUMN "scopeKey" DROP NOT NULL;
ALTER TABLE "ShippingProfile" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "ShippingZone" RENAME COLUMN "shippingProfileId" TO "profileId";
ALTER TABLE "ShippingZone" RENAME CONSTRAINT "ShippingZone_shippingProfileId_fkey" TO "ShippingZone_profileId_fkey";
ALTER TABLE "ShippingZone" ADD COLUMN "code" TEXT;
UPDATE "ShippingZone" SET "code" = 'legacy-' || replace("id", '-', '');
ALTER TABLE "ShippingZone" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "ShippingMethod" RENAME COLUMN "shippingZoneId" TO "zoneId";
ALTER TABLE "ShippingMethod" RENAME CONSTRAINT "ShippingMethod_shippingZoneId_fkey" TO "ShippingMethod_zoneId_fkey";
ALTER TABLE "ShippingRule" RENAME COLUMN "shippingMethodId" TO "methodId";
ALTER TABLE "ShippingRule" RENAME CONSTRAINT "ShippingRule_shippingMethodId_fkey" TO "ShippingRule_methodId_fkey";
ALTER TABLE "ShippingRule" RENAME COLUMN "shippingAmount" TO "flatRate";
ALTER TABLE "ShippingRule" ADD COLUMN "rateType" "ShippingRateType" NOT NULL DEFAULT 'FLAT';
UPDATE "ShippingRule" sr SET "rateType" = sm."rateType"
FROM "ShippingMethod" sm WHERE sr."methodId" = sm."id";
ALTER TABLE "ShippingRule" ADD COLUMN "maxDistanceKm" DECIMAL(10,2);
ALTER TABLE "ShippingMethod" DROP COLUMN "rateType";
ALTER TABLE "ShippingProfile" ADD CONSTRAINT "ShippingProfile_countryCode_fkey"
  FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ShippingProfile_tenantId_countryCode_key" ON "ShippingProfile"("tenantId", "countryCode");
CREATE INDEX "ShippingProfile_countryCode_idx" ON "ShippingProfile"("countryCode");
CREATE UNIQUE INDEX "ShippingZone_profileId_code_key" ON "ShippingZone"("profileId", "code");
CREATE INDEX "ShippingZone_profileId_idx" ON "ShippingZone"("profileId");
ALTER INDEX "ShippingMethod_shippingZoneId_code_key" RENAME TO "ShippingMethod_zoneId_code_key";
ALTER INDEX "ShippingMethod_shippingZoneId_idx" RENAME TO "ShippingMethod_zoneId_idx";
ALTER INDEX "ShippingRule_shippingMethodId_idx" RENAME TO "ShippingRule_methodId_idx";
CREATE INDEX "ShippingRule_priority_idx" ON "ShippingRule"("priority");

ALTER TABLE "Cart" ADD COLUMN "tenantId" TEXT;
UPDATE "Cart" c
SET "tenantId" = (
  SELECT MIN(p."tenantId")
  FROM "CartItem" ci
  JOIN "ProductVariant" pv ON pv."id" = ci."variantId"
  JOIN "Product" p ON p."id" = pv."productId"
  WHERE ci."cartId" = c."id"
  HAVING COUNT(DISTINCT p."tenantId") = 1
);
UPDATE "Cart" c
SET "tenantId" = (
  SELECT MIN(tm."tenantId")
  FROM "TenantMember" tm
  WHERE tm."userId" = c."userId" AND tm."status" = 'ACTIVE'
  HAVING COUNT(DISTINCT tm."tenantId") = 1
)
WHERE c."tenantId" IS NULL;
UPDATE "Cart"
SET "tenantId" = (SELECT MIN("id") FROM "Tenant")
WHERE "tenantId" IS NULL
  AND (SELECT COUNT(*) FROM "Tenant") = 1;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Cart" WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign tenant to existing Cart rows. Resolve multi-tenant cart items or user memberships, then retry.';
  END IF;
END $$;
ALTER TABLE "Cart" ALTER COLUMN "tenantId" SET NOT NULL;
DROP INDEX "Cart_userId_key";
CREATE UNIQUE INDEX "Cart_tenantId_userId_key" ON "Cart"("tenantId", "userId");
CREATE INDEX "Cart_tenantId_idx" ON "Cart"("tenantId");
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductCollection" ADD COLUMN "tenantId" TEXT;
UPDATE "ProductCollection" c
SET "tenantId" = (
  SELECT MIN(p."tenantId")
  FROM "ProductCollectionItem" ci
  JOIN "Product" p ON p."id" = ci."productId"
  WHERE ci."collectionId" = c."id"
  HAVING COUNT(DISTINCT p."tenantId") = 1
);
UPDATE "ProductCollection"
SET "tenantId" = (SELECT MIN("id") FROM "Tenant")
WHERE "tenantId" IS NULL
  AND (SELECT COUNT(*) FROM "Tenant") = 1;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ProductCollection" WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign tenant to existing ProductCollection rows. Split collections containing products from multiple tenants, then retry.';
  END IF;
END $$;
ALTER TABLE "ProductCollection" ALTER COLUMN "tenantId" SET NOT NULL;
DROP INDEX "ProductCollection_slug_key";
CREATE UNIQUE INDEX "ProductCollection_tenantId_slug_key" ON "ProductCollection"("tenantId", "slug");
CREATE INDEX "ProductCollection_tenantId_isActive_idx" ON "ProductCollection"("tenantId", "isActive");
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Wishlist" ADD COLUMN "tenantId" TEXT;
UPDATE "Wishlist" w
SET "tenantId" = (
  SELECT MIN(p."tenantId")
  FROM "WishlistItem" wi
  JOIN "Product" p ON p."id" = wi."productId"
  WHERE wi."wishlistId" = w."id"
  HAVING COUNT(DISTINCT p."tenantId") = 1
);
UPDATE "Wishlist" w
SET "tenantId" = (
  SELECT MIN(tm."tenantId")
  FROM "TenantMember" tm
  WHERE tm."userId" = w."userId" AND tm."status" = 'ACTIVE'
  HAVING COUNT(DISTINCT tm."tenantId") = 1
)
WHERE w."tenantId" IS NULL;
UPDATE "Wishlist"
SET "tenantId" = (SELECT MIN("id") FROM "Tenant")
WHERE "tenantId" IS NULL
  AND (SELECT COUNT(*) FROM "Tenant") = 1;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Wishlist" WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign tenant to existing Wishlist rows. Split wishlists containing products from multiple tenants, then retry.';
  END IF;
END $$;
ALTER TABLE "Wishlist" ALTER COLUMN "tenantId" SET NOT NULL;
DROP INDEX "Wishlist_userId_key";
CREATE UNIQUE INDEX "Wishlist_tenantId_userId_key" ON "Wishlist"("tenantId", "userId");
CREATE INDEX "Wishlist_tenantId_idx" ON "Wishlist"("tenantId");
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "Category_slug_key";
DROP INDEX "Brand_slug_key";
DROP INDEX "Product_slug_key";
DROP INDEX "Coupon_code_key";
DROP INDEX "AppSetting_key_key";
DROP INDEX "Order_orderNumber_key";
CREATE UNIQUE INDEX "AppSetting_tenantId_key_key" ON "AppSetting"("tenantId", "key");
CREATE UNIQUE INDEX "Category_tenantId_slug_key" ON "Category"("tenantId", "slug");
CREATE UNIQUE INDEX "Brand_tenantId_slug_key" ON "Brand"("tenantId", "slug");
CREATE UNIQUE INDEX "Product_tenantId_slug_key" ON "Product"("tenantId", "slug");
CREATE UNIQUE INDEX "Coupon_tenantId_code_key" ON "Coupon"("tenantId", "code");
CREATE UNIQUE INDEX "Order_tenantId_orderNumber_key" ON "Order"("tenantId", "orderNumber");
CREATE INDEX "Order_tenantId_idx" ON "Order"("tenantId");
CREATE INDEX "Order_tenantId_userId_idx" ON "Order"("tenantId", "userId");
CREATE INDEX "Order_tenantId_createdAt_idx" ON "Order"("tenantId", "createdAt");
CREATE INDEX "Order_tenantId_status_idx" ON "Order"("tenantId", "status");
CREATE INDEX "Order_tenantId_paymentStatus_idx" ON "Order"("tenantId", "paymentStatus");
CREATE INDEX "Product_tenantId_categoryId_idx" ON "Product"("tenantId", "categoryId");
CREATE INDEX "Product_tenantId_brandId_idx" ON "Product"("tenantId", "brandId");
CREATE INDEX "Product_tenantId_status_idx" ON "Product"("tenantId", "status");
CREATE INDEX "Product_tenantId_createdAt_idx" ON "Product"("tenantId", "createdAt");
CREATE INDEX "Category_tenantId_parentId_idx" ON "Category"("tenantId", "parentId");
CREATE INDEX "Category_tenantId_isActive_idx" ON "Category"("tenantId", "isActive");
CREATE INDEX "Brand_tenantId_isActive_idx" ON "Brand"("tenantId", "isActive");
CREATE INDEX "Coupon_tenantId_isActive_idx" ON "Coupon"("tenantId", "isActive");
CREATE INDEX "Banner_tenantId_isActive_idx" ON "Banner"("tenantId", "isActive");
CREATE INDEX "Banner_tenantId_sortOrder_idx" ON "Banner"("tenantId", "sortOrder");
CREATE INDEX "Banner_tenantId_startsAt_idx" ON "Banner"("tenantId", "startsAt");
CREATE INDEX "Banner_tenantId_endsAt_idx" ON "Banner"("tenantId", "endsAt");
CREATE INDEX "AppSetting_tenantId_isPublic_idx" ON "AppSetting"("tenantId", "isPublic");
