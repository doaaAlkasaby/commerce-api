-- Additive provider references and webhook audit; existing payments/data are retained.
ALTER TYPE "PaymentProvider" ADD VALUE 'MYFATOORAH';
CREATE TYPE "GatewayEventState" AS ENUM ('PROCESSED', 'RECONCILIATION_REQUIRED');
ALTER TABLE "Payment"
  ADD COLUMN "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reconciliationReason" TEXT;
CREATE TABLE "MyFatoorahInvoice" (
  "paymentId" TEXT NOT NULL PRIMARY KEY,
  "invoiceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MyFatoorahInvoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MyFatoorahInvoice_invoiceId_key" ON "MyFatoorahInvoice"("invoiceId");
CREATE TABLE "MyFatoorahWebhookEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventReference" TEXT NOT NULL,
  "canonicalHash" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "transactionPaymentId" TEXT NOT NULL,
  "state" "GatewayEventState" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MyFatoorahWebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MyFatoorahWebhookEvent_eventReference_key" ON "MyFatoorahWebhookEvent"("eventReference");
CREATE UNIQUE INDEX "MyFatoorahWebhookEvent_canonicalHash_key" ON "MyFatoorahWebhookEvent"("canonicalHash");
CREATE INDEX "MyFatoorahWebhookEvent_paymentId_idx" ON "MyFatoorahWebhookEvent"("paymentId");
CREATE INDEX "MyFatoorahWebhookEvent_state_createdAt_idx" ON "MyFatoorahWebhookEvent"("state", "createdAt");
