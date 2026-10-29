-- Existing orders retain NULL: current coupons cannot establish historical terms.
ALTER TABLE "Order" ADD COLUMN "couponSnapshot" JSONB;
