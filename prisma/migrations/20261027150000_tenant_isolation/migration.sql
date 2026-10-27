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
  FOREACH t IN ARRAY ARRAY['Category','Brand','Product','Coupon','Order','Banner','AppSetting','TaxCategory','TaxProfile','ShippingProfile'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE', t, t || '_tenantId_fkey');
    EXECUTE format('CREATE INDEX %I ON %I ("tenantId")', t || '_tenantId_idx', t);
  END LOOP;
END $$;

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
CREATE UNIQUE INDEX "Category_tenantId_slug_key" ON "Category"("tenantId", "slug");
CREATE UNIQUE INDEX "Brand_tenantId_slug_key" ON "Brand"("tenantId", "slug");
CREATE UNIQUE INDEX "Product_tenantId_slug_key" ON "Product"("tenantId", "slug");
CREATE UNIQUE INDEX "Coupon_tenantId_code_key" ON "Coupon"("tenantId", "code");
CREATE UNIQUE INDEX "Order_tenantId_orderNumber_key" ON "Order"("tenantId", "orderNumber");
