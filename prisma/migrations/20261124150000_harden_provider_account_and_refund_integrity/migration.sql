-- Additive forward-only Migration 29 (Phase 2D.12 Step 2C-2A.2):
-- Hardens Provider Account Identity Immutability (S-1), Exact MyFatoorahInvoice Binding (S-2),
-- Parent-Side Identity Consistency & Concurrency Safety (S-3), Durable Refund Attempt State
-- & Dispatch-Evidence Safety (S-4), and Durable Legacy Conflict Audit Linkage (S-5).
--
-- Zero destructive rewrites, zero silent cleanup, zero fabricated backfills.
-- All preflight checks execute FIRST inside the migration transaction so any historical
-- inconsistency fails atomically before DDL changes commit.

-- ============================================================================
-- 1. Existing-Data Preflight Validation (Fail-Closed, Zero Silent Rewrites)
-- ============================================================================
DO $$
DECLARE
    violation_count INTEGER;
BEGIN
    -- S-1 Preflight: Dedicated accounts must not have unauthorized tenant associations.
    SELECT count(*)::int INTO violation_count
    FROM "PaymentProviderAccountTenant" pat
    JOIN "PaymentProviderAccount" acc ON acc."id" = pat."providerAccountId"
    WHERE acc."ownershipMode" = 'TENANT_DEDICATED'
      AND acc."ownerTenantId" IS DISTINCT FROM pat."tenantId";
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 29 preflight failed [S-1]: % unauthorized PaymentProviderAccountTenant row(s) found on TENANT_DEDICATED account(s). Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- S-2 Preflight: Every MyFatoorahInvoice must reference a MYFATOORAH Payment with exact NULL-safe account/environment match.
    SELECT count(*)::int INTO violation_count
    FROM "MyFatoorahInvoice" inv
    JOIN "Payment" pay ON pay."id" = inv."paymentId"
    LEFT JOIN "PaymentProviderAccount" acc ON acc."id" = inv."providerAccountId"
    WHERE pay."provider" <> 'MYFATOORAH'
       OR inv."providerAccountId" IS DISTINCT FROM pay."providerAccountId"
       OR inv."providerEnvironment" IS DISTINCT FROM pay."providerEnvironment"
       OR (inv."providerAccountId" IS NOT NULL AND acc."provider" IS DISTINCT FROM 'MYFATOORAH');
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 29 preflight failed [S-2]: % MyFatoorahInvoice row(s) have provider/account/environment mismatch against their Payment. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- S-3 Preflight (Payment -> PaymentRefund): Exact provider/account/environment match required.
    SELECT count(*)::int INTO violation_count
    FROM "PaymentRefund" ref
    JOIN "Payment" pay ON pay."id" = ref."paymentId" AND pay."orderId" = ref."orderId"
    WHERE ref."provider" IS DISTINCT FROM pay."provider"
       OR ref."providerAccountId" IS DISTINCT FROM pay."providerAccountId"
       OR ref."providerEnvironment" IS DISTINCT FROM pay."providerEnvironment";
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 29 preflight failed [S-3]: % PaymentRefund row(s) contradict their parent Payment provider/account/environment. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- S-3 Preflight (PaymentRefund -> child tables): Exact provider/account/environment match required.
    SELECT (
        (SELECT count(*) FROM "PaymentRefundAttempt" c JOIN "PaymentRefund" r ON r."id" = c."refundId"
          WHERE c."provider" IS DISTINCT FROM r."provider"
             OR c."providerAccountId" IS DISTINCT FROM r."providerAccountId"
             OR c."providerEnvironment" IS DISTINCT FROM r."providerEnvironment")
        +
        (SELECT count(*) FROM "PaymentRefundRecoveryJob" c JOIN "PaymentRefund" r ON r."id" = c."refundId"
          WHERE c."provider" IS DISTINCT FROM r."provider"
             OR c."providerAccountId" IS DISTINCT FROM r."providerAccountId"
             OR c."providerEnvironment" IS DISTINCT FROM r."providerEnvironment")
        +
        (SELECT count(*) FROM "MyFatoorahRefundWebhookEvent" c JOIN "PaymentRefund" r ON r."id" = c."refundId"
          WHERE c."refundId" IS NOT NULL
            AND (c."provider" IS DISTINCT FROM r."provider"
              OR c."providerAccountId" IS DISTINCT FROM r."providerAccountId"
              OR c."providerEnvironment" IS DISTINCT FROM r."providerEnvironment"))
        +
        (SELECT count(*) FROM "PaymentRefundConflictAudit" c JOIN "PaymentRefund" r ON r."id" = c."refundId"
          WHERE c."refundId" IS NOT NULL
            AND (c."provider" IS DISTINCT FROM r."provider"
              OR c."providerAccountId" IS DISTINCT FROM r."providerAccountId"
              OR c."providerEnvironment" IS DISTINCT FROM r."providerEnvironment"))
    )::int INTO violation_count;
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 29 preflight failed [S-3]: % refund child row(s) contradict their parent PaymentRefund provider/account/environment. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- S-4 Preflight: No PREPARED/ABANDONED attempt may carry dispatch evidence, and no SUCCEEDED SUBMIT_REFUND may lack dispatchedAt.
    SELECT count(*)::int INTO violation_count
    FROM "PaymentRefundAttempt"
    WHERE (
        "state" IN ('PREPARED', 'ABANDONED')
        AND (
            "dispatchedAt" IS NOT NULL
            OR "providerHttpStatus" IS NOT NULL
            OR "providerRefundId" IS NOT NULL
            OR "providerRefundReference" IS NOT NULL
            OR "providerRefundInvoiceId" IS NOT NULL
        )
    )
    OR ("operation" = 'SUBMIT_REFUND' AND "state" = 'SUCCEEDED' AND "dispatchedAt" IS NULL);
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 29 preflight failed [S-4]: % PaymentRefundAttempt row(s) contain unsafe state/dispatch-evidence combinations. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- S-5 Preflight: Existing PaymentRefundConflictAudit rows must satisfy permitted linkage shapes and Order/Payment/Attempt consistency.
    SELECT count(*)::int INTO violation_count
    FROM "PaymentRefundConflictAudit" c
    WHERE NOT (
        (c."tenantId" IS NULL AND c."orderId" IS NULL AND c."paymentId" IS NULL AND c."refundId" IS NULL)
        OR (c."tenantId" IS NOT NULL AND c."orderId" IS NULL AND c."paymentId" IS NULL AND c."refundId" IS NULL)
        OR (c."tenantId" IS NOT NULL AND c."orderId" IS NOT NULL AND c."paymentId" IS NOT NULL AND c."refundId" IS NULL)
        OR (c."tenantId" IS NOT NULL AND c."orderId" IS NOT NULL AND c."paymentId" IS NOT NULL AND c."refundId" IS NOT NULL)
    )
    OR (c."attemptId" IS NOT NULL AND c."refundId" IS NULL)
    OR (
        c."orderId" IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM "Order" o WHERE o."id" = c."orderId" AND o."tenantId" = c."tenantId"
        )
    )
    OR (
        c."paymentId" IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM "Payment" p
            WHERE p."id" = c."paymentId"
              AND p."orderId" = c."orderId"
              AND p."provider" IS NOT DISTINCT FROM c."provider"
              AND p."providerAccountId" IS NOT DISTINCT FROM c."providerAccountId"
              AND p."providerEnvironment" IS NOT DISTINCT FROM c."providerEnvironment"
        )
    )
    OR (
        c."attemptId" IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM "PaymentRefundAttempt" a
            WHERE a."id" = c."attemptId" AND a."refundId" = c."refundId"
        )
    );
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 29 preflight failed [S-5]: % PaymentRefundConflictAudit row(s) have invalid tenant/order/payment/refund/attempt linkage. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;
END
$$;

-- ============================================================================
-- 2. Additive Enum Value & Optional Non-Secret providerMerchantCode
-- ============================================================================

-- Note: Not referenced as a literal inside this migration so the entire migration
-- executes atomically within a single PostgreSQL transaction.
ALTER TYPE "PaymentRefundConflictType" ADD VALUE 'LEGACY_UNRESOLVED_ACCOUNT';

ALTER TABLE "PaymentProviderAccount" ADD COLUMN "providerMerchantCode" TEXT;

ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_merchantCode_check"
    CHECK (
        "providerMerchantCode" IS NULL
        OR (
            char_length("providerMerchantCode") BETWEEN 1 AND 128
            AND "providerMerchantCode" = btrim("providerMerchantCode")
            AND "providerMerchantCode" !~ '\s'
            AND "providerMerchantCode" !~* '^(bearer|sk_|pk_|rk_|whsec_|eyJ)'
        )
    );

CREATE UNIQUE INDEX "PaymentProviderAccount_provider_env_merchantCode_uniq"
    ON "PaymentProviderAccount"("provider", "environment", "providerMerchantCode")
    WHERE "providerMerchantCode" IS NOT NULL;

-- ============================================================================
-- 3. Replace ON UPDATE CASCADE With ON UPDATE RESTRICT & Add Conflict Audit FKs
-- ============================================================================

ALTER TABLE "PaymentProviderAccount" DROP CONSTRAINT "PaymentProviderAccount_ownerTenantId_fkey";
ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_ownerTenantId_fkey"
    FOREIGN KEY ("ownerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentProviderAccountTenant" DROP CONSTRAINT "PaymentProviderAccountTenant_tenantId_fkey";
ALTER TABLE "PaymentProviderAccountTenant" ADD CONSTRAINT "PaymentProviderAccountTenant_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentProviderAccountTenant" DROP CONSTRAINT "PaymentProviderAccountTenant_providerAccountId_provider_en_fkey";
ALTER TABLE "PaymentProviderAccountTenant" ADD CONSTRAINT "PaymentProviderAccountTenant_providerAccountId_provider_en_fkey"
    FOREIGN KEY ("providerAccountId", "provider", "environment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_providerAccountId_provider_providerEnvironment_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_providerAccountId_provider_providerEnvironment_fkey"
    FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "MyFatoorahInvoice" DROP CONSTRAINT "MyFatoorahInvoice_paymentId_fkey";
ALTER TABLE "MyFatoorahInvoice" ADD CONSTRAINT "MyFatoorahInvoice_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "MyFatoorahInvoice" DROP CONSTRAINT "MyFatoorahInvoice_providerAccountId_providerEnvironment_fkey";
ALTER TABLE "MyFatoorahInvoice" ADD CONSTRAINT "MyFatoorahInvoice_providerAccountId_providerEnvironment_fkey"
    FOREIGN KEY ("providerAccountId", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefund" DROP CONSTRAINT "PaymentRefund_tenantId_providerAccountId_provider_provider_fkey";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_tenantId_providerAccountId_provider_provider_fkey"
    FOREIGN KEY ("tenantId", "providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccountTenant"("tenantId", "providerAccountId", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundAttempt" DROP CONSTRAINT "PaymentRefundAttempt_tenantId_fkey";
ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundAttempt" DROP CONSTRAINT "PaymentRefundAttempt_tenantId_orderId_paymentId_refundId_fkey";
ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_tenantId_orderId_paymentId_refundId_fkey"
    FOREIGN KEY ("tenantId", "orderId", "paymentId", "refundId") REFERENCES "PaymentRefund"("tenantId", "orderId", "paymentId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundAttempt" DROP CONSTRAINT "PaymentRefundAttempt_providerAccountId_provider_providerEn_fkey";
ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_providerAccountId_provider_providerEn_fkey"
    FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundRecoveryJob" DROP CONSTRAINT "PaymentRefundRecoveryJob_tenantId_fkey";
ALTER TABLE "PaymentRefundRecoveryJob" ADD CONSTRAINT "PaymentRefundRecoveryJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundRecoveryJob" DROP CONSTRAINT "PaymentRefundRecoveryJob_tenantId_refundId_fkey";
ALTER TABLE "PaymentRefundRecoveryJob" ADD CONSTRAINT "PaymentRefundRecoveryJob_tenantId_refundId_fkey"
    FOREIGN KEY ("tenantId", "refundId") REFERENCES "PaymentRefund"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundRecoveryJob" DROP CONSTRAINT "PaymentRefundRecoveryJob_providerAccountId_provider_provid_fkey";
ALTER TABLE "PaymentRefundRecoveryJob" ADD CONSTRAINT "PaymentRefundRecoveryJob_providerAccountId_provider_provid_fkey"
    FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "MyFatoorahRefundWebhookEvent" DROP CONSTRAINT "MyFatoorahRefundWebhookEvent_tenantId_fkey";
ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "MyFatoorahRefundWebhookEvent" DROP CONSTRAINT "MyFatoorahRefundWebhookEvent_tenantId_orderId_paymentId_re_fkey";
ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_tenantId_orderId_paymentId_re_fkey"
    FOREIGN KEY ("tenantId", "orderId", "paymentId", "refundId") REFERENCES "PaymentRefund"("tenantId", "orderId", "paymentId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "MyFatoorahRefundWebhookEvent" DROP CONSTRAINT "MyFatoorahRefundWebhookEvent_providerAccountId_provider_pr_fkey";
ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_providerAccountId_provider_pr_fkey"
    FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundConflictAudit" DROP CONSTRAINT "PaymentRefundConflictAudit_tenantId_fkey";
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundConflictAudit" DROP CONSTRAINT "PaymentRefundConflictAudit_tenantId_orderId_paymentId_refu_fkey";
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_tenantId_orderId_paymentId_refu_fkey"
    FOREIGN KEY ("tenantId", "orderId", "paymentId", "refundId") REFERENCES "PaymentRefund"("tenantId", "orderId", "paymentId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundConflictAudit" DROP CONSTRAINT "PaymentRefundConflictAudit_attemptId_fkey";
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "PaymentRefundAttempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundConflictAudit" DROP CONSTRAINT "PaymentRefundConflictAudit_webhookEventId_fkey";
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_webhookEventId_fkey"
    FOREIGN KEY ("webhookEventId") REFERENCES "MyFatoorahRefundWebhookEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundConflictAudit" DROP CONSTRAINT "PaymentRefundConflictAudit_providerAccountId_provider_prov_fkey";
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_providerAccountId_provider_prov_fkey"
    FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundConflictAudit" DROP CONSTRAINT "PaymentRefundConflictAudit_resolvedByUserId_fkey";
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_resolvedByUserId_fkey"
    FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- S-5 Composite FKs enabling payment-level conflict audits (e.g., LEGACY_UNRESOLVED_ACCOUNT)
-- without creating an orphan PaymentRefund row.
CREATE INDEX "PaymentRefundConflictAudit_tenantId_orderId_paymentId_idx"
    ON "PaymentRefundConflictAudit"("tenantId", "orderId", "paymentId");

ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_tenantId_orderId_fkey"
    FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_orderId_paymentId_fkey"
    FOREIGN KEY ("orderId", "paymentId") REFERENCES "Payment"("orderId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ============================================================================
-- 4. Additional PostgreSQL CHECK Constraints (S-4 & S-5)
-- ============================================================================

-- S-4: Dispatched attempts cannot be PREPARED or ABANDONED; SUCCEEDED SUBMIT_REFUND must record dispatchedAt.
ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_dispatch_evidence_check"
    CHECK (
        NOT (
            "state" IN ('PREPARED', 'ABANDONED')
            AND (
                "dispatchedAt" IS NOT NULL
                OR "providerHttpStatus" IS NOT NULL
                OR "providerRefundId" IS NOT NULL
                OR "providerRefundReference" IS NOT NULL
                OR "providerRefundInvoiceId" IS NOT NULL
            )
        )
        AND NOT (
            "operation" = 'SUBMIT_REFUND'
            AND "state" = 'SUCCEEDED'
            AND "dispatchedAt" IS NULL
        )
    );

-- S-5: Explicitly restrict PaymentRefundConflictAudit to four valid linkage shapes,
-- closing PostgreSQL MATCH SIMPLE NULL-bypass loopholes.
ALTER TABLE "PaymentRefundConflictAudit" ADD CONSTRAINT "PaymentRefundConflictAudit_linkage_shape_check"
    CHECK (
        (
            ("tenantId" IS NULL AND "orderId" IS NULL AND "paymentId" IS NULL AND "refundId" IS NULL)
            OR ("tenantId" IS NOT NULL AND "orderId" IS NULL AND "paymentId" IS NULL AND "refundId" IS NULL)
            OR ("tenantId" IS NOT NULL AND "orderId" IS NOT NULL AND "paymentId" IS NOT NULL AND "refundId" IS NULL)
            OR ("tenantId" IS NOT NULL AND "orderId" IS NOT NULL AND "paymentId" IS NOT NULL AND "refundId" IS NOT NULL)
        )
        AND ("attemptId" IS NULL OR "refundId" IS NOT NULL)
    );

-- ============================================================================
-- 5. Hardened PostgreSQL Integrity Triggers & Acyclic Concurrency Locking
--
-- Canonical Lock Order (strictly bottom-up in child triggers, top-down never
-- locking children, guaranteeing zero deadlocks under READ COMMITTED):
--   Child -> PaymentRefund (FOR SHARE) -> Payment (FOR SHARE)
--   Payment -> Order (FOR SHARE) -> PaymentProviderAccountTenant (FOR SHARE)
--   PaymentProviderAccountTenant -> PaymentProviderAccount (FOR SHARE)
--
-- PostgreSQL Lock Compatibility Proof:
--   Parent UPDATE acquires FOR NO KEY UPDATE (or FOR UPDATE).
--   Child BEFORE INSERT/UPDATE acquires FOR SHARE on Parent.
--   FOR SHARE conflicts with BOTH FOR NO KEY UPDATE and FOR UPDATE, while
--   multiple concurrent child inserts holding FOR SHARE do not block each other.
-- ============================================================================

-- S-1: Immutable PaymentProviderAccount identity attributes (operational fields remain mutable).
CREATE OR REPLACE FUNCTION enforce_provider_account_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."provider" IS DISTINCT FROM OLD."provider"
       OR NEW."environment" IS DISTINCT FROM OLD."environment"
       OR NEW."accountKey" IS DISTINCT FROM OLD."accountKey"
       OR NEW."ownershipMode" IS DISTINCT FROM OLD."ownershipMode"
       OR NEW."ownerTenantId" IS DISTINCT FROM OLD."ownerTenantId"
       OR NEW."countryCode" IS DISTINCT FROM OLD."countryCode"
       OR NEW."currency" IS DISTINCT FROM OLD."currency" THEN
        RAISE EXCEPTION 'PaymentProviderAccount identity attributes are immutable after creation'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."providerMerchantCode" IS NOT NULL
       AND NEW."providerMerchantCode" IS DISTINCT FROM OLD."providerMerchantCode" THEN
        RAISE EXCEPTION 'PaymentProviderAccount providerMerchantCode is immutable once established'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_provider_account_immutability
BEFORE UPDATE ON "PaymentProviderAccount"
FOR EACH ROW EXECUTE FUNCTION enforce_provider_account_immutability();

-- S-1: Upgrade PaymentProviderAccountTenant trigger to forbid key-column mutations
-- and lock parent PaymentProviderAccount FOR SHARE.
CREATE OR REPLACE FUNCTION enforce_provider_account_tenant_auth()
RETURNS TRIGGER AS $$
DECLARE
    acc_mode "PaymentProviderAccountOwnership";
    acc_owner TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
           OR NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
           OR NEW."provider" IS DISTINCT FROM OLD."provider"
           OR NEW."environment" IS DISTINCT FROM OLD."environment" THEN
            RAISE EXCEPTION 'PaymentProviderAccountTenant identity keys are immutable; use isActive/revokedAt for lifecycle changes'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT "ownershipMode", "ownerTenantId"
    INTO acc_mode, acc_owner
    FROM "PaymentProviderAccount"
    WHERE "id" = NEW."providerAccountId"
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF acc_mode = 'TENANT_DEDICATED' AND acc_owner IS DISTINCT FROM NEW."tenantId" THEN
        RAISE EXCEPTION 'Cross-tenant association prohibited for TENANT_DEDICATED provider account %', NEW."providerAccountId"
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- S-2: Exact MyFatoorahInvoice <-> Payment binding, MYFATOORAH provider check,
-- correlation immutability, and FOR SHARE locking against parent Payment.
CREATE OR REPLACE FUNCTION enforce_myfatoorah_invoice_account_binding()
RETURNS TRIGGER AS $$
DECLARE
    pay_provider "PaymentProvider";
    pay_account TEXT;
    pay_env "PaymentProviderEnvironment";
    acc_provider "PaymentProvider";
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
           OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" THEN
            RAISE EXCEPTION 'Historical MyFatoorahInvoice paymentId and invoiceId are immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD."providerAccountId" IS NOT NULL
           AND (
               NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
               OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment"
           ) THEN
            RAISE EXCEPTION 'Historical MyFatoorahInvoice provider account binding is immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT "provider", "providerAccountId", "providerEnvironment"
    INTO pay_provider, pay_account, pay_env
    FROM "Payment"
    WHERE "id" = NEW."paymentId"
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF pay_provider <> 'MYFATOORAH' THEN
        RAISE EXCEPTION 'MyFatoorahInvoice can only reference a MYFATOORAH Payment'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."providerAccountId" IS DISTINCT FROM pay_account
       OR NEW."providerEnvironment" IS DISTINCT FROM pay_env THEN
        RAISE EXCEPTION 'MyFatoorahInvoice provider account/environment must exactly match original Payment'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."providerAccountId" IS NOT NULL THEN
        SELECT "provider" INTO acc_provider
        FROM "PaymentProviderAccount"
        WHERE "id" = NEW."providerAccountId"
        FOR SHARE;

        IF FOUND AND acc_provider <> 'MYFATOORAH' THEN
            RAISE EXCEPTION 'MyFatoorahInvoice cannot reference a non-MYFATOORAH provider account'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_myfatoorah_invoice_account_binding
BEFORE INSERT OR UPDATE ON "MyFatoorahInvoice"
FOR EACH ROW EXECUTE FUNCTION enforce_myfatoorah_invoice_account_binding();

-- S-3: Upgrade Payment trigger to enforce provider/orderId immutability, strict
-- pre-initiation NULL -> bound guard (blocking combined evidence-clearing updates),
-- child-existence verification, and FOR SHARE locking on Order & authorization row.
CREATE OR REPLACE FUNCTION enforce_payment_provider_account_integrity()
RETURNS TRIGGER AS $$
DECLARE
    order_tenant TEXT;
    auth_exists BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."orderId" IS DISTINCT FROM OLD."orderId" THEN
            RAISE EXCEPTION 'Historical Payment orderId is immutable'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."provider" IS DISTINCT FROM OLD."provider" THEN
            IF OLD."providerAccountId" IS NOT NULL
               OR NEW."providerAccountId" IS NOT NULL
               OR OLD."status" NOT IN ('PENDING', 'REQUIRES_ACTION')
               OR EXISTS (SELECT 1 FROM "MyFatoorahInvoice" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "MyFatoorahWebhookEvent" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefund" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefundConflictAudit" WHERE "paymentId" = OLD."id") THEN
                RAISE EXCEPTION 'Historical Payment provider is immutable once account-bound, settled, or linked to financial records'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF OLD."providerAccountId" IS NOT NULL THEN
            IF NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
               OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment" THEN
                RAISE EXCEPTION 'Historical Payment provider account binding is immutable'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF NEW."providerAccountId" IS NOT NULL THEN
            -- Narrow pre-initiation binding guard: inspect OLD state so combined updates
            -- cannot clear external evidence while assigning a new provider account.
            IF OLD."initiationState" <> 'NOT_STARTED'
               OR OLD."status" <> 'PENDING'
               OR OLD."providerPaymentId" IS NOT NULL
               OR OLD."providerTransactionId" IS NOT NULL
               OR OLD."reconciliationRequired" = true THEN
                RAISE EXCEPTION 'Cannot assign provider account to Payment % after external initiation or non-PENDING lifecycle state', OLD."id"
                    USING ERRCODE = '23514';
            END IF;

            IF EXISTS (SELECT 1 FROM "MyFatoorahInvoice" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "MyFatoorahWebhookEvent" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefund" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefundConflictAudit" WHERE "paymentId" = OLD."id") THEN
                RAISE EXCEPTION 'Cannot assign provider account to Payment % when financial child records already exist', OLD."id"
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    IF NEW."providerAccountId" IS NOT NULL THEN
        IF NEW."provider" = 'NONE' THEN
            RETURN NEW;
        END IF;

        SELECT "tenantId" INTO order_tenant
        FROM "Order"
        WHERE "id" = NEW."orderId"
        FOR SHARE;
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
            FOR SHARE
        ) INTO auth_exists;

        IF NOT auth_exists THEN
            RAISE EXCEPTION 'Payment provider account % is not authorized for order tenant %', NEW."providerAccountId", order_tenant
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- S-3: Upgrade PaymentRefund trigger to enforce lineage immutability, parent NULL -> bound
-- child consistency guard, and FOR SHARE locking on parent Payment.
CREATE OR REPLACE FUNCTION enforce_payment_refund_account_binding()
RETURNS TRIGGER AS $$
DECLARE
    pay_account TEXT;
    pay_env "PaymentProviderEnvironment";
    pay_provider "PaymentProvider";
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
           OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
           OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
           OR NEW."provider" IS DISTINCT FROM OLD."provider" THEN
            RAISE EXCEPTION 'Historical PaymentRefund lineage and provider are immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD."providerAccountId" IS NOT NULL THEN
            IF NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
               OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment" THEN
                RAISE EXCEPTION 'Historical PaymentRefund provider account binding is immutable'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF NEW."providerAccountId" IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM "PaymentRefundAttempt" WHERE "refundId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefundRecoveryJob" WHERE "refundId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "MyFatoorahRefundWebhookEvent" WHERE "refundId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefundConflictAudit" WHERE "refundId" = OLD."id") THEN
                RAISE EXCEPTION 'Cannot change PaymentRefund % account binding when linked child records exist', OLD."id"
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    SELECT "providerAccountId", "providerEnvironment", "provider"
    INTO pay_account, pay_env, pay_provider
    FROM "Payment"
    WHERE "id" = NEW."paymentId" AND "orderId" = NEW."orderId"
    FOR SHARE;

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

-- S-3: Upgrade child account-match trigger to acquire FOR SHARE on parent PaymentRefund.
-- (Only references columns shared across Attempt, RecoveryJob, and RefundWebhookEvent.)
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
    WHERE "id" = NEW."refundId"
    FOR SHARE;

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

-- S-3 & S-5: Dedicated PaymentRefundConflictAudit account/lineage match trigger
-- supporting both refund-level and payment-level (refundId IS NULL) conflict audits,
-- plus attemptId -> refundId verification.
CREATE OR REPLACE FUNCTION enforce_conflict_audit_account_match()
RETURNS TRIGGER AS $$
DECLARE
    ref_account TEXT;
    ref_env "PaymentProviderEnvironment";
    ref_provider "PaymentProvider";
    pay_account TEXT;
    pay_env "PaymentProviderEnvironment";
    pay_provider "PaymentProvider";
    att_refund TEXT;
BEGIN
    IF NEW."refundId" IS NOT NULL THEN
        SELECT "providerAccountId", "providerEnvironment", "provider"
        INTO ref_account, ref_env, ref_provider
        FROM "PaymentRefund"
        WHERE "id" = NEW."refundId"
        FOR SHARE;

        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF ref_provider IS DISTINCT FROM NEW."provider"
           OR ref_account IS DISTINCT FROM NEW."providerAccountId"
           OR ref_env IS DISTINCT FROM NEW."providerEnvironment" THEN
            RAISE EXCEPTION 'Refund child record account/environment/provider must match parent PaymentRefund'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."attemptId" IS NOT NULL THEN
            SELECT "refundId" INTO att_refund
            FROM "PaymentRefundAttempt"
            WHERE "id" = NEW."attemptId"
            FOR SHARE;

            IF FOUND AND att_refund IS DISTINCT FROM NEW."refundId" THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit attemptId does not belong to refundId'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF NEW."paymentId" IS NOT NULL THEN
        SELECT "providerAccountId", "providerEnvironment", "provider"
        INTO pay_account, pay_env, pay_provider
        FROM "Payment"
        WHERE "id" = NEW."paymentId" AND "orderId" = NEW."orderId"
        FOR SHARE;

        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF pay_provider IS DISTINCT FROM NEW."provider"
           OR pay_account IS DISTINCT FROM NEW."providerAccountId"
           OR pay_env IS DISTINCT FROM NEW."providerEnvironment" THEN
            RAISE EXCEPTION 'Payment-level PaymentRefundConflictAudit provider/account/environment must match original Payment'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "trg_enforce_refund_conflict_account_match" ON "PaymentRefundConflictAudit";
CREATE TRIGGER trg_enforce_refund_conflict_account_match
BEFORE INSERT OR UPDATE ON "PaymentRefundConflictAudit"
FOR EACH ROW EXECUTE FUNCTION enforce_conflict_audit_account_match();

-- S-4: Durable PaymentRefundAttempt state-transition matrix, dispatch-evidence
-- immutability, identity immutability, and append-only delete protection.
CREATE OR REPLACE FUNCTION enforce_refund_attempt_state_safety()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deleting PaymentRefundAttempt history is prohibited'
            USING ERRCODE = '23514';
    END IF;

    -- Identity, correlation, and lineage fields are strictly immutable.
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
       OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
       OR NEW."refundId" IS DISTINCT FROM OLD."refundId"
       OR NEW."provider" IS DISTINCT FROM OLD."provider"
       OR NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
       OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment"
       OR NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber"
       OR NEW."operation" IS DISTINCT FROM OLD."operation"
       OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
       OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint" THEN
        RAISE EXCEPTION 'PaymentRefundAttempt identity, correlation, and lineage fields are immutable'
            USING ERRCODE = '23514';
    END IF;

    -- Dispatch and provider evidence cannot be erased or replaced once recorded.
    IF (OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt")
       OR (OLD."providerHttpStatus" IS NOT NULL AND NEW."providerHttpStatus" IS DISTINCT FROM OLD."providerHttpStatus")
       OR (OLD."providerRefundId" IS NOT NULL AND NEW."providerRefundId" IS DISTINCT FROM OLD."providerRefundId")
       OR (OLD."providerRefundReference" IS NOT NULL AND NEW."providerRefundReference" IS DISTINCT FROM OLD."providerRefundReference")
       OR (OLD."providerRefundInvoiceId" IS NOT NULL AND NEW."providerRefundInvoiceId" IS DISTINCT FROM OLD."providerRefundInvoiceId") THEN
        RAISE EXCEPTION 'PaymentRefundAttempt dispatch and provider evidence cannot be erased or replaced once recorded'
            USING ERRCODE = '23514';
    END IF;

    -- Terminal states cannot transition or mutate evidence/completion timestamps.
    IF OLD."state" IN ('SUCCEEDED', 'DEFINITIVELY_FAILED', 'ABANDONED') THEN
        IF NEW."state" IS DISTINCT FROM OLD."state" THEN
            RAISE EXCEPTION 'Cannot transition PaymentRefundAttempt out of terminal state %', OLD."state"
                USING ERRCODE = '23514';
        END IF;
        IF NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
           OR NEW."failureClassification" IS DISTINCT FROM OLD."failureClassification"
           OR NEW."failureCode" IS DISTINCT FROM OLD."failureCode"
           OR NEW."reconciliationReason" IS DISTINCT FROM OLD."reconciliationReason" THEN
            RAISE EXCEPTION 'Cannot mutate outcome metadata of terminal PaymentRefundAttempt %', OLD."id"
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    -- Explicit state transition matrix for non-terminal states:
    --   PREPARED    -> PREPARED | DISPATCHING | AMBIGUOUS | DEFINITIVELY_FAILED | ABANDONED (only if never dispatched)
    --   DISPATCHING -> DISPATCHING | SUCCEEDED | DEFINITIVELY_FAILED | AMBIGUOUS (never PREPARED or ABANDONED)
    --   AMBIGUOUS   -> AMBIGUOUS | SUCCEEDED (never releases submission ownership to PREPARED/DISPATCHING/ABANDONED/DEFINITIVELY_FAILED)
    IF NEW."state" IS DISTINCT FROM OLD."state" THEN
        IF OLD."state" = 'PREPARED' THEN
            IF NEW."state" NOT IN ('DISPATCHING', 'AMBIGUOUS', 'DEFINITIVELY_FAILED', 'ABANDONED') THEN
                RAISE EXCEPTION 'Illegal PaymentRefundAttempt transition from PREPARED to %', NEW."state"
                    USING ERRCODE = '23514';
            END IF;
        ELSIF OLD."state" = 'DISPATCHING' THEN
            IF NEW."state" NOT IN ('SUCCEEDED', 'DEFINITIVELY_FAILED', 'AMBIGUOUS') THEN
                RAISE EXCEPTION 'Illegal PaymentRefundAttempt transition from DISPATCHING to %', NEW."state"
                    USING ERRCODE = '23514';
            END IF;
        ELSIF OLD."state" = 'AMBIGUOUS' THEN
            IF NEW."state" <> 'SUCCEEDED' THEN
                RAISE EXCEPTION 'Illegal PaymentRefundAttempt transition from AMBIGUOUS to %; ambiguous attempts cannot release submission ownership', NEW."state"
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_refund_attempt_state_safety
BEFORE UPDATE OR DELETE ON "PaymentRefundAttempt"
FOR EACH ROW EXECUTE FUNCTION enforce_refund_attempt_state_safety();

-- S-5: Append-only delete protection and lineage immutability on PaymentRefundConflictAudit
-- (operational resolution fields remain mutable for review workflows).
CREATE OR REPLACE FUNCTION enforce_conflict_audit_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deleting PaymentRefundConflictAudit history is prohibited'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
       OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
       OR NEW."refundId" IS DISTINCT FROM OLD."refundId"
       OR NEW."attemptId" IS DISTINCT FROM OLD."attemptId"
       OR NEW."webhookEventId" IS DISTINCT FROM OLD."webhookEventId"
       OR NEW."provider" IS DISTINCT FROM OLD."provider"
       OR NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
       OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment"
       OR NEW."source" IS DISTINCT FROM OLD."source"
       OR NEW."conflictType" IS DISTINCT FROM OLD."conflictType" THEN
        RAISE EXCEPTION 'PaymentRefundConflictAudit financial lineage and classification are immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_conflict_audit_immutability
BEFORE UPDATE OR DELETE ON "PaymentRefundConflictAudit"
FOR EACH ROW EXECUTE FUNCTION enforce_conflict_audit_immutability();
