-- Additive forward-only Migration 28 (Phase 2D.12 Step 2C-2A):
-- Provider Account Identity, Payment/Refund Account Binding, Durable Refund Attempts,
-- Refund Recovery Jobs, Refund Webhook Events, and Financial Conflict Audit.
-- Zero backfill: historical Payment, MyFatoorahInvoice, and PaymentRefund rows retain
-- NULL providerAccountId/providerEnvironment as explicitly unresolved legacy records.

-- CreateEnum
CREATE TYPE "PaymentProviderEnvironment" AS ENUM ('MOCK', 'SANDBOX', 'PRODUCTION');
CREATE TYPE "PaymentProviderAccountOwnership" AS ENUM ('TENANT_DEDICATED', 'PLATFORM_SHARED');
CREATE TYPE "PaymentProviderAccountStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'ROTATING', 'SUSPENDED', 'RETIRED');
CREATE TYPE "PaymentRefundAttemptOperation" AS ENUM ('SUBMIT_REFUND', 'LOOKUP_STATUS', 'RECONCILE');
CREATE TYPE "PaymentRefundAttemptState" AS ENUM ('PREPARED', 'DISPATCHING', 'SUCCEEDED', 'DEFINITIVELY_FAILED', 'AMBIGUOUS', 'ABANDONED');
CREATE TYPE "PaymentRefundRecoveryOperation" AS ENUM ('RECONCILE_SUBMISSION', 'POLL_REFUND_STATUS', 'MANUAL_REVIEW');
CREATE TYPE "PaymentRefundRecoveryJobState" AS ENUM ('READY', 'RUNNING', 'COMPLETED', 'MANUAL', 'CANCELLED');
CREATE TYPE "WebhookSignatureStatus" AS ENUM ('VALID', 'INVALID', 'MISSING', 'UNVERIFIED_ACCOUNT');
CREATE TYPE "RefundWebhookEventState" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'QUARANTINED_UNKNOWN_REFUND', 'QUARANTINED_CONFLICT', 'REJECTED_SIGNATURE');
CREATE TYPE "PaymentRefundConflictSource" AS ENUM ('PROVIDER_SUBMISSION', 'PROVIDER_STATUS_LOOKUP', 'WEBHOOK', 'INTERNAL_RECONCILIATION');
CREATE TYPE "PaymentRefundConflictType" AS ENUM ('TERMINAL_STATE_CONTRADICTION', 'PROVIDER_IDENTIFIER_CONFLICT', 'FINANCIAL_EVIDENCE_MISMATCH', 'ACCOUNT_ENVIRONMENT_MISMATCH', 'UNKNOWN_EXTERNAL_REFUND', 'DUPLICATE_EXTERNAL_REFERENCE', 'AMBIGUOUS_PROVIDER_OUTCOME');
CREATE TYPE "PaymentRefundConflictResolutionState" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateTable: PaymentProviderAccount
CREATE TABLE "PaymentProviderAccount" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" "PaymentProviderEnvironment" NOT NULL,
    "accountKey" TEXT NOT NULL,
    "ownershipMode" "PaymentProviderAccountOwnership" NOT NULL DEFAULT 'TENANT_DEDICATED',
    "ownerTenantId" TEXT,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentProviderAccountStatus" NOT NULL DEFAULT 'INACTIVE',
    "credentialRef" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialRotatedAt" TIMESTAMPTZ(3),
    "activatedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PaymentProviderAccountTenant
CREATE TABLE "PaymentProviderAccountTenant" (
    "tenantId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" "PaymentProviderEnvironment" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "authorizedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PaymentProviderAccountTenant_pkey" PRIMARY KEY ("tenantId","providerAccountId")
);

-- AlterTable: Payment (additive nullable columns only; zero backfill)
ALTER TABLE "Payment"
    ADD COLUMN "providerAccountId" TEXT,
    ADD COLUMN "providerEnvironment" "PaymentProviderEnvironment";

-- AlterTable: MyFatoorahInvoice (additive nullable columns only; zero backfill)
ALTER TABLE "MyFatoorahInvoice"
    ADD COLUMN "providerAccountId" TEXT,
    ADD COLUMN "providerEnvironment" "PaymentProviderEnvironment";

-- AlterTable: PaymentRefund (additive nullable columns only; replace tenant-only
-- provider ID uniqueness with stronger account-scoped + legacy-scoped partial unique indexes)
DROP INDEX "PaymentRefund_tenantId_provider_providerRefundId_key";
DROP INDEX "PaymentRefund_tenantId_provider_providerRefundReference_key";

ALTER TABLE "PaymentRefund"
    ADD COLUMN "providerAccountId" TEXT,
    ADD COLUMN "providerEnvironment" "PaymentProviderEnvironment";

-- CreateTable: PaymentRefundAttempt
CREATE TABLE "PaymentRefundAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountId" TEXT,
    "providerEnvironment" "PaymentProviderEnvironment",
    "attemptNumber" INTEGER NOT NULL,
    "operation" "PaymentRefundAttemptOperation" NOT NULL,
    "state" "PaymentRefundAttemptState" NOT NULL DEFAULT 'PREPARED',
    "correlationId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "dispatchOwner" TEXT,
    "fencingToken" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "dispatchedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "providerHttpStatus" INTEGER,
    "providerRefundId" TEXT,
    "providerRefundReference" TEXT,
    "providerRefundInvoiceId" TEXT,
    "sanitizedResponseMetadata" JSONB,
    "failureClassification" TEXT,
    "failureCode" TEXT,
    "reconciliationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRefundAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PaymentRefundRecoveryJob
CREATE TABLE "PaymentRefundRecoveryJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountId" TEXT,
    "providerEnvironment" "PaymentProviderEnvironment",
    "operation" "PaymentRefundRecoveryOperation" NOT NULL DEFAULT 'POLL_REFUND_STATUS',
    "state" "PaymentRefundRecoveryJobState" NOT NULL DEFAULT 'READY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "fencingVersion" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "reconciliationReason" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRefundRecoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MyFatoorahRefundWebhookEvent
CREATE TABLE "MyFatoorahRefundWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MYFATOORAH',
    "providerAccountId" TEXT,
    "providerEnvironment" "PaymentProviderEnvironment",
    "tenantId" TEXT,
    "paymentId" TEXT,
    "orderId" TEXT,
    "refundId" TEXT,
    "eventCode" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventReference" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "referencedInvoiceId" TEXT,
    "providerRefundId" TEXT,
    "providerRefundReference" TEXT,
    "providerRefundInvoiceId" TEXT,
    "providerStatus" TEXT,
    "signatureStatus" "WebhookSignatureStatus" NOT NULL,
    "state" "RefundWebhookEventState" NOT NULL DEFAULT 'RECEIVED',
    "conflictReason" TEXT,
    "sanitizedPayload" JSONB,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MyFatoorahRefundWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PaymentRefundConflictAudit
CREATE TABLE "PaymentRefundConflictAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "paymentId" TEXT,
    "orderId" TEXT,
    "refundId" TEXT,
    "attemptId" TEXT,
    "webhookEventId" TEXT,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountId" TEXT,
    "providerEnvironment" "PaymentProviderEnvironment",
    "source" "PaymentRefundConflictSource" NOT NULL,
    "conflictType" "PaymentRefundConflictType" NOT NULL,
    "resolutionState" "PaymentRefundConflictResolutionState" NOT NULL DEFAULT 'OPEN',
    "expectedRefundStatus" "PaymentRefundStatus",
    "observedExternalStatus" TEXT,
    "expectedAmount" DECIMAL(14,4),
    "observedAmount" DECIMAL(14,4),
    "currency" TEXT,
    "providerRefundId" TEXT,
    "providerRefundReference" TEXT,
    "summary" TEXT NOT NULL,
    "sanitizedDetails" JSONB,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRefundConflictAudit_pkey" PRIMARY KEY ("id")
);

-- Standard Prisma Indexes & Unique Constraints
CREATE UNIQUE INDEX "PaymentProviderAccount_provider_environment_accountKey_key" ON "PaymentProviderAccount"("provider", "environment", "accountKey");
CREATE UNIQUE INDEX "PaymentProviderAccount_id_environment_key" ON "PaymentProviderAccount"("id", "environment");
CREATE UNIQUE INDEX "PaymentProviderAccount_id_provider_environment_key" ON "PaymentProviderAccount"("id", "provider", "environment");
CREATE INDEX "PaymentProviderAccount_provider_environment_status_idx" ON "PaymentProviderAccount"("provider", "environment", "status");
CREATE INDEX "PaymentProviderAccount_ownerTenantId_idx" ON "PaymentProviderAccount"("ownerTenantId");

CREATE UNIQUE INDEX "PaymentProviderAccountTenant_tenantId_providerAccountId_pro_key" ON "PaymentProviderAccountTenant"("tenantId", "providerAccountId", "provider", "environment");
CREATE INDEX "PaymentProviderAccountTenant_providerAccountId_isActive_idx" ON "PaymentProviderAccountTenant"("providerAccountId", "isActive");
CREATE INDEX "PaymentProviderAccountTenant_tenantId_provider_environment__idx" ON "PaymentProviderAccountTenant"("tenantId", "provider", "environment", "isActive");

CREATE UNIQUE INDEX "Payment_orderId_id_providerAccountId_providerEnvironment_key" ON "Payment"("orderId", "id", "providerAccountId", "providerEnvironment");
CREATE INDEX "Payment_providerAccountId_providerEnvironment_providerPayme_idx" ON "Payment"("providerAccountId", "providerEnvironment", "providerPaymentId");

CREATE INDEX "MyFatoorahInvoice_providerAccountId_providerEnvironment_inv_idx" ON "MyFatoorahInvoice"("providerAccountId", "providerEnvironment", "invoiceId");

CREATE UNIQUE INDEX "PaymentRefund_tenantId_id_key" ON "PaymentRefund"("tenantId", "id");
CREATE UNIQUE INDEX "PaymentRefund_tenantId_orderId_paymentId_id_key" ON "PaymentRefund"("tenantId", "orderId", "paymentId", "id");
CREATE INDEX "PaymentRefund_providerAccountId_providerEnvironment_status_idx" ON "PaymentRefund"("providerAccountId", "providerEnvironment", "status");
CREATE INDEX "PaymentRefund_providerRefundInvoiceId_idx" ON "PaymentRefund"("providerRefundInvoiceId");

CREATE UNIQUE INDEX "PaymentRefundAttempt_refundId_attemptNumber_key" ON "PaymentRefundAttempt"("refundId", "attemptNumber");
CREATE INDEX "PaymentRefundAttempt_tenantId_refundId_createdAt_idx" ON "PaymentRefundAttempt"("tenantId", "refundId", "createdAt");
CREATE INDEX "PaymentRefundAttempt_refundId_operation_state_idx" ON "PaymentRefundAttempt"("refundId", "operation", "state");
CREATE INDEX "PaymentRefundAttempt_state_leaseUntil_idx" ON "PaymentRefundAttempt"("state", "leaseUntil");
CREATE INDEX "PaymentRefundAttempt_correlationId_idx" ON "PaymentRefundAttempt"("correlationId");

CREATE INDEX "PaymentRefundRecoveryJob_state_nextRunAt_idx" ON "PaymentRefundRecoveryJob"("state", "nextRunAt");
CREATE INDEX "PaymentRefundRecoveryJob_state_leaseUntil_idx" ON "PaymentRefundRecoveryJob"("state", "leaseUntil");
CREATE INDEX "PaymentRefundRecoveryJob_tenantId_state_idx" ON "PaymentRefundRecoveryJob"("tenantId", "state");
CREATE INDEX "PaymentRefundRecoveryJob_refundId_createdAt_idx" ON "PaymentRefundRecoveryJob"("refundId", "createdAt");

CREATE INDEX "MyFatoorahRefundWebhookEvent_eventReference_idx" ON "MyFatoorahRefundWebhookEvent"("eventReference");
CREATE INDEX "MyFatoorahRefundWebhookEvent_providerAccountId_providerEnvi_idx" ON "MyFatoorahRefundWebhookEvent"("providerAccountId", "providerEnvironment", "eventReference");
CREATE INDEX "MyFatoorahRefundWebhookEvent_providerRefundId_idx" ON "MyFatoorahRefundWebhookEvent"("providerRefundId");
CREATE INDEX "MyFatoorahRefundWebhookEvent_refundId_receivedAt_idx" ON "MyFatoorahRefundWebhookEvent"("refundId", "receivedAt");
CREATE INDEX "MyFatoorahRefundWebhookEvent_state_receivedAt_idx" ON "MyFatoorahRefundWebhookEvent"("state", "receivedAt");
CREATE INDEX "MyFatoorahRefundWebhookEvent_tenantId_state_receivedAt_idx" ON "MyFatoorahRefundWebhookEvent"("tenantId", "state", "receivedAt");

CREATE INDEX "PaymentRefundConflictAudit_resolutionState_detectedAt_idx" ON "PaymentRefundConflictAudit"("resolutionState", "detectedAt");
CREATE INDEX "PaymentRefundConflictAudit_tenantId_resolutionState_detecte_idx" ON "PaymentRefundConflictAudit"("tenantId", "resolutionState", "detectedAt");
CREATE INDEX "PaymentRefundConflictAudit_refundId_detectedAt_idx" ON "PaymentRefundConflictAudit"("refundId", "detectedAt");
CREATE INDEX "PaymentRefundConflictAudit_providerAccountId_conflictType_d_idx" ON "PaymentRefundConflictAudit"("providerAccountId", "conflictType", "detectedAt");

-- Foreign Keys (ALL ON DELETE RESTRICT to preserve immutable financial history)
ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_ownerTenantId_fkey" FOREIGN KEY ("ownerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentProviderAccountTenant" ADD CONSTRAINT "PaymentProviderAccountTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentProviderAccountTenant" ADD CONSTRAINT "PaymentProviderAccountTenant_providerAccountId_provider_en_fkey" FOREIGN KEY ("providerAccountId", "provider", "environment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_providerAccountId_provider_providerEnvironment_fkey" FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MyFatoorahInvoice" ADD CONSTRAINT "MyFatoorahInvoice_providerAccountId_providerEnvironment_fkey" FOREIGN KEY ("providerAccountId", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_tenantId_providerAccountId_provider_provider_fkey" FOREIGN KEY ("tenantId", "providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccountTenant"("tenantId", "providerAccountId", "provider", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_tenantId_orderId_paymentId_refundId_fkey" FOREIGN KEY ("tenantId", "orderId", "paymentId", "refundId") REFERENCES "PaymentRefund"("tenantId", "orderId", "paymentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_providerAccountId_provider_providerEn_fkey" FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRefundRecoveryJob" ADD CONSTRAINT "PaymentRefundRecoveryJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundRecoveryJob" ADD CONSTRAINT "PaymentRefundRecoveryJob_tenantId_refundId_fkey" FOREIGN KEY ("tenantId", "refundId") REFERENCES "PaymentRefund"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundRecoveryJob" ADD CONSTRAINT "PaymentRefundRecoveryJob_providerAccountId_provider_provid_fkey" FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_tenantId_orderId_paymentId_re_fkey" FOREIGN KEY ("tenantId", "orderId", "paymentId", "refundId") REFERENCES "PaymentRefund"("tenantId", "orderId", "paymentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_providerAccountId_provider_pr_fkey" FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_tenantId_orderId_paymentId_refu_fkey" FOREIGN KEY ("tenantId", "orderId", "paymentId", "refundId") REFERENCES "PaymentRefund"("tenantId", "orderId", "paymentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentRefundAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "MyFatoorahRefundWebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_providerAccountId_provider_prov_fkey" FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- PostgreSQL Partial Unique Indexes (not natively expressible in Prisma DSL)
-- ============================================================================

-- 1. Original provider payment/invoice identifier scoped per account + environment
CREATE UNIQUE INDEX "Payment_account_env_providerPaymentId_uniq"
    ON "Payment"("providerAccountId", "providerEnvironment", "providerPaymentId")
    WHERE "providerAccountId" IS NOT NULL AND "providerPaymentId" IS NOT NULL;

CREATE UNIQUE INDEX "MyFatoorahInvoice_account_env_invoiceId_uniq"
    ON "MyFatoorahInvoice"("providerAccountId", "providerEnvironment", "invoiceId")
    WHERE "providerAccountId" IS NOT NULL;

-- 2. Provider refund identifiers: dual partial unique indexes closing NULL loopholes
--    Account-bound refunds: unique per (providerAccountId, providerEnvironment, id/ref) across all tenants sharing an account,
--    while permitting independent accounts or sandbox vs production to hold independent IDs.
CREATE UNIQUE INDEX "PaymentRefund_account_providerRefundId_uniq"
    ON "PaymentRefund"("providerAccountId", "providerEnvironment", "providerRefundId")
    WHERE "providerAccountId" IS NOT NULL AND "providerRefundId" IS NOT NULL;

CREATE UNIQUE INDEX "PaymentRefund_account_providerRefundReference_uniq"
    ON "PaymentRefund"("providerAccountId", "providerEnvironment", "providerRefundReference")
    WHERE "providerAccountId" IS NOT NULL AND "providerRefundReference" IS NOT NULL;

--    Legacy/unresolved refunds (providerAccountId IS NULL): retain Step 2A tenant+provider deduplication.
CREATE UNIQUE INDEX "PaymentRefund_legacy_providerRefundId_uniq"
    ON "PaymentRefund"("tenantId", "provider", "providerRefundId")
    WHERE "providerAccountId" IS NULL AND "providerRefundId" IS NOT NULL;

CREATE UNIQUE INDEX "PaymentRefund_legacy_providerRefundReference_uniq"
    ON "PaymentRefund"("tenantId", "provider", "providerRefundReference")
    WHERE "providerAccountId" IS NULL AND "providerRefundReference" IS NOT NULL;

-- 3. Durable concurrent submission ownership & no-blind-resend guard:
--    At most ONE non-abandoned, non-definitively-failed SUBMIT_REFUND attempt per PaymentRefund.
--    Unlimited LOOKUP_STATUS and RECONCILE attempts remain allowed.
CREATE UNIQUE INDEX "PaymentRefundAttempt_active_submit_uniq"
    ON "PaymentRefundAttempt"("refundId")
    WHERE "operation" = 'SUBMIT_REFUND' AND "state" IN ('PREPARED', 'DISPATCHING', 'AMBIGUOUS', 'SUCCEEDED');

-- 4. At most ONE active (READY/RUNNING) recovery job per PaymentRefund while preserving completed history.
CREATE UNIQUE INDEX "PaymentRefundRecoveryJob_active_refund_uniq"
    ON "PaymentRefundRecoveryJob"("refundId")
    WHERE "state" IN ('READY', 'RUNNING');

-- 5. Refund webhook deduplication by (eventReference, payloadFingerprint):
--    Exact duplicate deliveries are rejected, while conflicting payloads reusing eventReference
--    with a different payloadFingerprint can be durably quarantined.
CREATE UNIQUE INDEX "MyFatoorahRefundWebhookEvent_account_event_fp_uniq"
    ON "MyFatoorahRefundWebhookEvent"("provider", "providerEnvironment", "providerAccountId", "eventReference", "payloadFingerprint")
    WHERE "providerAccountId" IS NOT NULL;

CREATE UNIQUE INDEX "MyFatoorahRefundWebhookEvent_unresolved_event_fp_uniq"
    ON "MyFatoorahRefundWebhookEvent"("provider", "eventReference", "payloadFingerprint")
    WHERE "providerAccountId" IS NULL;

-- ============================================================================
-- PostgreSQL CHECK Constraints
-- ============================================================================

ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_ownership_check"
    CHECK (
        ("ownershipMode" = 'TENANT_DEDICATED' AND "ownerTenantId" IS NOT NULL)
        OR ("ownershipMode" = 'PLATFORM_SHARED' AND "ownerTenantId" IS NULL)
    );
ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_provider_check"
    CHECK ("provider" <> 'NONE');
ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_fields_check"
    CHECK (
        char_length(btrim("accountKey")) BETWEEN 1 AND 128
        AND "countryCode" ~ '^[A-Z]{2,3}$'
        AND "currency" ~ '^[A-Z]{3}$'
        AND "credentialVersion" >= 1
        AND ("credentialRef" IS NULL OR (char_length(btrim("credentialRef")) BETWEEN 1 AND 255 AND "credentialRef" !~* '^bearer\s'))
    );

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_provider_account_pair_check"
    CHECK (
        ("providerAccountId" IS NULL AND "providerEnvironment" IS NULL)
        OR ("providerAccountId" IS NOT NULL AND "providerEnvironment" IS NOT NULL)
    );
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_none_provider_account_check"
    CHECK (NOT ("provider" = 'NONE' AND "providerAccountId" IS NOT NULL));

ALTER TABLE "MyFatoorahInvoice" ADD CONSTRAINT "MyFatoorahInvoice_provider_account_pair_check"
    CHECK (
        ("providerAccountId" IS NULL AND "providerEnvironment" IS NULL)
        OR ("providerAccountId" IS NOT NULL AND "providerEnvironment" IS NOT NULL)
    );

ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_provider_account_pair_check"
    CHECK (
        ("providerAccountId" IS NULL AND "providerEnvironment" IS NULL)
        OR ("providerAccountId" IS NOT NULL AND "providerEnvironment" IS NOT NULL)
    );
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_none_provider_account_check"
    CHECK (NOT ("provider" = 'NONE' AND "providerAccountId" IS NOT NULL));

ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_fields_check"
    CHECK (
        "attemptNumber" >= 1
        AND char_length(btrim("correlationId")) BETWEEN 1 AND 128
        AND char_length(btrim("requestFingerprint")) >= 1
        AND (
            ("providerAccountId" IS NULL AND "providerEnvironment" IS NULL)
            OR ("providerAccountId" IS NOT NULL AND "providerEnvironment" IS NOT NULL)
        )
    );

ALTER TABLE "PaymentRefundRecoveryJob" ADD CONSTRAINT "PaymentRefundRecoveryJob_fields_check"
    CHECK (
        "attempts" >= 0
        AND "fencingVersion" >= 0
        AND (
            ("providerAccountId" IS NULL AND "providerEnvironment" IS NULL)
            OR ("providerAccountId" IS NOT NULL AND "providerEnvironment" IS NOT NULL)
        )
    );

ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_fields_check"
    CHECK (
        char_length(btrim("eventName")) >= 1
        AND char_length(btrim("eventReference")) BETWEEN 1 AND 255
        AND char_length(btrim("payloadFingerprint")) >= 1
        AND (
            ("providerAccountId" IS NULL AND "providerEnvironment" IS NULL)
            OR ("providerAccountId" IS NOT NULL AND "providerEnvironment" IS NOT NULL)
        )
    );

ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_fields_check"
    CHECK (
        char_length(btrim("summary")) BETWEEN 1 AND 500
        AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
        AND ("expectedAmount" IS NULL OR "expectedAmount" > 0)
        AND ("observedAmount" IS NULL OR "observedAmount" > 0)
        AND (
            ("providerAccountId" IS NULL AND "providerEnvironment" IS NULL)
            OR ("providerAccountId" IS NOT NULL AND "providerEnvironment" IS NOT NULL)
        )
    );

-- ============================================================================
-- PostgreSQL Integrity Triggers (Close NULL MATCH-SIMPLE Loopholes & Immutability)
-- ============================================================================

-- 1. Prevent associating a TENANT_DEDICATED account with an unauthorized tenant.
CREATE OR REPLACE FUNCTION enforce_provider_account_tenant_auth()
RETURNS TRIGGER AS $$
DECLARE
    acc_mode "PaymentProviderAccountOwnership";
    acc_owner TEXT;
BEGIN
    SELECT "ownershipMode", "ownerTenantId"
    INTO acc_mode, acc_owner
    FROM "PaymentProviderAccount"
    WHERE "id" = NEW."providerAccountId";

    IF acc_mode = 'TENANT_DEDICATED' AND acc_owner IS DISTINCT FROM NEW."tenantId" THEN
        RAISE EXCEPTION 'Cross-tenant association prohibited for TENANT_DEDICATED provider account %', NEW."providerAccountId"
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_provider_account_tenant_auth
BEFORE INSERT OR UPDATE ON "PaymentProviderAccountTenant"
FOR EACH ROW EXECUTE FUNCTION enforce_provider_account_tenant_auth();

-- 2. Enforce Payment provider account authorization and immutability once bound.
CREATE OR REPLACE FUNCTION enforce_payment_provider_account_integrity()
RETURNS TRIGGER AS $$
DECLARE
    order_tenant TEXT;
    auth_exists BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."providerAccountId" IS NOT NULL THEN
        IF NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
           OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment" THEN
            RAISE EXCEPTION 'Historical Payment provider account binding is immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW."providerAccountId" IS NOT NULL THEN
        IF NEW."provider" = 'NONE' THEN
            RETURN NEW;
        END IF;

        SELECT "tenantId" INTO order_tenant FROM "Order" WHERE "id" = NEW."orderId";
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM "PaymentProviderAccountTenant" pat
            WHERE pat."tenantId" = order_tenant
              AND pat."providerAccountId" = NEW."providerAccountId"
              AND pat."provider" = NEW."provider"
              AND pat."environment" = NEW."providerEnvironment"
        ) INTO auth_exists;

        IF NOT auth_exists THEN
            RAISE EXCEPTION 'Payment provider account % is not authorized for order tenant %', NEW."providerAccountId", order_tenant
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_payment_provider_account_integrity
BEFORE INSERT OR UPDATE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION enforce_payment_provider_account_integrity();

-- 3. Enforce exact PaymentRefund <-> Payment account/environment/provider match (closing NULL MATCH SIMPLE bypass)
--    and immutability once bound.
CREATE OR REPLACE FUNCTION enforce_payment_refund_account_binding()
RETURNS TRIGGER AS $$
DECLARE
    pay_account TEXT;
    pay_env "PaymentProviderEnvironment";
    pay_provider "PaymentProvider";
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."providerAccountId" IS NOT NULL THEN
        IF NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
           OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment" THEN
            RAISE EXCEPTION 'Historical PaymentRefund provider account binding is immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT "providerAccountId", "providerEnvironment", "provider"
    INTO pay_account, pay_env, pay_provider
    FROM "Payment"
    WHERE "id" = NEW."paymentId" AND "orderId" = NEW."orderId";

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF pay_provider IS DISTINCT FROM NEW."provider"
       OR pay_account IS DISTINCT FROM NEW."providerAccountId"
       OR pay_env IS DISTINCT FROM NEW."providerEnvironment" THEN
        RAISE EXCEPTION 'PaymentRefund account/environment/provider binding must exactly match original Payment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_payment_refund_account_binding
BEFORE INSERT OR UPDATE ON "PaymentRefund"
FOR EACH ROW EXECUTE FUNCTION enforce_payment_refund_account_binding();

-- 4. Enforce PaymentRefundAttempt, PaymentRefundRecoveryJob, MyFatoorahRefundWebhookEvent,
--    and PaymentRefundConflictAudit exact account/environment binding whenever refundId is linked.
CREATE OR REPLACE FUNCTION enforce_refund_linked_account_match()
RETURNS TRIGGER AS $$
DECLARE
    ref_account TEXT;
    ref_env "PaymentProviderEnvironment";
    ref_provider "PaymentProvider";
BEGIN
    IF NEW."refundId" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "providerAccountId", "providerEnvironment", "provider"
    INTO ref_account, ref_env, ref_provider
    FROM "PaymentRefund"
    WHERE "id" = NEW."refundId";

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF ref_provider IS DISTINCT FROM NEW."provider"
       OR ref_account IS DISTINCT FROM NEW."providerAccountId"
       OR ref_env IS DISTINCT FROM NEW."providerEnvironment" THEN
        RAISE EXCEPTION 'Refund child record account/environment/provider must match parent PaymentRefund'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_refund_attempt_account_match
BEFORE INSERT OR UPDATE ON "PaymentRefundAttempt"
FOR EACH ROW EXECUTE FUNCTION enforce_refund_linked_account_match();

CREATE TRIGGER trg_enforce_refund_recovery_account_match
BEFORE INSERT OR UPDATE ON "PaymentRefundRecoveryJob"
FOR EACH ROW EXECUTE FUNCTION enforce_refund_linked_account_match();

CREATE TRIGGER trg_enforce_refund_webhook_account_match
BEFORE INSERT OR UPDATE ON "MyFatoorahRefundWebhookEvent"
FOR EACH ROW EXECUTE FUNCTION enforce_refund_linked_account_match();

CREATE TRIGGER trg_enforce_refund_conflict_account_match
BEFORE INSERT OR UPDATE ON "PaymentRefundConflictAudit"
FOR EACH ROW EXECUTE FUNCTION enforce_refund_linked_account_match();
