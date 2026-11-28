BEGIN;

-- CreateEnum
CREATE TYPE "PromotionPublication" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "PromotionTemplate" AS ENUM ('BUY_X_GET_Y', 'ALL_REQUIRED', 'CROSS_PRODUCT', 'BUNDLE', 'SPEND_GET', 'MIX_MATCH', 'SELECT_GIFT', 'TIERED_QUANTITY', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "PromotionAudience" AS ENUM ('ALL', 'FIRST_TIME', 'RETURNING', 'SELECTED');

-- CreateTable
CREATE TABLE "PromotionCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "imageUrl" TEXT,
    "publication" "PromotionPublication" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "imageUrl" TEXT,
    "publication" "PromotionPublication" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "template" "PromotionTemplate" NOT NULL,
    "configuration" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "audience" "PromotionAudience" NOT NULL DEFAULT 'ALL',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "perOrderLimit" INTEGER NOT NULL DEFAULT 1,
    "perCustomerLimit" INTEGER,
    "globalLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionSelector" (
    "tenantId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "categoryId" TEXT,
    "brandId" TEXT,

    CONSTRAINT "PromotionSelector_pkey" PRIMARY KEY ("tenantId","promotionId","key")
);

-- CreateTable
CREATE TABLE "PromotionCustomer" (
    "tenantId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PromotionCustomer_pkey" PRIMARY KEY ("tenantId","promotionId","userId")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "tenantId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applications" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "merchandiseSavings" DECIMAL(14,4) NOT NULL,
    "shippingSavings" DECIMAL(14,4) NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("tenantId","promotionId","orderId")
);

-- CreateTable
CREATE TABLE "PromotionAllocation" (
    "tenantId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "discountAmount" DECIMAL(14,4) NOT NULL,
    "rewardQuantity" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "PromotionAllocation_pkey" PRIMARY KEY ("tenantId","promotionId","orderId","orderItemId")
);

-- CreateIndex
CREATE INDEX "PromotionCampaign_tenantId_publication_startsAt_endsAt_idx" ON "PromotionCampaign"("tenantId", "publication", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionCampaign_tenantId_id_key" ON "PromotionCampaign"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Promotion_tenantId_campaignId_idx" ON "Promotion"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "Promotion_tenantId_publication_startsAt_endsAt_idx" ON "Promotion"("tenantId", "publication", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_tenantId_id_key" ON "Promotion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PromotionSelector_tenantId_productId_idx" ON "PromotionSelector"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "PromotionSelector_productId_variantId_idx" ON "PromotionSelector"("productId", "variantId");

-- CreateIndex
CREATE INDEX "PromotionSelector_tenantId_categoryId_idx" ON "PromotionSelector"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "PromotionSelector_tenantId_brandId_idx" ON "PromotionSelector"("tenantId", "brandId");

-- CreateIndex
CREATE INDEX "PromotionCustomer_tenantId_userId_idx" ON "PromotionCustomer"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_tenantId_orderId_userId_idx" ON "PromotionRedemption"("tenantId", "orderId", "userId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_tenantId_promotionId_releasedAt_userId_idx" ON "PromotionRedemption"("tenantId", "promotionId", "releasedAt", "userId");

-- CreateIndex
CREATE INDEX "PromotionAllocation_orderId_orderItemId_idx" ON "PromotionAllocation"("orderId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_tenantId_id_key" ON "Brand"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_id_key" ON "Product"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_id_key" ON "ProductVariant"("productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_id_userId_key" ON "Order"("tenantId", "id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_id_key" ON "OrderItem"("orderId", "id");

-- AddForeignKey
ALTER TABLE "PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "PromotionCampaign"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSelector" ADD CONSTRAINT "PromotionSelector_tenantId_promotionId_fkey" FOREIGN KEY ("tenantId", "promotionId") REFERENCES "Promotion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSelector" ADD CONSTRAINT "PromotionSelector_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSelector" ADD CONSTRAINT "PromotionSelector_productId_variantId_fkey" FOREIGN KEY ("productId", "variantId") REFERENCES "ProductVariant"("productId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSelector" ADD CONSTRAINT "PromotionSelector_tenantId_categoryId_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "Category"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSelector" ADD CONSTRAINT "PromotionSelector_tenantId_brandId_fkey" FOREIGN KEY ("tenantId", "brandId") REFERENCES "Brand"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionCustomer" ADD CONSTRAINT "PromotionCustomer_tenantId_promotionId_fkey" FOREIGN KEY ("tenantId", "promotionId") REFERENCES "Promotion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionCustomer" ADD CONSTRAINT "PromotionCustomer_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMember"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_tenantId_promotionId_fkey" FOREIGN KEY ("tenantId", "promotionId") REFERENCES "Promotion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_tenantId_orderId_userId_fkey" FOREIGN KEY ("tenantId", "orderId", "userId") REFERENCES "Order"("tenantId", "id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAllocation" ADD CONSTRAINT "PromotionAllocation_tenantId_promotionId_orderId_fkey" FOREIGN KEY ("tenantId", "promotionId", "orderId") REFERENCES "PromotionRedemption"("tenantId", "promotionId", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAllocation" ADD CONSTRAINT "PromotionAllocation_orderId_orderItemId_fkey" FOREIGN KEY ("orderId", "orderItemId") REFERENCES "OrderItem"("orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_schedule_check"
  CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt"),
  ADD CONSTRAINT "PromotionCampaign_publication_check"
  CHECK (("publication" = 'DRAFT') = ("publishedAt" IS NULL));

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_schedule_check"
  CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt"),
  ADD CONSTRAINT "Promotion_publication_check"
  CHECK (("publication" = 'DRAFT') = ("publishedAt" IS NULL)),
  ADD CONSTRAINT "Promotion_limits_check"
  CHECK ("perOrderLimit" > 0 AND ("perCustomerLimit" IS NULL OR "perCustomerLimit" > 0)
    AND ("globalLimit" IS NULL OR "globalLimit" > 0)),
  ADD CONSTRAINT "Promotion_configuration_check"
  CHECK (jsonb_typeof("configuration") = 'object'
    AND ("configuration"->>'template' = "template"::text) IS TRUE
    AND ("configuration"->'version' = '1'::jsonb) IS TRUE);

ALTER TABLE "PromotionSelector" ADD CONSTRAINT "PromotionSelector_target_check"
  CHECK (num_nonnulls("productId", "categoryId", "brandId") = 1
    AND ("variantId" IS NULL OR "productId" IS NOT NULL));

ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_amounts_check"
  CHECK ("applications" > 0
    AND "merchandiseSavings" BETWEEN 0 AND 9999999999.9999
    AND "shippingSavings" BETWEEN 0 AND 9999999999.9999
    AND ("releasedAt" IS NULL OR "releasedAt" >= "createdAt"));

ALTER TABLE "PromotionAllocation" ADD CONSTRAINT "PromotionAllocation_amounts_check"
  CHECK ("discountAmount" BETWEEN 0 AND 9999999999.9999 AND "rewardQuantity" >= 0);

-- Publication freezes all fields beyond editorial presentation and lifecycle controls.
CREATE FUNCTION enforce_promotion_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."publishedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Published promotions and campaigns cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."publishedAt" IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['titleAr', 'titleEn', 'descriptionAr', 'descriptionEn', 'imageUrl', 'publication', 'updatedAt'])
        IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['titleAr', 'titleEn', 'descriptionAr', 'descriptionEn', 'imageUrl', 'publication', 'updatedAt'])
       OR NEW."publication" = 'DRAFT'
       OR (OLD."publication" = 'ENDED' AND NEW."publication" <> 'ENDED') THEN
      RAISE EXCEPTION 'Published terms or terminal lifecycle cannot be changed' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."publication" NOT IN ('PUBLISHED', 'DRAFT') THEN
    RAISE EXCEPTION 'Only publication can transition a draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Promotion_publication_guard" BEFORE UPDATE OR DELETE ON "Promotion"
  FOR EACH ROW EXECUTE FUNCTION enforce_promotion_publication();
CREATE TRIGGER "PromotionCampaign_publication_guard" BEFORE UPDATE OR DELETE ON "PromotionCampaign"
  FOR EACH ROW EXECUTE FUNCTION enforce_promotion_publication();

-- Serialize target edits and publication through the parent row.
CREATE FUNCTION enforce_promotion_target_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  published_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."tenantId", NEW."promotionId") IS DISTINCT FROM (OLD."tenantId", OLD."promotionId") THEN
    RAISE EXCEPTION 'Promotion targets cannot be moved between definitions' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT "publishedAt" INTO published_at FROM "Promotion"
      WHERE "tenantId" = OLD."tenantId" AND "id" = OLD."promotionId" FOR UPDATE;
  ELSE
    SELECT "publishedAt" INTO published_at FROM "Promotion"
      WHERE "tenantId" = NEW."tenantId" AND "id" = NEW."promotionId" FOR UPDATE;
  END IF;
  IF published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Published promotion targets cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PromotionSelector_draft_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PromotionSelector"
  FOR EACH ROW EXECUTE FUNCTION enforce_promotion_target_draft();
CREATE TRIGGER "PromotionCustomer_draft_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PromotionCustomer"
  FOR EACH ROW EXECUTE FUNCTION enforce_promotion_target_draft();

CREATE FUNCTION enforce_promotion_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'PromotionRedemption' THEN
    IF (to_jsonb(OLD)->>'releasedAt') IS NULL
      AND (to_jsonb(NEW)->>'releasedAt') IS NOT NULL
      AND (to_jsonb(OLD) - 'releasedAt') = (to_jsonb(NEW) - 'releasedAt') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Promotion financial evidence is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "PromotionRedemption_evidence_guard" BEFORE UPDATE OR DELETE ON "PromotionRedemption"
  FOR EACH ROW EXECUTE FUNCTION enforce_promotion_evidence();
CREATE TRIGGER "PromotionAllocation_evidence_guard" BEFORE UPDATE OR DELETE ON "PromotionAllocation"
  FOR EACH ROW EXECUTE FUNCTION enforce_promotion_evidence();

COMMIT;
