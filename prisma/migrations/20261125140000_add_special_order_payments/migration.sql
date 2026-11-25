-- CreateEnum
CREATE TYPE "SpecialOrderObligationKind" AS ENUM ('INITIAL', 'BALANCE');

-- CreateEnum
CREATE TYPE "SpecialOrderObligationMethod" AS ENUM ('ONLINE', 'CASH');

-- CreateTable
CREATE TABLE "SpecialOrderPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "SpecialOrderObligationKind" NOT NULL,
    "method" "SpecialOrderObligationMethod" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderPaymentAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerEnvironment" "PaymentProviderEnvironment" NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "checkoutUrl" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "initiationState" "PaymentInitiationState" NOT NULL DEFAULT 'IN_PROGRESS',
    "conflictCode" TEXT,
    "claimToken" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "recheckAt" TIMESTAMPTZ(3),
    "mockStatus" "PaymentStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialOrderPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialOrderPaymentSettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "transactionId" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "attributable" BOOLEAN NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialOrderPaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPayment_tenantId_id_key" ON "SpecialOrderPayment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPayment_tenantId_orderId_kind_key" ON "SpecialOrderPayment"("tenantId", "orderId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPaymentAttempt_invoiceId_key" ON "SpecialOrderPaymentAttempt"("invoiceId");

-- CreateIndex
CREATE INDEX "SpecialOrderPaymentAttempt_recheckAt_idx" ON "SpecialOrderPaymentAttempt"("recheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPaymentAttempt_tenantId_id_key" ON "SpecialOrderPaymentAttempt"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPaymentAttempt_tenantId_obligationId_idempotenc_key" ON "SpecialOrderPaymentAttempt"("tenantId", "obligationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SpecialOrderPaymentSettlement_provider_transactionId_idx" ON "SpecialOrderPaymentSettlement"("provider", "transactionId");

-- CreateIndex
CREATE INDEX "SpecialOrderPaymentSettlement_provider_providerTransactionI_idx" ON "SpecialOrderPaymentSettlement"("provider", "providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrderPaymentSettlement_tenantId_attemptId_providerTr_key" ON "SpecialOrderPaymentSettlement"("tenantId", "attemptId", "providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialOrder_tenantId_id_key" ON "SpecialOrder"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "SpecialOrderPayment" ADD CONSTRAINT "SpecialOrderPayment_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "SpecialOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderPaymentAttempt" ADD CONSTRAINT "SpecialOrderPaymentAttempt_tenantId_obligationId_fkey" FOREIGN KEY ("tenantId", "obligationId") REFERENCES "SpecialOrderPayment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialOrderPaymentAttempt" ADD CONSTRAINT "SpecialOrderPaymentAttempt_providerAccountId_provider_prov_fkey" FOREIGN KEY ("providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccount"("id", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SpecialOrderPaymentAttempt" ADD CONSTRAINT "SpecialOrderPaymentAttempt_tenantId_providerAccountId_prov_fkey" FOREIGN KEY ("tenantId", "providerAccountId", "provider", "providerEnvironment") REFERENCES "PaymentProviderAccountTenant"("tenantId", "providerAccountId", "provider", "environment") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SpecialOrderPaymentSettlement" ADD CONSTRAINT "SpecialOrderPaymentSettlement_tenantId_attemptId_fkey" FOREIGN KEY ("tenantId", "attemptId") REFERENCES "SpecialOrderPaymentAttempt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One payable or uncertain attempt per obligation, including crashed claims.
CREATE UNIQUE INDEX "SpecialOrderPaymentAttempt_one_active"
  ON "SpecialOrderPaymentAttempt" ("tenantId", "obligationId")
  WHERE "status" NOT IN ('FAILED', 'CANCELLED', 'PAID');

ALTER TABLE "SpecialOrderPayment"
  ADD CONSTRAINT "SpecialOrderPayment_terms_check" CHECK (
    "amount" >= 0 AND (
      ("kind" = 'INITIAL' AND "method" = 'ONLINE' AND "expiresAt" IS NOT NULL AND "amount" > 0)
      OR ("kind" = 'BALANCE' AND "expiresAt" IS NULL)
    )
  );

ALTER TABLE "SpecialOrderPaymentAttempt"
  ADD CONSTRAINT "SpecialOrderPaymentAttempt_gateway_check" CHECK (
    "provider" = 'MYFATOORAH' AND "providerEnvironment" IN ('MOCK', 'SANDBOX')
    AND ("mockStatus" IS NULL OR "providerEnvironment" = 'MOCK')
  ),
  ADD CONSTRAINT "SpecialOrderPaymentAttempt_lease_check" CHECK (
    ("claimToken" IS NULL) = ("leaseUntil" IS NULL)
  );

ALTER TABLE "SpecialOrderPaymentSettlement"
  ADD CONSTRAINT "SpecialOrderPaymentSettlement_amount_check" CHECK ("amount" > 0);

-- Serializes regular and special invoice claims without changing regular ownership.
CREATE FUNCTION guard_special_invoice_namespace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."invoiceId" IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gateway-invoice:' || NEW."invoiceId", 0));
  IF TG_TABLE_NAME = 'MyFatoorahInvoice' THEN
    IF EXISTS (SELECT 1 FROM "SpecialOrderPaymentAttempt" WHERE "invoiceId" = NEW."invoiceId") THEN
      RAISE unique_violation USING MESSAGE = 'Invoice already belongs to a Special Order';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "MyFatoorahInvoice" WHERE "invoiceId" = NEW."invoiceId") THEN
      RAISE unique_violation USING MESSAGE = 'Invoice already belongs to a regular order';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "MyFatoorahInvoice_special_namespace_guard"
BEFORE INSERT OR UPDATE OF "invoiceId" ON "MyFatoorahInvoice"
FOR EACH ROW EXECUTE FUNCTION guard_special_invoice_namespace();

CREATE TRIGGER "SpecialOrderPaymentAttempt_invoice_namespace_guard"
BEFORE INSERT OR UPDATE OF "invoiceId" ON "SpecialOrderPaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION guard_special_invoice_namespace();

-- Verified but unattributed observations can be recorded for reconciliation.
CREATE FUNCTION guard_special_collection_namespace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity text;
BEGIN
  IF TG_TABLE_NAME = 'Payment' THEN
    IF NEW."providerTransactionId" IS NULL OR NEW."provider" <> 'MYFATOORAH' THEN RETURN NEW; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('gateway-collection:' || NEW."providerTransactionId", 0));
    IF EXISTS (
      SELECT 1 FROM "SpecialOrderPaymentSettlement"
      WHERE "provider" = NEW."provider" AND "attributable"
        AND NEW."providerTransactionId" IN ("transactionId", "providerTransactionId")
    ) THEN
      RAISE unique_violation USING MESSAGE = 'Collection already belongs to a Special Order';
    END IF;
  ELSE
    IF NOT NEW."attributable" THEN RETURN NEW; END IF;
    FOR identity IN SELECT DISTINCT unnest(ARRAY[NEW."transactionId", NEW."providerTransactionId"]) ORDER BY 1 LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('gateway-collection:' || identity, 0));
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM "Payment"
      WHERE "provider" = NEW."provider"
        AND "providerTransactionId" IN (NEW."transactionId", NEW."providerTransactionId")
    ) OR EXISTS (
      SELECT 1 FROM "SpecialOrderPaymentSettlement"
      WHERE "provider" = NEW."provider" AND "attributable" AND id <> NEW.id
        AND ("transactionId" IN (NEW."transactionId", NEW."providerTransactionId")
          OR "providerTransactionId" IN (NEW."transactionId", NEW."providerTransactionId"))
    ) THEN
      RAISE unique_violation USING MESSAGE = 'Collection already attributed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Payment_special_collection_namespace_guard"
BEFORE INSERT OR UPDATE OF "provider", "providerTransactionId" ON "Payment"
FOR EACH ROW EXECUTE FUNCTION guard_special_collection_namespace();

CREATE TRIGGER "SpecialOrderPaymentSettlement_collection_namespace_guard"
BEFORE INSERT OR UPDATE OF "provider", "transactionId", "providerTransactionId", "attributable" ON "SpecialOrderPaymentSettlement"
FOR EACH ROW EXECUTE FUNCTION guard_special_collection_namespace();
