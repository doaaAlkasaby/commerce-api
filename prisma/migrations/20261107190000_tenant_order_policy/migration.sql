BEGIN;

-- CreateTable
CREATE TABLE "TenantOrderPolicy" (
    "tenantId" TEXT NOT NULL,
    "minOrderAmount" DECIMAL(14,4),
    "maxOrderAmount" DECIMAL(14,4),
    "maxOrderItems" INTEGER,
    "maxDistinctItems" INTEGER,
    "maxQuantityPerItem" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantOrderPolicy_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "TenantOrderPolicy" ADD CONSTRAINT "TenantOrderPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantOrderPolicy" ADD CONSTRAINT "TenantOrderPolicy_limits_check" CHECK (
  ("minOrderAmount" IS NULL OR "minOrderAmount" >= 0) AND
  ("maxOrderAmount" IS NULL OR "maxOrderAmount" >= 0) AND
  ("minOrderAmount" IS NULL OR "maxOrderAmount" IS NULL OR "maxOrderAmount" >= "minOrderAmount") AND
  ("maxOrderItems" IS NULL OR "maxOrderItems" > 0) AND
  ("maxDistinctItems" IS NULL OR "maxDistinctItems" > 0) AND
  ("maxQuantityPerItem" IS NULL OR "maxQuantityPerItem" > 0)
);

COMMIT;
