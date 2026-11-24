-- Additive forward-only refund ledger foundation (Phase 2D.12 Step 2A).
-- Preserves all existing Payment, Order, and MyFatoorahInvoice data without backfill.

-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM (
    'REQUESTED',
    'SUBMITTED',
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'RECONCILIATION_REQUIRED'
);

-- Non-destructive composite unique index on Payment(orderId, id) to support
-- database-enforced (orderId, paymentId) foreign-key integrity on PaymentRefund.
-- Guaranteed conflict-free because Payment.id is already the primary key.
CREATE UNIQUE INDEX "Payment_orderId_id_key" ON "Payment"("orderId", "id");

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "providerRefundReference" TEXT,
    "providerRefundInvoiceId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "providerMetadata" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "reconciliationReason" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_tenantId_paymentId_idempotencyKey_key" ON "PaymentRefund"("tenantId", "paymentId", "idempotencyKey");
CREATE UNIQUE INDEX "PaymentRefund_tenantId_provider_providerRefundId_key" ON "PaymentRefund"("tenantId", "provider", "providerRefundId");
CREATE UNIQUE INDEX "PaymentRefund_tenantId_provider_providerRefundReference_key" ON "PaymentRefund"("tenantId", "provider", "providerRefundReference");
CREATE INDEX "PaymentRefund_tenantId_paymentId_status_idx" ON "PaymentRefund"("tenantId", "paymentId", "status");
CREATE INDEX "PaymentRefund_tenantId_orderId_createdAt_idx" ON "PaymentRefund"("tenantId", "orderId", "createdAt");
CREATE INDEX "PaymentRefund_status_updatedAt_idx" ON "PaymentRefund"("status", "updatedAt");
CREATE INDEX "PaymentRefund_requestedByUserId_idx" ON "PaymentRefund"("requestedByUserId");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_orderId_paymentId_fkey" FOREIGN KEY ("orderId", "paymentId") REFERENCES "Payment"("orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial and audit CHECK constraints (cumulative capacity is enforced transactionally in Step 2B).
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_amount_positive_check"
    CHECK ("amount" > 0 AND "amount" <= 9999999999.9999);
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_currency_iso_check"
    CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_required_audit_text_check"
    CHECK (
        char_length(btrim("idempotencyKey")) BETWEEN 1 AND 128
        AND char_length(btrim("requestFingerprint")) >= 1
        AND char_length(btrim("reason")) BETWEEN 1 AND 500
        AND ("providerRefundId" IS NULL OR char_length(btrim("providerRefundId")) >= 1)
        AND ("providerRefundReference" IS NULL OR char_length(btrim("providerRefundReference")) >= 1)
        AND ("providerRefundInvoiceId" IS NULL OR char_length(btrim("providerRefundInvoiceId")) >= 1)
    );
