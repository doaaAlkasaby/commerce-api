-- Additive forward-only Migration 30 (Phase 2D.12 Step 2C-2A.3):
-- Closes all five Migration 29 Final Acceptance Gate blockers:
--   B-1: Strict Payment.provider immutability, historical payment evidence preservation,
--        and durable Payment.reconciliationFlaggedAt marker preventing sequential
--        evidence-clearing + retroactive account binding.
--   B-2: Eliminates both confirmed PostgreSQL 40P01 deadlock cycles via immutable
--        Order.tenantId (removing Order FOR SHARE from Payment trigger) and unlocked
--        immutable PaymentRefundAttempt.refundId lookup in ConflictAudit trigger.
--   B-3: Enforces active tenant authorization (isActive=true, revokedAt IS NULL) and
--        ACTIVE PaymentProviderAccount status on NEW account bindings only, preserving
--        historical bindings after later deactivation/retirement/revocation.
--   B-4: Full terminal freeze on PaymentRefundAttempt (SUCCEEDED/DEFINITIVELY_FAILED/
--        ABANDONED), SUBMIT_REFUND INSERT must start in PREPARED, atomic dispatch boundary
--        CHECK, and at-most-one-dispatched SUBMIT_REFUND enforcement.
--   B-5: Explicit linkage-shape CHECK + composite Order/Payment FKs + tenant/account
--        validation on MyFatoorahRefundWebhookEvent, plus bidirectional NULL-safe
--        compatibility validation with PaymentRefundConflictAudit.webhookEventId.
--
-- Zero silent rewrites, zero fabricated backfills, full atomic single-transaction rollout.

-- ============================================================================
-- 1. Existing-Data Preflight Validation (Fail-Closed, Zero Silent Rewrites)
-- ============================================================================
DO $$
DECLARE
    violation_count INTEGER;
BEGIN
    -- B-4 Preflight: DISPATCHING/AMBIGUOUS SUBMIT_REFUND must carry required dispatch boundary fields.
    SELECT count(*)::int INTO violation_count
    FROM "PaymentRefundAttempt"
    WHERE (
        "operation" = 'SUBMIT_REFUND'
        AND "state" = 'DISPATCHING'
        AND (
            "dispatchedAt" IS NULL
            OR "dispatchOwner" IS NULL
            OR char_length(btrim("dispatchOwner")) = 0
            OR "fencingToken" IS NULL
            OR char_length(btrim("fencingToken")) = 0
            OR "leaseUntil" IS NULL
        )
    )
    OR (
        "operation" = 'SUBMIT_REFUND'
        AND "state" = 'AMBIGUOUS'
        AND "dispatchedAt" IS NULL
    );
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 30 preflight failed [B-4]: % SUBMIT_REFUND PaymentRefundAttempt row(s) lack required dispatch boundary fields. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- B-4 Preflight: At most one dispatched SUBMIT_REFUND attempt per PaymentRefund.
    SELECT count(*)::int INTO violation_count
    FROM (
        SELECT "refundId"
        FROM "PaymentRefundAttempt"
        WHERE "operation" = 'SUBMIT_REFUND' AND "dispatchedAt" IS NOT NULL
        GROUP BY "refundId"
        HAVING count(*) > 1
    ) dup;
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 30 preflight failed [B-4]: % PaymentRefund row(s) already have multiple dispatched SUBMIT_REFUND attempts. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- B-5 Preflight: MyFatoorahRefundWebhookEvent linkage shapes, Order/Payment consistency, and historical tenant/account authorization.
    SELECT count(*)::int INTO violation_count
    FROM "MyFatoorahRefundWebhookEvent" wh
    WHERE NOT (
        (wh."tenantId" IS NULL AND wh."orderId" IS NULL AND wh."paymentId" IS NULL AND wh."refundId" IS NULL)
        OR (wh."tenantId" IS NOT NULL AND wh."orderId" IS NULL AND wh."paymentId" IS NULL AND wh."refundId" IS NULL)
        OR (wh."tenantId" IS NOT NULL AND wh."orderId" IS NOT NULL AND wh."paymentId" IS NOT NULL AND wh."refundId" IS NULL)
        OR (wh."tenantId" IS NOT NULL AND wh."orderId" IS NOT NULL AND wh."paymentId" IS NOT NULL AND wh."refundId" IS NOT NULL)
    )
    OR (
        wh."orderId" IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM "Order" o WHERE o."id" = wh."orderId" AND o."tenantId" = wh."tenantId"
        )
    )
    OR (
        wh."paymentId" IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM "Payment" p
            WHERE p."id" = wh."paymentId"
              AND p."orderId" = wh."orderId"
              AND p."provider" IS NOT DISTINCT FROM wh."provider"
              AND p."providerAccountId" IS NOT DISTINCT FROM wh."providerAccountId"
              AND p."providerEnvironment" IS NOT DISTINCT FROM wh."providerEnvironment"
        )
    )
    OR (
        wh."tenantId" IS NOT NULL
        AND wh."providerAccountId" IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM "PaymentProviderAccountTenant" pat
            WHERE pat."tenantId" = wh."tenantId"
              AND pat."providerAccountId" = wh."providerAccountId"
              AND pat."provider" = wh."provider"
              AND pat."environment" = wh."providerEnvironment"
        )
    );
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 30 preflight failed [B-5]: % MyFatoorahRefundWebhookEvent row(s) have invalid linkage or unauthorized tenant/account association. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;

    -- B-5 Preflight: PaymentRefundConflictAudit.webhookEventId must be compatible with referenced webhook lineage.
    SELECT count(*)::int INTO violation_count
    FROM "PaymentRefundConflictAudit" ca
    JOIN "MyFatoorahRefundWebhookEvent" wh ON wh."id" = ca."webhookEventId"
    WHERE wh."provider" IS DISTINCT FROM ca."provider"
       OR (wh."providerAccountId" IS NOT NULL AND (ca."providerAccountId" IS DISTINCT FROM wh."providerAccountId" OR ca."providerEnvironment" IS DISTINCT FROM wh."providerEnvironment"))
       OR (wh."tenantId" IS NOT NULL AND ca."tenantId" IS DISTINCT FROM wh."tenantId")
       OR (wh."orderId" IS NOT NULL AND ca."orderId" IS DISTINCT FROM wh."orderId")
       OR (wh."paymentId" IS NOT NULL AND ca."paymentId" IS DISTINCT FROM wh."paymentId")
       OR (wh."refundId" IS NOT NULL AND ca."refundId" IS DISTINCT FROM wh."refundId");
    IF violation_count > 0 THEN
        RAISE EXCEPTION 'Migration 30 preflight failed [B-5]: % PaymentRefundConflictAudit row(s) contradict their referenced MyFatoorahRefundWebhookEvent lineage. Remediate manually before upgrading.', violation_count
            USING ERRCODE = '23514';
    END IF;
END
$$;

-- ============================================================================
-- 2. Additive Column, Composite Foreign Keys, Partial Unique Index & CHECKs
-- ============================================================================

-- B-1: Durable write-once reconciliation timestamp so clearing reconciliationRequired
-- permits legitimate reconciliation resolution without restoring account-binding eligibility.
ALTER TABLE "Payment" ADD COLUMN "reconciliationFlaggedAt" TIMESTAMPTZ(3);

-- B-4: Enforce at-most-one dispatched SUBMIT_REFUND attempt per PaymentRefund even if
-- a dispatched attempt later transitions to DEFINITIVELY_FAILED.
CREATE UNIQUE INDEX "PaymentRefundAttempt_dispatched_submit_uniq"
    ON "PaymentRefundAttempt"("refundId")
    WHERE "operation" = 'SUBMIT_REFUND' AND "dispatchedAt" IS NOT NULL;

ALTER TABLE "PaymentRefundAttempt" ADD CONSTRAINT "PaymentRefundAttempt_dispatch_boundary_check"
    CHECK (
        NOT (
            "operation" = 'SUBMIT_REFUND'
            AND "state" = 'DISPATCHING'
            AND (
                "dispatchedAt" IS NULL
                OR "dispatchOwner" IS NULL
                OR char_length(btrim("dispatchOwner")) = 0
                OR "fencingToken" IS NULL
                OR char_length(btrim("fencingToken")) = 0
                OR "leaseUntil" IS NULL
            )
        )
        AND NOT (
            "operation" = 'SUBMIT_REFUND'
            AND "state" = 'AMBIGUOUS'
            AND "dispatchedAt" IS NULL
        )
    );

-- B-5: Explicit linkage-shape CHECK and composite Order/Payment FKs on MyFatoorahRefundWebhookEvent.
CREATE INDEX "MyFatoorahRefundWebhookEvent_tenantId_orderId_paymentId_idx"
    ON "MyFatoorahRefundWebhookEvent"("tenantId", "orderId", "paymentId");

ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_tenantId_orderId_fkey"
    FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_orderId_paymentId_fkey"
    FOREIGN KEY ("orderId", "paymentId") REFERENCES "Payment"("orderId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "MyFatoorahRefundWebhookEvent" ADD CONSTRAINT "MyFatoorahRefundWebhookEvent_linkage_shape_check"
    CHECK (
        ("tenantId" IS NULL AND "orderId" IS NULL AND "paymentId" IS NULL AND "refundId" IS NULL)
        OR ("tenantId" IS NOT NULL AND "orderId" IS NULL AND "paymentId" IS NULL AND "refundId" IS NULL)
        OR ("tenantId" IS NOT NULL AND "orderId" IS NOT NULL AND "paymentId" IS NOT NULL AND "refundId" IS NULL)
        OR ("tenantId" IS NOT NULL AND "orderId" IS NOT NULL AND "paymentId" IS NOT NULL AND "refundId" IS NOT NULL)
    );

-- ============================================================================
-- 3. B-2: Immutable Order.tenantId (Enables Lock-Free Read From Payment Trigger)
-- ============================================================================
CREATE OR REPLACE FUNCTION enforce_order_tenant_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN
        RAISE EXCEPTION 'Order tenantId is immutable after creation'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_order_tenant_immutability
BEFORE UPDATE ON "Order"
FOR EACH ROW EXECUTE FUNCTION enforce_order_tenant_immutability();

-- ============================================================================
-- 4. B-1, B-2, B-3: Hardened Payment Integrity & Active Binding Authorization
-- ============================================================================
CREATE OR REPLACE FUNCTION enforce_payment_provider_account_integrity()
RETURNS TRIGGER AS $$
DECLARE
    order_tenant TEXT;
    pat_active BOOLEAN;
    pat_revoked_at TIMESTAMPTZ(3);
    acc_status "PaymentProviderAccountStatus";
    is_new_binding BOOLEAN;
BEGIN
    -- Maintain durable write-once reconciliationFlaggedAt marker.
    IF TG_OP = 'INSERT' THEN
        IF NEW."reconciliationRequired" = true AND NEW."reconciliationFlaggedAt" IS NULL THEN
            NEW."reconciliationFlaggedAt" := clock_timestamp();
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD."reconciliationFlaggedAt" IS NOT NULL
           AND NEW."reconciliationFlaggedAt" IS DISTINCT FROM OLD."reconciliationFlaggedAt" THEN
            RAISE EXCEPTION 'Payment reconciliationFlaggedAt is immutable once recorded'
                USING ERRCODE = '23514';
        END IF;

        IF (OLD."reconciliationRequired" = true OR NEW."reconciliationRequired" = true)
           AND NEW."reconciliationFlaggedAt" IS NULL THEN
            NEW."reconciliationFlaggedAt" := clock_timestamp();
        END IF;

        -- B-1: Strict unconditional immutability of orderId and provider after INSERT.
        IF NEW."orderId" IS DISTINCT FROM OLD."orderId" THEN
            RAISE EXCEPTION 'Historical Payment orderId is immutable'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."provider" IS DISTINCT FROM OLD."provider" THEN
            RAISE EXCEPTION 'Historical Payment provider is strictly immutable after creation'
                USING ERRCODE = '23514';
        END IF;

        -- B-1: Protect established external payment evidence from erasure or regression.
        IF OLD."providerPaymentId" IS NOT NULL
           AND NEW."providerPaymentId" IS DISTINCT FROM OLD."providerPaymentId" THEN
            RAISE EXCEPTION 'Established Payment providerPaymentId cannot be erased or replaced'
                USING ERRCODE = '23514';
        END IF;

        IF OLD."providerTransactionId" IS NOT NULL
           AND NEW."providerTransactionId" IS DISTINCT FROM OLD."providerTransactionId" THEN
            RAISE EXCEPTION 'Established Payment providerTransactionId cannot be erased or replaced'
                USING ERRCODE = '23514';
        END IF;

        IF OLD."initiationState" <> 'NOT_STARTED'
           AND NEW."initiationState" = 'NOT_STARTED' THEN
            RAISE EXCEPTION 'Payment initiationState cannot regress to NOT_STARTED after leaving NOT_STARTED'
                USING ERRCODE = '23514';
        END IF;

        IF OLD."status" <> 'PENDING'
           AND NEW."status" = 'PENDING' THEN
            RAISE EXCEPTION 'Payment status cannot regress from % back to PENDING', OLD."status"
                USING ERRCODE = '23514';
        END IF;

        IF OLD."providerAccountId" IS NOT NULL THEN
            IF NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
               OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment" THEN
                RAISE EXCEPTION 'Historical Payment provider account binding is immutable'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF NEW."providerAccountId" IS NOT NULL THEN
            -- Narrow pre-initiation binding guard: rejects externally initiated,
            -- non-PENDING, previously reconciliation-flagged, or child-linked payments.
            IF OLD."initiationState" <> 'NOT_STARTED'
               OR OLD."status" <> 'PENDING'
               OR OLD."providerPaymentId" IS NOT NULL
               OR OLD."providerTransactionId" IS NOT NULL
               OR OLD."reconciliationRequired" = true
               OR OLD."reconciliationFlaggedAt" IS NOT NULL THEN
                RAISE EXCEPTION 'Cannot assign provider account to Payment % after external initiation, reconciliation flag, or non-PENDING lifecycle state', OLD."id"
                    USING ERRCODE = '23514';
            END IF;

            IF EXISTS (SELECT 1 FROM "MyFatoorahInvoice" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "MyFatoorahWebhookEvent" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefund" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "PaymentRefundConflictAudit" WHERE "paymentId" = OLD."id")
               OR EXISTS (SELECT 1 FROM "MyFatoorahRefundWebhookEvent" WHERE "paymentId" = OLD."id") THEN
                RAISE EXCEPTION 'Cannot assign provider account to Payment % when financial child records already exist', OLD."id"
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    -- B-3: Active authorization applies ONLY to NEW account binding (INSERT or NULL->bound UPDATE).
    -- Already-bound historical payments retain their immutable identity even after account
    -- retirement/deactivation or tenant authorization revocation.
    is_new_binding := (TG_OP = 'INSERT' AND NEW."providerAccountId" IS NOT NULL)
                   OR (TG_OP = 'UPDATE' AND OLD."providerAccountId" IS NULL AND NEW."providerAccountId" IS NOT NULL);

    IF is_new_binding THEN
        IF NEW."provider" = 'NONE' THEN
            RETURN NEW;
        END IF;

        -- B-2: Unlocked read is safe because Order.tenantId is strictly immutable
        -- and Payment.orderId has ON DELETE RESTRICT + immutability (eliminates Order->Payment deadlock).
        SELECT "tenantId" INTO order_tenant
        FROM "Order"
        WHERE "id" = NEW."orderId";
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        -- Lock mutable authorization row FOR SHARE so concurrent revocation serializes cleanly.
        SELECT pat."isActive", pat."revokedAt"
        INTO pat_active, pat_revoked_at
        FROM "PaymentProviderAccountTenant" pat
        WHERE pat."tenantId" = order_tenant
          AND pat."providerAccountId" = NEW."providerAccountId"
          AND pat."provider" = NEW."provider"
          AND pat."environment" = NEW."providerEnvironment"
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Payment provider account % is not authorized for order tenant %', NEW."providerAccountId", order_tenant
                USING ERRCODE = '23514';
        END IF;

        IF pat_active IS NOT TRUE OR pat_revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'Payment provider account % authorization for tenant % is inactive or revoked', NEW."providerAccountId", order_tenant
                USING ERRCODE = '23514';
        END IF;

        -- Lock mutable account status FOR SHARE; strictly require ACTIVE (ROTATING excluded in this phase).
        SELECT acc."status"
        INTO acc_status
        FROM "PaymentProviderAccount" acc
        WHERE acc."id" = NEW."providerAccountId"
        FOR SHARE;

        IF NOT FOUND OR acc_status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'Payment provider account % status % is not ACTIVE for new payment binding', NEW."providerAccountId", acc_status
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. B-4: Durable Refund Attempt INSERT Guard & Full Terminal Freeze
-- ============================================================================
CREATE OR REPLACE FUNCTION enforce_refund_attempt_insert_safety()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."operation" = 'SUBMIT_REFUND' THEN
        IF NEW."state" <> 'PREPARED' THEN
            RAISE EXCEPTION 'New SUBMIT_REFUND PaymentRefundAttempt must start in PREPARED state (got %)', NEW."state"
                USING ERRCODE = '23514';
        END IF;

        IF NEW."completedAt" IS NOT NULL THEN
            RAISE EXCEPTION 'New PREPARED SUBMIT_REFUND PaymentRefundAttempt cannot have completedAt populated'
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM "PaymentRefundAttempt"
            WHERE "refundId" = NEW."refundId"
              AND "operation" = 'SUBMIT_REFUND'
              AND "dispatchedAt" IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'Refund % already has a dispatched SUBMIT_REFUND attempt; additional outbound submission is prohibited', NEW."refundId"
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_refund_attempt_insert_safety
BEFORE INSERT ON "PaymentRefundAttempt"
FOR EACH ROW EXECUTE FUNCTION enforce_refund_attempt_insert_safety();

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

    -- B-4: Complete terminal freeze for SUCCEEDED, DEFINITIVELY_FAILED, and ABANDONED.
    -- Prohibits state changes, injecting previously NULL evidence, mutating metadata,
    -- or altering lease/fencing/failure fields on any terminal attempt.
    IF OLD."state" IN ('SUCCEEDED', 'DEFINITIVELY_FAILED', 'ABANDONED') THEN
        IF NEW."state" IS DISTINCT FROM OLD."state" THEN
            RAISE EXCEPTION 'Cannot transition PaymentRefundAttempt out of terminal state %', OLD."state"
                USING ERRCODE = '23514';
        END IF;
        IF NEW."dispatchOwner" IS DISTINCT FROM OLD."dispatchOwner"
           OR NEW."fencingToken" IS DISTINCT FROM OLD."fencingToken"
           OR NEW."leaseUntil" IS DISTINCT FROM OLD."leaseUntil"
           OR NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt"
           OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
           OR NEW."providerHttpStatus" IS DISTINCT FROM OLD."providerHttpStatus"
           OR NEW."providerRefundId" IS DISTINCT FROM OLD."providerRefundId"
           OR NEW."providerRefundReference" IS DISTINCT FROM OLD."providerRefundReference"
           OR NEW."providerRefundInvoiceId" IS DISTINCT FROM OLD."providerRefundInvoiceId"
           OR NEW."sanitizedResponseMetadata" IS DISTINCT FROM OLD."sanitizedResponseMetadata"
           OR NEW."failureClassification" IS DISTINCT FROM OLD."failureClassification"
           OR NEW."failureCode" IS DISTINCT FROM OLD."failureCode"
           OR NEW."reconciliationReason" IS DISTINCT FROM OLD."reconciliationReason" THEN
            RAISE EXCEPTION 'Terminal PaymentRefundAttempt % is completely frozen; outcome, evidence, lease, and metadata cannot be modified', OLD."id"
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
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

    -- Explicit state transition matrix for non-terminal states:
    --   PREPARED    -> PREPARED | DISPATCHING (with dispatch boundary fields) | DEFINITIVELY_FAILED (never-dispatched pre-flight reject) | ABANDONED (never-dispatched)
    --   DISPATCHING -> DISPATCHING | SUCCEEDED | DEFINITIVELY_FAILED | AMBIGUOUS (never PREPARED or ABANDONED)
    --   AMBIGUOUS   -> AMBIGUOUS | SUCCEEDED (never releases submission ownership)
    IF NEW."state" IS DISTINCT FROM OLD."state" THEN
        IF OLD."state" = 'PREPARED' THEN
            IF NEW."operation" = 'SUBMIT_REFUND' THEN
                IF NEW."state" NOT IN ('DISPATCHING', 'DEFINITIVELY_FAILED', 'ABANDONED') THEN
                    RAISE EXCEPTION 'Illegal SUBMIT_REFUND PaymentRefundAttempt transition from PREPARED to %', NEW."state"
                        USING ERRCODE = '23514';
                END IF;
            ELSE
                IF NEW."state" NOT IN ('DISPATCHING', 'AMBIGUOUS', 'DEFINITIVELY_FAILED', 'ABANDONED', 'SUCCEEDED') THEN
                    RAISE EXCEPTION 'Illegal PaymentRefundAttempt transition from PREPARED to %', NEW."state"
                        USING ERRCODE = '23514';
                END IF;
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

-- ============================================================================
-- 6. B-2 & B-5: Webhook Lineage & Bidirectional Conflict Audit Validation
-- ============================================================================
CREATE OR REPLACE FUNCTION enforce_refund_webhook_lineage()
RETURNS TRIGGER AS $$
DECLARE
    ref_account TEXT;
    ref_env "PaymentProviderEnvironment";
    ref_provider "PaymentProvider";
    pay_account TEXT;
    pay_env "PaymentProviderEnvironment";
    pay_provider "PaymentProvider";
    auth_exists BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Once established, lineage identifiers are immutable; NULL -> non-NULL enrichment is allowed.
        IF NEW."id" IS DISTINCT FROM OLD."id"
           OR NEW."provider" IS DISTINCT FROM OLD."provider"
           OR (OLD."providerAccountId" IS NOT NULL AND (NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId" OR NEW."providerEnvironment" IS DISTINCT FROM OLD."providerEnvironment"))
           OR (OLD."tenantId" IS NOT NULL AND NEW."tenantId" IS DISTINCT FROM OLD."tenantId")
           OR (OLD."orderId" IS NOT NULL AND NEW."orderId" IS DISTINCT FROM OLD."orderId")
           OR (OLD."paymentId" IS NOT NULL AND NEW."paymentId" IS DISTINCT FROM OLD."paymentId")
           OR (OLD."refundId" IS NOT NULL AND NEW."refundId" IS DISTINCT FROM OLD."refundId") THEN
            RAISE EXCEPTION 'Established MyFatoorahRefundWebhookEvent lineage fields are immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Validate refund-level or payment-level provider/account/environment match.
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
    ELSIF NEW."paymentId" IS NOT NULL THEN
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
            RAISE EXCEPTION 'Payment-level MyFatoorahRefundWebhookEvent provider/account/environment must match original Payment'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Historical tenant-account authorization check whenever both tenantId and providerAccountId are set
    -- (does NOT require isActive=true because late webhooks may arrive for deactivated/retired accounts).
    IF NEW."tenantId" IS NOT NULL AND NEW."providerAccountId" IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM "PaymentProviderAccountTenant" pat
            WHERE pat."tenantId" = NEW."tenantId"
              AND pat."providerAccountId" = NEW."providerAccountId"
              AND pat."provider" = NEW."provider"
              AND pat."environment" = NEW."providerEnvironment"
        ) INTO auth_exists;

        IF NOT auth_exists THEN
            RAISE EXCEPTION 'MyFatoorahRefundWebhookEvent provider account % is not authorized for tenant %', NEW."providerAccountId", NEW."tenantId"
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Reverse compatibility check on UPDATE: unresolved-to-resolved enrichment must not
    -- contradict any existing PaymentRefundConflictAudit referencing this webhook event.
    IF TG_OP = 'UPDATE' THEN
        IF EXISTS (
            SELECT 1
            FROM "PaymentRefundConflictAudit" ca
            WHERE ca."webhookEventId" = OLD."id"
              AND (
                  NEW."provider" IS DISTINCT FROM ca."provider"
                  OR (NEW."providerAccountId" IS NOT NULL AND (ca."providerAccountId" IS DISTINCT FROM NEW."providerAccountId" OR ca."providerEnvironment" IS DISTINCT FROM NEW."providerEnvironment"))
                  OR (NEW."tenantId" IS NOT NULL AND ca."tenantId" IS DISTINCT FROM NEW."tenantId")
                  OR (NEW."orderId" IS NOT NULL AND ca."orderId" IS DISTINCT FROM NEW."orderId")
                  OR (NEW."paymentId" IS NOT NULL AND ca."paymentId" IS DISTINCT FROM NEW."paymentId")
                  OR (NEW."refundId" IS NOT NULL AND ca."refundId" IS DISTINCT FROM NEW."refundId")
              )
        ) THEN
            RAISE EXCEPTION 'MyFatoorahRefundWebhookEvent enrichment contradicts an existing PaymentRefundConflictAudit record'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "trg_enforce_refund_webhook_account_match" ON "MyFatoorahRefundWebhookEvent";
CREATE TRIGGER trg_enforce_refund_webhook_account_match
BEFORE INSERT OR UPDATE ON "MyFatoorahRefundWebhookEvent"
FOR EACH ROW EXECUTE FUNCTION enforce_refund_webhook_lineage();

-- B-2 & B-5: Upgrade ConflictAudit match trigger:
--   * Unlocked PaymentRefundAttempt.refundId check (eliminates Attempt<->Refund deadlock;
--     safe because Attempt.refundId is immutable, DELETE is blocked, and FK takes FOR KEY SHARE).
--   * Full NULL-safe webhookEventId lineage verification with FOR SHARE on referenced webhook.
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
    wh_provider "PaymentProvider";
    wh_account TEXT;
    wh_env "PaymentProviderEnvironment";
    wh_tenant TEXT;
    wh_order TEXT;
    wh_payment TEXT;
    wh_refund TEXT;
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
            -- B-2: Unlocked read is safe because PaymentRefundAttempt.refundId is strictly
            -- immutable and DELETE is prohibited; implicit FK acquires FOR KEY SHARE (compatible
            -- with FOR NO KEY UPDATE on non-key Attempt updates).
            SELECT "refundId" INTO att_refund
            FROM "PaymentRefundAttempt"
            WHERE "id" = NEW."attemptId";

            IF FOUND AND att_refund IS DISTINCT FROM NEW."refundId" THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit attemptId does not belong to refundId'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF NEW."paymentId" IS NOT NULL THEN
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

    -- B-5: Validate referenced MyFatoorahRefundWebhookEvent lineage (NULL-safe rules).
    IF NEW."webhookEventId" IS NOT NULL THEN
        SELECT "provider", "providerAccountId", "providerEnvironment", "tenantId", "orderId", "paymentId", "refundId"
        INTO wh_provider, wh_account, wh_env, wh_tenant, wh_order, wh_payment, wh_refund
        FROM "MyFatoorahRefundWebhookEvent"
        WHERE "id" = NEW."webhookEventId"
        FOR SHARE;

        IF FOUND THEN
            IF wh_provider IS DISTINCT FROM NEW."provider" THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit provider contradicts referenced MyFatoorahRefundWebhookEvent'
                    USING ERRCODE = '23514';
            END IF;

            IF wh_account IS NOT NULL
               AND (NEW."providerAccountId" IS DISTINCT FROM wh_account OR NEW."providerEnvironment" IS DISTINCT FROM wh_env) THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit provider account/environment contradicts referenced MyFatoorahRefundWebhookEvent'
                    USING ERRCODE = '23514';
            END IF;

            IF wh_tenant IS NOT NULL AND NEW."tenantId" IS DISTINCT FROM wh_tenant THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit tenantId contradicts referenced MyFatoorahRefundWebhookEvent'
                    USING ERRCODE = '23514';
            END IF;

            IF wh_order IS NOT NULL AND NEW."orderId" IS DISTINCT FROM wh_order THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit orderId contradicts referenced MyFatoorahRefundWebhookEvent'
                    USING ERRCODE = '23514';
            END IF;

            IF wh_payment IS NOT NULL AND NEW."paymentId" IS DISTINCT FROM wh_payment THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit paymentId contradicts referenced MyFatoorahRefundWebhookEvent'
                    USING ERRCODE = '23514';
            END IF;

            IF wh_refund IS NOT NULL AND NEW."refundId" IS DISTINCT FROM wh_refund THEN
                RAISE EXCEPTION 'PaymentRefundConflictAudit refundId contradicts referenced MyFatoorahRefundWebhookEvent'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
