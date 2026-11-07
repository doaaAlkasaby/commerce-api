# Reservation expiration and payment recovery — Phase 4

## Existing lifecycle and architecture

Checkout still commits order, payment, coupon usage, inventory reservation and idempotency
state atomically. Payment initiation remains outside checkout's transaction. The existing
PaymentService, PaymentVerificationService, OrderService and InventoryService own all
financial transitions, commit/release ledger entries and exact money comparisons.

Phase 4 adds one separately runnable PostgreSQL worker, not Redis/BullMQ or an HTTP loop.
A single durable RecoveryJob per order schedules expiration, initiation recovery and
payment verification. It never stores provider payloads or arbitrary job arguments.
There are no new HTTP endpoints or control APIs.

Discovery uses bounded indexed scans of due orders and eligible payment states, excluding
orders already represented in the job table. An atomic UPDATE with FOR UPDATE SKIP LOCKED
claims due READY jobs or expired RUNNING leases. Claims carry random fencing tokens.
Multiple instances can discover/claim concurrently without duplicate active jobs.
Each worker accepts at most WORKER_CONCURRENCY jobs at once and pauses between batches.

Provider IO happens outside transactions. Before a verified provider result changes money,
the existing verification transaction locks the owning order and checks the current job
lease/token. Expiration locks order, payment and job rows, rereads current states/deadline,
then invokes the existing cancellation/release lifecycle. Existing atomic stock updates,
reference uniqueness and stable variant lock order remain authoritative. A stale worker
cannot apply a result or finish a replacement worker's claim.

## Reservation policy

New CARD and DIGITAL_WALLET orders receive a persisted reservationExpiresAt computed
from database time and RESERVATION_TTL_SECONDS (default 900). Checkout replay retains
the original order/deadline. The field is internal and is not added to public DTOs.
CASH_ON_DELIVERY and BANK_TRANSFER keep NULL deadlines. Historical orders also remain
NULL: migration does not infer deadlines from createdAt or retroactively expire orders.

Deadlines, leases and job timestamps are timestamptz(3) instants. Due-time comparisons,
lease creation/recovery, next-attempt times and initiation-state timestamps use database
time. Existing Payment.updatedAt is interpreted as UTC for stale-initiation checks.
No customer shipping country, currency precision or client redirect controls expiration.

The worker may expire a PENDING order only when a fresh locked check establishes:

- One matching unpaid local payment with matching exact amount/currency and no
  reconciliation flag; no PAID/authorized/captured/refund state is eligible.
- A persisted deadline has elapsed according to PostgreSQL.
- No active initiation claim exists.
- The provider is local NONE, or MyFatoorah is definitely NOT_STARTED with no invoice ID.

Expiry invokes existing CANCELLED/payment-release rules; it does not delete reservations,
write a second inventory ledger or release merely because time elapsed. NONE's local
provider has no external invoice; stale local initiation may be retried idempotently.
COD retains its existing behavior because it has no automatic deadline.

A known external invoice that is pending/authorized must be reconciled and retains stock
after the reservation deadline. An unknown external outcome with no lookup identity is
manual intervention, not proof of failure. Explicit existing customer/admin cancellation
semantics remain unchanged; this worker adds stricter automatic-expiry preconditions.

## Reconciliation and initiation recovery

Known MyFatoorah invoice IDs use REST V2 GetPaymentStatus through the existing provider
abstraction. The verification service checks invoice/transaction identity, local order and
payment references, exact Decimal amount, currency and provider status before central
transitions. KWD 0.001 is compared exactly; local NONE flows also support USD and JPY.
No cents assumption, conversion, tax recalculation or price change is introduced.

| Persisted condition                    | Worker action                                                              |
| -------------------------------------- | -------------------------------------------------------------------------- |
| NOT_STARTED, no invoice                | No automatic external creation; expire only when eligible and due.         |
| INITIATED with known invoice           | Authoritative lookup; centralized transition.                              |
| Fresh IN_PROGRESS                      | Backoff; do not race an active initiator.                                  |
| Stale IN_PROGRESS                      | Recheck under lock, move to UNKNOWN; reconcile an existing ID or escalate. |
| UNKNOWN with known ID                  | Lookup only; never issue another SendPayment.                              |
| UNKNOWN with no ID                     | MANUAL, retain stock; provider portal/webhook recovery required.           |
| NONE UNKNOWN/stale initiation          | Existing idempotent local initiation; wait for any explicit deadline.      |
| PAID/captured/refund state             | Never expire or downgrade; preserve central financial policy.              |
| Reconciliation flag/integrity mismatch | MANUAL; preserve financial and inventory history.                          |

New MyFatoorah initiation errors atomically persist UNKNOWN and a recovery job with a
sanitized category: INITIATION_REJECTED, INITIATION_TIMEOUT,
INITIATION_AUTHENTICATION_FAILED, INITIATION_INVALID_RESPONSE or INITIATION_UNKNOWN.
These categories distinguish known rejection from ambiguous transport failure operationally;
neither grants permission to create another invoice automatically. Existing historical
UNKNOWN rows without such context use WORKER_PAYMENT_REFERENCE_MISSING.

The existing V2 adapter has no documented safe idempotent creation guarantee or implemented
safe reference lookup for a missing invoice. No speculative lookup endpoint/header is
invented. The worker does not auto-start brand-new MyFatoorah payments. Flutter continues
to call the existing initiation endpoint after checkout.

## Late payments and idempotency

Verified success uses the existing payment transition and inventory sale operation exactly
once. Verified failure/cancellation uses existing release rules. Pending is an observation,
not permission to resurrect a terminal local state or release stock. Provider errors and
UNKNOWN outcomes do not become payment failures.

A late paid result after cancellation, failure or release encounters the existing controlled
conflict. The payment and job are marked for reconciliation; stock is not re-reserved or
sold a second time. No automatic refunds are implemented. Concurrent webhook and worker
success, duplicate execution, process crashes and repeated releases/commits are covered by
PostgreSQL tests. Webhook V2 canonicalization and signature verification are unchanged.

A crash after financial commit but before job completion is safe: a new lease reloads
current local state and reuses idempotent transition/ledger logic. No process-owned lock
can permanently hide a job. DONE/MANUAL records prevent automatic rediscovery; do not
truncate this table to implement retention. A retention/archive design is outside this phase.

After a verified terminal outcome and DONE, this job does not poll forever. Webhooks remain
required for later provider changes. A late webhook can flag a payment while its job is
already DONE; operations must monitor both payment flags and MANUAL jobs.

## Retries and durable state

RecoveryJob stores tenant/order identity, state, attempt count, next availableAt,
leaseUntil, claimToken, sanitized lastErrorCode, completion time and timestamps.
Composite tenant/order foreign keys prevent cross-tenant association. Unique orderId
prevents multiple logical active jobs. Indexes support READY availability, expired RUNNING
leases and tenant/state monitoring; order deadline and payment discovery indexes support
bounded scans. There is no raw error-message or payload column.

Each claim increments attempts. Transient lookup/network/database errors and pending
observations retry with exponential backoff, capped by WORKER_RETRY_MAX_MS, using bounded
half-to-full jitter. Defaults start at 5 seconds and cap at 15 minutes. A successful local
NONE recovery can wait directly until its persisted deadline instead of polling/burning
its retry budget. No more than WORKER_MAX_ATTEMPTS external processing attempts occur;
reclaiming a crashed final lease may increment the counter once more solely to mark MANUAL,
without another provider call. Definitely safe local expiration can still complete.

GET status rate limits preserve the existing public 503/error envelope and add an internal
Retry-After hint. Valid seconds/HTTP dates set a minimum delay; missing/invalid hints use
60 seconds. Hints over one day go to manual review instead of retrying earlier than requested.
Creation timeouts/rejections/rate limits remain UNKNOWN when ambiguous; this polling policy
does not authorize resubmitting SendPayment.

Integrity/currency/identity mismatches, authentication failures, unverifiable responses and
unresolvable invoice creation require manual review instead of indefinite retries. Existing
webhook signature failures are rejected before association, outside the worker queue.
On exhaustion, the job becomes MANUAL and the payment reconciliation flag is set. No raw
provider response, token, signature, card data or exception message enters a job error/log.

## Configuration, startup and shutdown

| Variable                   | Default | Purpose                                             |
| -------------------------- | ------- | --------------------------------------------------- |
| RESERVATION_TTL_SECONDS    | 900     | New online-order deadline; 60–604800 seconds.       |
| WORKER_POLL_MS             | 1000    | Bounded polling interval, 100–60000 ms.             |
| WORKER_CONCURRENCY         | 2       | In-flight jobs per process, 1–16.                   |
| WORKER_SCAN_BATCH          | 100     | Maximum discovered orders per pass, 1–500.          |
| WORKER_LEASE_MS            | 60000   | Lease duration, 5000–600000 ms.                     |
| WORKER_MAX_ATTEMPTS        | 12      | Automatic processing budget, 1–100.                 |
| WORKER_RETRY_BASE_MS       | 5000    | Initial exponential backoff.                        |
| WORKER_RETRY_MAX_MS        | 900000  | Maximum backoff, excluding valid provider minimums. |
| WORKER_INITIATION_GRACE_MS | 120000  | Minimum age before IN_PROGRESS recovery.            |

Existing DATABASE_URL, DB_SSL_MODE/CA, connection timeouts, DB_POOL_MAX,
SHUTDOWN_TIMEOUT_MS and provider configuration apply. Worker startup requires two spare
pool connections beyond concurrency, max backoff >= base, and lease/initiation grace at
least provider timeout + 10 seconds. These worker-only checks do not constrain HTTP pool
configuration. Startup checks actual database connectivity before logging ready.

```sh
npm run build
npm run worker          # node dist/worker.js
# development alternative:
npm run worker:dev      # tsx src/worker.ts
```

Run separately from `npm start`; there is no implicit HTTP worker. Start multiple processes
with the same reviewed database/provider configuration. Each process owns its own bounded
pool: budget HTTP pools + N worker pools + administrative reserve below PostgreSQL's limit.
NONE configurations need no MyFatoorah credentials. Processing actual MyFatoorah records
requires the existing validated sandbox configuration; missing credentials do not become
permission to expire external payments.

Send SIGTERM or SIGINT to stop a worker. It stops claiming, interrupts idle polling, drains
accepted work and then disconnects PostgreSQL. Repeated signals do not start multiple drains.
The existing SHUTDOWN_TIMEOUT_MS bounds drain; an overrun exits unsuccessfully and leaves
leases for recovery. Set the process manager's termination grace above this timeout and
allow enough drain time for the selected provider timeout plus transaction/disconnection.
A forced kill does not reset jobs; expired leases become eligible on another instance.

## Operations and manual intervention

Use structured logs (jobId, tenantId, orderId, attempt, outcome) and database metrics.
Monitor due READY backlog/age, expired RUNNING leases, MANUAL counts, retry categories,
provider rate limits, payment reconciliation flags and earliest overdue reservation.
Poll/startup failures log static categories only. No unauthenticated operational API exists.

Example read-only monitoring:

```sql
SELECT "state", "lastErrorCode", count(*), min("availableAt")
FROM "RecoveryJob" GROUP BY "state", "lastErrorCode";

SELECT p."id", o."tenantId", p."orderId", p."reconciliationReason"
FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId"
WHERE p."reconciliationRequired";

SELECT j."id", j."tenantId", j."orderId", j."attempts", j."lastErrorCode",
       p."id" AS "paymentId", p."providerPaymentId", p."currency", p."amount",
       p."reconciliationRequired", p."reconciliationReason"
FROM "RecoveryJob" j JOIN "Payment" p ON p."orderId" = j."orderId"
WHERE j."state" = 'MANUAL' OR p."reconciliationRequired";
```

For a flagged case:

1. Verify tenant, job/order/payment identity, provider invoice/reference and exact amount/
   currency; inspect reservation/SALE/RELEASE entries. Record the incident and prior error.
2. For missing invoice IDs, investigate the sandbox portal using the local CustomerReference
   and order UserDefinedField. Prefer a valid provider webhook resend: the existing webhook
   path can recover uncertain mapping using authoritative references. Do not guess an invoice
   ID, infer success from a redirect or blindly reset UNKNOWN to NOT_STARTED.
3. Use the existing authenticated verification flow or an approved privileged maintenance
   command calling the same verification service. Any manual mapping must first establish
   provider identity, local references and exact money. Never update paid/order/stock fields
   directly or invent a refund to clear a flag.
4. Resolve integrity/credential/identity issues before requeueing. If an operator approves
   a retry, lock the owning order first, audit the reason externally, clear only the reviewed
   payment reconciliation flag, and reset the matching tenant/order job to READY with a new
   database-time availableAt, attempts=0 and null lease/token/finishedAt. Keep the previous
   error/incident evidence. A financial conflict is not solved merely by requeueing it.
5. Close a case only after checking actual provider state and central inventory history.
   Unresolved external money may require a separate human-approved refund/fulfillment process.

The table intentionally has no automatic operator reset, secret-bearing diagnostics or
arbitrary payload replay. No job deletion or production mutation was performed by this task.

## Migrations and verification

Migration 15, `20261102100000_payment_recovery`, adds a nullable Order deadline, RecoveryJob
state/table, composite tenant ownership and query indexes. Original 14 migrations remain
unchanged. No existing order receives an inferred deadline, and migration creates no jobs.
Historical monetary snapshots and stock are preserved. No existing database is reset or
repaired and no db push is used.

```sh
npm run test:postgres
npm run test:postgres -- tests/recovery
npm run test:postgres -- tests/checkout \
  tests/inventory/inventory.concurrency.integration.test.ts \
  tests/inventory/inventory.reservation-lifecycle.integration.test.ts \
  tests/tenant/tenant-isolation.integration.test.ts tests/payments tests/pricing
npx tsx scripts/verify-recovery-migration.ts
npx tsx scripts/verify-money-migration.ts
npx prisma validate --config prisma7.config.ts
npm run db:generate
npm run typecheck
npm run build
```

Verifiers create only UUID disposable test databases and remove only their own databases.
The 14->15 check seeds representative historical KWD payments/reservations, verifies all
original checksums/data and NULL legacy deadlines, and checks zero schema drift. The prior
13->14 monetary verifier remains compatible with the current history and checks all old
order scalars plus line/payment snapshots. Tests use mocked provider HTTP, never live keys.

## Deployment, compatibility and limitations

No deployment, commit or push is performed. For a separately approved rollout: review and
apply migration 15 to the explicitly verified target, deploy compatible HTTP/backend code,
validate connection/provider budgets, then start one worker. Observe queue/error/stock
metrics before increasing instances. Old instances have no worker and do not create new
deadlines; do not backfill historic deadlines automatically during rollout.

The isolated Phase 3B development database is left unchanged at its existing migration
version; explicitly deploy the new migration to a verified development target before
running this backend there. This task's test upgrades do not switch `.env` or touch that DB.

Existing paths, methods, request/response fields, envelopes, status semantics, authentication,
verified-email requirements, tenant headers and monetary strings remain unchanged. Internal
deadlines/job state are not exposed in Flutter responses. No Flutter changes are required.
The API initiation failure path now records internal work durably, without starting a loop.

Live Kuwait sandbox delivery/account verification remains outstanding from Phase 3. There
is no safe automatic missing-invoice discovery, FX, automatic refund, legacy balance repair,
operator UI, retention/archive or production deployment in this phase. Completed jobs rely
on existing webhooks for later provider changes; bounded retries may intentionally retain
inventory for manual resolution rather than risk collecting money against released stock.

## Final verification and exact files

Exact Phase 4 files changed/added (prior-phase and user edits excluded):

- `src/worker.ts`
- `src/config/worker-options.ts`
- `src/config/env.ts`
- `src/modules/payments/payment.service.ts`
- `src/modules/payments/payment.repository.ts`
- `src/modules/payments/payment-verification.service.ts`
- `src/modules/payments/providers/myfatoorah.provider.ts`
- `src/modules/payments/providers/provider-retry.ts`
- `src/modules/recovery/recovery.service.ts`
- `src/modules/recovery/recovery.worker.ts`
- `src/modules/recovery/recovery.repository.ts`
- `src/modules/checkout/checkout.service.ts`
- `src/modules/checkout/checkout.repository.ts`
- `src/modules/orders/order.service.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20261102100000_payment_recovery/migration.sql`
- `docs/payment-recovery-and-workers.md`
- `docs/production-database.md`
- `docs/testing.md`
- `tests/recovery/recovery.integration.test.ts`
- `tests/recovery/worker-options.test.ts`
- `tests/checkout/checkout.transaction.integration.test.ts`
- `package.json`
- `.env.example`
- `scripts/verify-money-migration.ts`
- `scripts/verify-recovery-migration.ts`

Primary protocol references:
[PostgreSQL 17 SELECT/locking](https://www.postgresql.org/docs/17/sql-select.html),
[HTTP Retry-After (RFC 9110)](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).

## Final verification results

- Full PostgreSQL suite: **789 passed, 0 failed, 0 skipped**, 45 files.
- Baseline 730 retained; **59 new tests**: 47 PostgreSQL worker cases, 10 worker
  configuration/protocol cases and 2 checkout deadline/API-contract cases.
- Separate hardening, MyFatoorah, currency and worker regression run:
  **554 passed, 0 failed, 0 skipped**, 10 files.
- Worker-only run: **57 passed, 0 failed, 0 skipped**, 2 files.
- Fresh 15-migration deployments and schema drift comparison: PASS.
- Representative 14->15 upgrade: PASS; original 14 checksums, historical exact KWD
  payment/inventory/snapshots unchanged; legacy deadlines NULL; no inferred jobs.
- Existing 13->14 monetary upgrade verifier against current history: PASS.
- Prisma validate/generate: PASS (Client 7.10.1).
- Typecheck, production build and strict targeted test/verifier typecheck: PASS.
- Focused ESLint/Prettier and git diff --check: PASS.

One earlier full verification encountered a transient Vitest fork-start timeout for the
existing request-ID file; the final sequential full run executed all 789 tests successfully.
No test timeout/configuration was weakened and no test was removed or skipped.

No implementation or automated verification blockers remain. Live MyFatoorah sandbox
verification remains outstanding from Phase 3; provider HTTP was mocked throughout.
No existing development/shared/production database, `.env` file or todo edit was
changed. No deployment, commit or push occurred.

API compatibility: existing endpoints/methods, request/response fields, success/error
envelopes/status conventions, authentication/verified-email and tenant headers unchanged.
New endpoints: none. Flutter changes required: none. Breaking changes: **NO**.

**POINTS 1–14 REMAIN COMPLETE. PHASES 1, 1B, 2 AND 3B REMAIN COMPLETE.
PHASE 3 MYFATOORAH IMPLEMENTATION REMAINS INTACT.**
