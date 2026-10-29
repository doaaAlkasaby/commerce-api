CREATE TYPE "PaymentInitiationState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'INITIATED', 'UNKNOWN');
-- Never infer that a historical payment has not already reached a provider.
ALTER TABLE "Payment" ADD COLUMN "initiationState" "PaymentInitiationState" NOT NULL DEFAULT 'UNKNOWN';
