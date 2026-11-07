-- Shared, atomic request budgets; no existing data is rewritten.
CREATE TABLE "RateLimitBucket" (
 "key" TEXT NOT NULL PRIMARY KEY,
 "hits" INTEGER NOT NULL,
 "resetAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");
