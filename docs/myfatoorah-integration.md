# MyFatoorah Kuwait sandbox integration — Phase 3

Implemented 2026-10-31 on `hardening/tenant-isolation`. This integrates hosted invoices
with the existing payment lifecycle. No live credentials were available, no external
provider HTTP requests were made during verification, and no real invoice or charge
was created. Provider HTTP is mocked in automated tests; PostgreSQL is real.

## Supported protocol and activation gate

This adapter consistently uses **REST API V2**:

- `POST https://apitest.myfatoorah.com/v2/SendPayment`
- `POST https://apitest.myfatoorah.com/v2/GetPaymentStatus`

Notifications use **Webhook V2**, `PAYMENT_STATUS_CHANGED` (event code 1). REST API
version and webhook version are distinct protocol selections. There are no V3 calls,
embedded card fields, SDK/token handling, or undocumented provider operations.

These contracts are documented by MyFatoorah. Compatibility of the user's actual
Kuwait credentials with V2 has **not** been verified: no token or portal account was
provided. Before activation, confirm that the selected sandbox token has permissions
for both endpoints, belongs to a Kuwait account with **KWD base currency**, and supports
this V2 integration. Do not configure V3-only credentials as V2 or mix versions.
`MYFATOORAH_API_VERSION` accepts only `v2`; other versions fail validation.

`InvoiceValue` in V2 is in the account's base currency. `DisplayCurrencyIso` is a
presentation setting, not a safe substitute for the account currency check. The
configuration therefore requires explicit Kuwait/KWD account declarations. **These
are operator attestations, not automated account discovery or proof about a token.**
Do not enable the gateway until the account/version/base-currency check has actually
been completed in the portal and verified with a controlled sandbox transaction.

## Configuration

The default remains `PAYMENT_PROVIDER=NONE`. Existing COD/bank-transfer behavior and
baseline tests remain available. Selecting MYFATOORAH requires all the mandatory
settings below; missing/invalid settings fail application startup rather than falling
back to NONE. Production gateway activation is intentionally unavailable in this phase;
`MYFATOORAH_ENV` accepts only `sandbox`, and the API origin is fixed in code.

```dotenv
PAYMENT_PROVIDER=MYFATOORAH
MYFATOORAH_ENV=sandbox
MYFATOORAH_API_VERSION=v2
MYFATOORAH_ACCOUNT_COUNTRY=KWT
MYFATOORAH_ACCOUNT_CURRENCY=KWD
MYFATOORAH_API_TOKEN=<secret-manager-token>
MYFATOORAH_WEBHOOK_SECRET=<portal-generated-secret>
MYFATOORAH_CALLBACK_URL=https://api.example.com/api/v1/payment-providers/myfatoorah/callback
MYFATOORAH_ERROR_URL=https://api.example.com/api/v1/payment-providers/myfatoorah/error
MYFATOORAH_TIMEOUT_MS=10000
```

Use secret injection/mounted environment configuration. Never commit actual keys,
log Authorization headers or provider bodies, or pass provider credentials to Flutter.
The example file contains no real keys. Return URLs must be HTTPS, not localhost,
and no more than 254 characters. A public HTTPS development tunnel can be configured
by the operator; this implementation does not register a tunnel or change portal settings.
The timeout is bounded to 1–30000 ms. Provider error messages/bodies are not forwarded,
and gateway secrets/signature headers are included in logger redaction rules.

The application supports CARD through this hosted gateway. COD and bank transfer
continue using NONE. Digital-wallet-specific initiation remains unsupported. The
hosted invoice page displays the methods enabled for the account; this phase does
not invent payment-method IDs or collect raw card data.

## Existing lifecycle and hosted flow

1. Flutter calls the existing checkout endpoint with `paymentMethod: "CARD"` and the
   existing tenant/authentication/verified-email/idempotency requirements. With the
   gateway selected, omitted `paymentProvider` resolves to MYFATOORAH. Explicit provider
   fields retain their existing names. NONE remains the default when the gateway is off.
2. Checkout commits order, payment, reservation, coupon usage and idempotency state.
   It does **not** call the provider. Pricing, tax, preview and transaction calculations
   are unchanged. The request fingerprint remains stable for checkout replay.
3. Flutter calls the existing `POST /api/v1/payments/:id/initiate`, body `{}`, with its
   bearer token and `X-Tenant-Slug`. The service checks persisted order/customer/tenant
   ownership, eligibility, amount/currency and provider configuration.
4. A short order-locked transaction claims `PaymentInitiationState=IN_PROGRESS`, then
   commits. Only afterward does the adapter call SendPayment. CustomerReference is the
   local payment UUID; UserDefinedField is the local order UUID. Generic customer naming
   is used; no extra personal information is sent.
5. The invoice ID is persisted in the existing `providerPaymentId` field and the unique
   `MyFatoorahInvoice` mapping. The hosted URL is stored at **`metadata.checkoutUrl`**.
   `providerTransactionId` is populated from the verified transaction's TransactionId.
   Initiation becomes INITIATED with local status REQUIRES_ACTION.
6. Flutter opens the hosted URL. The return URL is only a UX signal. It closes the
   hosted view and asks the backend to verify the payment; it never submits a success
   assertion or provider token.

The existing initiation response shape is unchanged. An excerpt of its existing fields:

```json
{
  "success": true,
  "message": null,
  "data": {
    "id": "<local-payment-uuid>",
    "orderId": "<local-order-uuid>",
    "provider": "MYFATOORAH",
    "method": "CARD",
    "status": "REQUIRES_ACTION",
    "initiationState": "INITIATED",
    "amount": "10.25",
    "currency": "KWD",
    "providerPaymentId": "100001",
    "metadata": {
      "checkoutUrl": "https://demo.myfatoorah.com/ie/example",
      "providerMetadata": { "apiVersion": "v2", "environment": "sandbox" }
    }
  }
}
```

Other existing PaymentResponse fields, including timestamps, failure fields and provider
transaction ID, remain present. This is an excerpt, not a replacement response schema.
Only HTTPS URLs from `demo.myfatoorah.com` are accepted; provider HTTP redirects are not
followed, so authorization cannot be forwarded to a redirected origin.

Concurrent initiation is serialized by the existing order lock/claim. Duplicate completed
initiation returns the saved result without HTTP. SendPayment has no documented idempotency
guarantee, so this adapter never automatically repeats UNKNOWN creation, even with the same
local key. Timeouts, malformed/missing replies, explicit provider rejection or failed reply
persistence conservatively leave UNKNOWN with the order/reservation intact. A rejection
is not used as permission to blindly retry an invoice creation. No idempotency header
from a different API version is invented.

A signed webhook arriving before the creation reply is persisted can recover the invoice
through authenticated provider references while the local claim is IN_PROGRESS/UNKNOWN.
The later creation reply cannot downgrade a payment already verified as paid. An early
pending verification still allows the creation reply to persist the hosted URL.

Contradictory provider results (a successful transaction on an unpaid invoice, or an
authorization/open transaction on a canceled invoice) fail closed and flag the mapped
payment for reconciliation without releasing reserved stock.

## KWD precision and currency limitations

Phase 3B supersedes the original Phase 3 two-decimal limitation. Shared money policy and
NUMERIC(14,4) storage now support exact KWD third decimals, including 0.001. This Kuwait
adapter accepts positive KWD up to 9,999,999,999.999, rejects excess precision, and writes
three-decimal JSON numeric major units without conversion or scaling. Other currencies
remain unsupported by this account-specific adapter. See
[currency and money policy](currency-and-money-policy.md) for rounding, storage, catalog,
upgrade verification and client formatting details. The Phase 3 results below are a
historical implementation checkpoint; live provider verification is still outstanding.

## Additive endpoints and Flutter behavior

All paths below use the current default `/api/v1` prefix; `API_PREFIX` still controls it.

| Endpoint                                     | Authentication / request                                     | Response and purpose                                                                       |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `POST /payments/:id/verify`                  | Existing tenant header + customer bearer JWT; body `{}` only | 200, existing PaymentResponse envelope after authoritative lookup.                         |
| `POST /payment-providers/myfatoorah/webhook` | Provider signature; JSON; no customer JWT or tenant header   | 200 envelope with `data.received` and `data.reconciliationRequired` after safe processing. |
| `GET /payment-providers/myfatoorah/callback` | Public UX return; query fields are ignored                   | 200 envelope with `data.verified=false`; no status mutation.                               |
| `GET /payment-providers/myfatoorah/error`    | Public UX return; query fields are ignored                   | Same UX response; no status mutation.                                                      |

Existing `POST /payments/:id/initiate`, GET payment/order-payment routes, and protected
admin routes retain their paths, methods, body fields and response shapes. GET payment
remains a persisted read; it does not silently make a provider request. The new verification
endpoint accepts no client invoice ID, amount, currency, tenant ID or status. Existing
trusted admin confirmation APIs retain their existing privileges and centralized rules;
no additional customer confirmation capability is introduced.

Flutter gateway enablement needs: recognize MYFATOORAH as an additional provider value,
read `metadata.checkoutUrl`, open it in the hosted-payment browser, intercept configured
return paths, and call the new verification endpoint with the local payment ID. Refresh
on app resume if the customer closes the page without returning. Pending/unknown results
must remain pending in the UI. Treat 409 as reconciliation-required, not as permission to
create another payment. Never use callback query `paymentId` or a `status=success` value
as proof of payment. The backend fetches the persisted invoice itself.

Existing clients using NONE require no changes. Deploy Flutter's new-provider parsing
before opting the server into MYFATOORAH; older strict enum decoders may not understand a
new provider value. Default NONE does not expose them to the new provider automatically.

## Webhook V2 security and canonicalization

In the sandbox portal configure Webhook V2 with the public webhook URL, enable the secure
key, and select **PAYMENT_STATUS_CHANGED only**. Store the generated secret securely.
Configure provider retries and verify actual delivery in the portal. Other event types,
refunds, recurring events and disputes are not implemented; do not subscribe them here.

The dedicated route has a **32 KiB** JSON limit before the application's normal body parser.
Oversized/malformed JSON returns controlled 413/400 envelopes. Missing/invalid
`MyFatoorah-Signature` returns 401 before DB lookup or provider HTTP. Customer JWT is not
required for provider-to-server delivery; existing application security middleware remains.

For this specific event, build the exact ordered string (null/absent values become empty):

```text
Invoice.Id=<id>,Invoice.Status=<status>,Transaction.Status=<status>,Transaction.PaymentId=<id>,Invoice.ExternalIdentifier=<value>
```

HMAC-SHA256 is computed over this UTF-8 string using the UTF-8 secret; compare the binary
digest to the base64-decoded signature using constant-time comparison after validating
length/encoding. This is **not** an HMAC of raw JSON. The algorithm is event-specific,
not a generic formula for every MyFatoorah webhook. An independent fixed HMAC vector is
tested in addition to signed HTTP deliveries and signed-field tampering.

The signature does not cover every payload property. The backend never trusts webhook
amounts, tenant IDs, customer references, card data, timestamps or other unsigned fields
as financial authority. It queries the official status API and uses persisted identity.
No raw provider payload/card details are saved. A signed transaction payment ID must occur
among the authoritative invoice transactions.

## Trusted status verification, transitions and inventory

The backend queries GetPaymentStatus using the **persisted invoice ID**, then checks:

- Matching returned invoice ID, local CustomerReference/payment UUID and UserDefinedField/order UUID.
- Exact persisted payment/order amount and currency agreement.
- KWD display/base-amount agreement (`KD` in V2 responses is the documented Kuwait alias).
- Exact selected transaction amount/currency and, if supplied, paid currency/value.
- A Paid invoice has exactly one successful `Succss` transaction. Unknown/inconsistent
  provider results produce controlled errors, not fabricated payment success.

Invoice Paid normalizes to PAID only after those checks. A still-Pending invoice remains
nonterminal even when an individual attempt failed. Authorize normalizes to AUTHORIZED,
retaining reservations. A Canceled invoice is terminal: a failed transaction normalizes
to FAILED; otherwise cancellation normalizes to CANCELLED. Partial/multiple-success
settlement is not guessed. The original centralized transition rules determine whether
any local transition may occur.

Provider HTTP is outside transactions. Financial application then locks the owning order,
revalidates local identity/money, calls `PaymentService.applyPaymentStatusWithClient`,
and records the event atomically. Successful verification commits reserved inventory via
the existing sale transition; terminal failure releases only under existing safety rules.
Duplicates cannot double-sell or double-release. Pending observations cannot resurrect a
terminal state, downgrade REQUIRES_ACTION, or release inventory.

Late success after failure/cancellation/expiration/release does not rewrite history or
invent a refund. The failed financial transaction rolls back first; a fresh order-locked
transaction sets `Payment.reconciliationRequired/reconciliationReason` and records the
webhook as RECONCILIATION_REQUIRED. Webhooks acknowledge this durable audit with HTTP 200
so retries do not repeatedly attempt an impossible transition. Customer verification
returns the existing 409 error envelope and also records the flag. Failure after paid is
handled with the same terminal-history protection.

## Durable event identity and recovery

Migration `20261031100000_myfatoorah_gateway` is forward-only/additive:

- Adds MYFATOORAH to PaymentProvider, leaving existing provider values intact.
- Adds Payment reconciliation fields with safe defaults for existing rows.
- Adds a one-to-one payment/invoice mapping with unique invoice ID.
- Adds event references, canonical signed-data hashes, processing outcome and reason.

The original 12 migrations are unchanged. A 12-to-13 upgrade rehearsal preserved an
existing NONE payment, money, timestamps and metadata, verified unchanged old checksums,
and produced an empty drift comparison. No money columns were changed and no `db push`
or reset was used.

Event.Reference itself is unsigned. Dedupe therefore uses both its unique reference and
a unique hash of the **signed canonical tuple**. Changing an unsigned reference on a replay
cannot settle again; reusing a reference for different signed data produces a controlled
conflict. Same-order concurrent deliveries serialize on the existing order lock. Audit
records and successful transitions commit together; transaction failures roll back both.

If the creation reply was lost, a signed invoice notification may recover the mapping only
by querying the provider and matching its authenticated local payment/order references to
an IN_PROGRESS/UNKNOWN MYFATOORAH payment. Unknown invoices without such a trusted mapping
return 404 and never accept webhook-supplied tenant identity. HTTP verification failures
return controlled errors for provider retry; they never mean payment failure.

Operator reconciliation can inspect flags/events with read-only queries, for example:

```sql
SELECT id, "orderId", status, "initiationState", "providerPaymentId", "reconciliationReason"
FROM "Payment" WHERE "reconciliationRequired" = true;
SELECT "paymentId", "invoiceId", "eventReference", state, reason, "createdAt"
FROM "MyFatoorahWebhookEvent" WHERE state = 'RECONCILIATION_REQUIRED';
```

Use the provider portal and matching authoritative IDs to reconcile; do not reset UNKNOWN,
clear a financial flag, re-run SendPayment, or fabricate refunds blindly. A lost response
may leave no hosted URL to recover automatically; this requires operator handling. There
are no background workers or automatic refund/cancellation calls. Local order expiration
may close a reservation while a remote invoice exists; late money collection is flagged.
Missed webhooks require customer verification on resume or operator reconciliation.

## Errors and operational limits

The existing `{success,message,code,data}` error envelope is retained. New errors include
unsupported/unsafe currency (400/409), invalid signatures (401), unknown invoices (404),
reference/state/money conflicts (409), oversized bodies (413), invalid provider responses
or rejection/authentication (502), and transport timeout/unavailability/unknown outcomes
(503). Provider messages are discarded, not exposed. Missing selected gateway settings
fail startup. Existing error/status semantics for NONE are unchanged.

Provider responses are capped at 1 MiB, have a request/read timeout, use verified HTTPS
through native fetch, and are parsed with Zod. Status lookups can be rate-limited by the
provider; Flutter should use bounded polling/backoff rather than tight loops. Portal
retry configuration, request capacity and a stable HTTPS webhook endpoint still require
operator setup and live sandbox confirmation.

Cancellation/refund behavior for MYFATOORAH is deliberately unsupported and returns a
controlled conflict rather than simulating provider operations. Existing NONE operations
remain functional. This phase adds no gateway-specific settlement workers, production
routing, live-mode switch, refunds, recurring payments or database monetary redesign.

## Local verification and actual status

```sh
docker compose up -d postgres-test
npm run test:postgres -- tests/payments
npm run test:postgres
npm run db:verify
npm run typecheck
npm run build
npx prisma validate --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

The disposable runner deploys all migrations, checks for drift, enables every existing
hardening integration suite, and removes only its generated database. No live token is
required. Tests use non-live mock keys and mocked provider HTTP; fixtures cover initiation,
exact persisted money, KWD limits, configuration, duplicate/concurrent requests, uncertain
outcomes, signed/tampered/duplicate/out-of-order webhooks, authority mismatches, tenant and
customer denial, callbacks, pending/failure/success settlement, stock exactly-once behavior,
late reconciliation, early-webhook/late-initiation-reply races, NONE and checkout replay.

Final full run: **670 passed, 0 failed, 0 skipped**, 42 files (617 baseline + 53 new
gateway cases). Separate Points 1–14 regression run: **380 passed, 0 failed, 0 skipped**,
five files. Typecheck, production build, strict gateway-test typecheck, Prisma validate/
generate (7.10.1), fresh 13-migration deployment and schema comparison all pass.
Focused ESLint/Prettier and `git diff --check` pass. The full baseline
before Phase 3 was 617 passing tests; none was removed, skipped or weakened.

**Live sandbox verification is blocked:** credentials, actual token API-version/country/
base-currency confirmation, public return/webhook URLs and portal signature/retry settings
were not available. Mock tests do not establish actual portal compatibility, invoice link
opening, webhook delivery, payment-method availability or end-to-end sandbox settlement.
Before production activation, complete those sandbox checks, approve full monetary-policy
limitations, update Flutter, and implement/review a separate live-environment activation
plan. Do not point this sandbox-only adapter at production by changing a URL manually.

## API compatibility and files

Existing paths/methods, request field names, response shapes, authentication,
verified-email requirements, tenant headers and envelopes are preserved. The changes
are four additive endpoints, a new provider enum value when the feature is selected,
and safe new values in the existing metadata field. NONE defaults remain compatible.
Flutter changes are needed to use the new gateway, not to continue the existing NONE flow.
No existing endpoint or field was removed or renamed. Breaking changes: **NO** for existing
contracts/default behavior; opting into the new provider requires a compatible client.

Phase 3 files changed/added:

- `src/config/payment-options.ts`, `src/config/env.ts`, `.env.example`
- `src/modules/payments/providers/myfatoorah.provider.ts`,
  `payment-provider.ts`, `payment-provider.registry.ts`
- `src/modules/payments/payment.service.ts`, `payment.repository.ts`, `payment.types.ts`,
  `payment.controller.ts`, `payment.routes.ts`, `payment-verification.service.ts`,
  `myfatoorah.webhook.ts`, `myfatoorah.routes.ts`
- `src/modules/checkout/checkout.service.ts` (provider selection only), `src/app.ts`,
  `src/common/logger/logger.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261031100000_myfatoorah_gateway/migration.sql`
- `tests/payments/myfatoorah.integration.test.ts`, `docs/myfatoorah-integration.md`,
  `docs/testing.md`, `docs/production-database.md` (current migration-count note)

No commit, push or deployment. Existing user edits including `todo.txt` and
`todo_production.txt` were preserved.

Official sources checked 2026-10-31:
[API/account environments](https://docs.myfatoorah.com/docs/api-key),
[SendPayment](https://docs.myfatoorah.com/docs/send-payment),
[GetPaymentStatus](https://docs.myfatoorah.com/docs/get-payment-status),
[Webhook V2](https://docs.myfatoorah.com/docs/webhook-v2),
[payment-event signed fields](https://docs.myfatoorah.com/docs/webhook-v2-payment-status-data-model),
[signature encoding](https://docs.myfatoorah.com/docs/webhook-signature),
[currency lookups](https://docs.myfatoorah.com/docs/iso-lookups),
[idempotency scope](https://docs.myfatoorah.com/docs/idempotency).

## A–X completion report

| Item                             | Result                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A. Existing payment architecture | Reused post-commit initiation, PaymentInitiationState, owning-order locks and centralized transitions.                                 |
| B. Adapter                       | Dedicated REST V2 SendPayment/GetPaymentStatus adapter; no V3 mixing.                                                                  |
| C. Configuration                 | Sandbox-only, explicit V2/KWT/KWD attestations, required secrets and HTTPS returns; startup fails closed.                              |
| D. KWD                           | Historical Phase 3 limit superseded by Phase 3B: exact third-fils KWD now supported.                                                   |
| E. Initiation                    | Existing claim and endpoint; duplicate/reentrant requests do not create another invoice; UNKNOWN is not automatically retried.         |
| F. Flutter contract              | Existing PaymentResponse with metadata.checkoutUrl; new verification endpoint.                                                         |
| G. Webhook                       | Dedicated public provider endpoint, no customer JWT, 32 KiB body limit.                                                                |
| H. Signature                     | Official event-specific UTF-8 canonicalization, HMAC-SHA256/base64 and constant-time comparison.                                       |
| I. Event identity                | Durable unique references plus signed-tuple hashes; unsigned reference changes cannot bypass dedupe.                                   |
| J. Provider verification         | Authenticated status API; invoice/order/payment, money, currency and transaction identity validated.                                   |
| K. Transitions                   | Existing rules remain authoritative; contradictory terminal events are flagged, not replayed into terminal history.                    |
| L. Inventory                     | Existing reserve/sale/release behavior; duplicate and concurrent deliveries do not double-settle.                                      |
| M. Tenant isolation              | Customer ownership checked first; webhooks resolve persisted mappings/provider references, never payload tenant IDs.                   |
| N. Errors                        | Controlled existing envelope; no provider messages, credentials or raw card payloads exposed.                                          |
| O. PostgreSQL tests              | 670 passed, 0 failed, 0 skipped.                                                                                                       |
| P. Hardening                     | Separate 380/380 pass; all 617 prior tests retained and green.                                                                         |
| Q. Prisma                        | One additive migration, 13 total; existing 12 checksums unchanged; historical payment upgrade and drift checks pass.                   |
| R. Typecheck/build               | PASS.                                                                                                                                  |
| S. Lint/format/diff              | Focused checks PASS.                                                                                                                   |
| T. Files                         | Exact Phase 3 file list above; previous phase and user edits preserved.                                                                |
| U. API compatibility             | Existing contracts/default NONE behavior preserved; four additive endpoints and opt-in new provider. Breaking changes NO.              |
| V. Flutter work                  | Required for the new feature: provider enum, hosted browser, return interception and backend verification. None required to keep NONE. |
| W. Live sandbox verification     | BLOCKED: no supplied credentials/account confirmation, live invoice flow, public webhook/returns or portal setup. HTTP mocked only.    |
| X. Remaining blockers            | Live account/version/base-currency and delivery checks remain. Phase 3B addresses full one-fils monetary precision.                    |

Before opting into the gateway, deploy the additive migration and compatible backend
instances, drain older instances, update Flutter parsing, and complete portal checks.
Historical CARD/NONE orders are not silently converted to a new provider: reconcile them
explicitly rather than changing their committed checkout identity.

**POINTS 1–14 REMAIN COMPLETE. PHASES 1, 1B AND 2 REMAIN COMPLETE.**
