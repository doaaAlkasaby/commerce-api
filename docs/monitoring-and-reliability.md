# Monitoring and operational reliability

Phase 6 builds on Pino, PostgreSQL readiness, Phase 4 durable recovery and Phase 5 secret
redaction. No monitoring service is installed and **no alert is active**. Operators must
configure collection, scrape targets and alert delivery. Customer APIs and Flutter payloads
are unchanged. There is no new payment state, retry policy, gateway or migration.

## Correlation and safe logging

HTTP accepts `X-Request-ID` only if it matches `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. Otherwise
it generates a UUID. The response header, `req.id`, response locals, completion logs and
error logs use that ID. AsyncLocalStorage propagates it through asynchronous service logs.
A client-supplied ID is a search hint, never authentication, tenancy or trusted identity.
Response bodies retain their existing envelopes. Existing CORS settings are unchanged;
Flutter native clients can read the header; browser clients may need an explicit ingress
exposed-header policy if they wish to read it.

Pino emits ISO timestamp, severity, service and environment. Completion logs contain method,
query-free path, fixed route family, status and duration, plus authenticated user/tenant ID
where available. Payment logs contain operation, outcome and safe internal payment/tenant
references; worker logs contain job/order/tenant references and attempts. These are protected
operational identifiers, not public diagnostics: restrict log access, retention and exports.
Never attach bodies, query strings, raw exception/provider payloads, passwords or credentials.
The shared logger configuration redacts JWTs, refresh tokens, payment/webhook credentials,
operational tokens and request bodies. Correlation context copies prevent Pino log fields
from contaminating later entries. Operational/client errors and unexpected errors have separate
bounded classes. Unknown exceptions keep the existing generic 500 response and static logs.

## Probes and access controls

| Route                         | Access                                                         | Meaning                                                         |
| ----------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Existing `GET /api/v1/health` | Existing policy unchanged                                      | Existing liveness response unchanged                            |
| Existing `GET /api/v1/ready`  | Existing policy unchanged                                      | Existing success/failure envelope; cached connectivity probe    |
| `GET /ops/live`               | Minimal public probe; restrict at ingress if desired           | Event loop responding; no provider/DB dependency                |
| `GET /ops/ready`              | Minimal public probe; restrict at ingress if desired           | DB reachable and process not draining; 200/503 with status only |
| `GET /ops/metrics`            | Dedicated Bearer token, plus private network/ingress allowlist | Prometheus-compatible text; read-only fleet snapshot            |

Operational routes are outside customer authentication/tenant routing and the ordinary customer
rate-limit budget. They provide no customer-data access. Metrics require exact
`Authorization: Bearer <OPS_METRICS_TOKEN>` using constant-time digest comparison. JWTs and
tenant-admin access do not grant metrics access. Missing configuration disables metrics with
503; wrong credentials yield 401. No-store applies to operational responses. Do not route
metrics through public internet ingress; enforce a private scrape network and TLS when remote.
Minimal public probes disclose no credentials, provider availability or database internals.

Readiness uses `SELECT 1`, a two-second positive/negative cache, concurrent-probe coalescing and
a 1.5-second response deadline. A timed-out underlying probe remains single-flight until it
settles, avoiding a pile-up of abandoned queries. Existing pool acquisition, connection and SQL
timeouts still bound driver work. Shutdown immediately makes readiness fail. A probe is not
a guarantee that the next transaction will succeed. Payment-provider outages do not fail
liveness or trigger API restart loops.

## Metrics and dashboards

The dependency-free exporter uses Prometheus text 0.0.4 counters, gauges and cumulative histogram
buckets (0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60 seconds plus infinity). Labels are code-defined:
HTTP method/fixed route family/status, payment operation/fixed outcome, worker fixed outcome,
database failure source, and worker job state. Never introduce request/order/payment IDs,
customer email, arbitrary paths or tenant slugs as labels. Metrics are fleet aggregates or
process aggregates and do not reveal tenant-specific customer data.

| Metric                                                    | Interpretation                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `commerce_http_requests_total`                            | Requests by method, route family and status; use 5xx/total for error rate                              |
| `commerce_http_request_duration_seconds`                  | Latency histogram by method/route family                                                               |
| `commerce_application_errors_total`                       | Client, dependency/operational or unexpected errors                                                    |
| `commerce_database_connectivity_failures_total`           | Pool, connection, startup, readiness, metrics or worker failures; event counts may overlap             |
| `commerce_checkout_failures_total`                        | Checkout HTTP failures by 4xx/5xx class; distinguish invalid input from server failures                |
| `commerce_payment_operations_total`                       | Initiation/reconciliation/webhook observations by outcome                                              |
| `commerce_payment_initiation_uncertain_total`             | Initiations that durably moved from IN_PROGRESS to UNKNOWN                                             |
| `commerce_payment_operation_duration_seconds`             | Timed provider/operation calls, including failures                                                     |
| `commerce_worker_running`                                 | Per-worker process running gauge                                                                       |
| `commerce_worker_last_successful_cycle_timestamp_seconds` | Per-worker successful polling/processing cycle; zero before first success                              |
| `commerce_worker_claimed_total`                           | Claimed jobs in this process                                                                           |
| `commerce_worker_jobs_total`                              | DONE/RECONCILED/LOCAL_RECOVERED, RETRY, MANUAL, LEASE_LOST, EXPIRED, AWAITING_DEADLINE, ERROR or OTHER |
| `commerce_worker_processing_duration_seconds`             | Per-job processing duration histogram                                                                  |
| `commerce_reservations_expired_total`                     | Completed expiration processing observations                                                           |
| `commerce_worker_backlog`                                 | Database fleet READY/RUNNING/MANUAL counts                                                             |
| `commerce_worker_oldest_job_seconds`                      | Oldest creation age by backlog state, including scheduled waits                                        |
| `commerce_worker_expired_leases`                          | Fleet RUNNING jobs with elapsed leases                                                                 |

HTTP completion records once on finish or close. Premature connection close uses **499 only
in telemetry**, without changing customer HTTP response semantics. Unknown paths map to
`other`; per-product or per-tenant paths never create new series.

Payment outcomes distinguish provider rejection, timeout, unknown result, verified paid/failed/
pending/cancelled/refunded/authorized, reconciliation conflict, invalid signature, duplicate
webhook and amount/currency mismatch. A timeout can also increment the durable UNKNOWN counter;
these are two observations of the same operation, not two payments. Successful verification
counts observations, including repeat polling, not unique financial settlements. Duplicate and
conflict counters can describe the same webhook. Do not use monitoring counters as a ledger.
Transaction boundaries, locks, claim fencing, provider timeouts and the prohibition on
ambiguous initiation retries remain unchanged. No additional DB metrics writes occur inside
critical transactions. Worker retries/manual transitions are observed after service completion.

Suggested dashboards: HTTP traffic/error/latency, DB probe/pool failures, checkout error classes,
initiation rejection/timeout/UNKNOWN trends, verified payment outcomes/mismatches, webhook
signature/duplicate/conflict trends, worker availability/cycle age, backlog age/count and lease
recovery, retry/manual trends and expiration throughput.

## Multiple processes and worker scraping

Counters and histograms reset on process restart. Scrape **each API/worker process directly**
and retain monitoring target/instance labels; do not round-robin scrape a load balancer. Sum
rates across process counters. The HTTP API cannot infer whether a remote worker is alive.
Enable the worker's optional listener with `WORKER_OPS_PORT` (default 0/off); it serves the
same `/ops/*` routes and token policy, with no customer routes. `OPS_BIND_HOST` defaults to
loopback; container deployments must explicitly bind a private interface and restrict ingress.
Scrape each worker and alert on missing targets as well as running/cycle gauges.

Fleet backlog/lease gauges are a cached five-second, coalesced, read-only PostgreSQL snapshot.
Every API/worker target sees the same database jobs. Use **max**, not sum, across targets for
these gauges, or nominate one collector. Separate database clusters must retain distinct
monitoring target labels. Observation never claims or updates a job. `LEASE_LOST` counts stale
claim attempts; the expired-lease gauge detects recoverable leases awaiting claim. Oldest age
includes intentional reservation waits: correlate it with READY state, retry rates and the
configured reservation TTL before paging. Completed job rows are excluded from the snapshot.

## Startup, shutdown and failure handling

API and worker verify PostgreSQL connectivity before accepting intended traffic/processing.
Pool failures log only bounded error codes and increment connectivity counters. Pool exhaustion
retains existing acquisition/statement timeouts rather than adding unlimited retries.
SIGTERM/SIGINT marks readiness draining, stops new HTTP acceptance/worker claims, drains
in-flight HTTP requests or jobs, then disconnects PostgreSQL. Existing SHUTDOWN_TIMEOUT_MS
bounds shutdown; timed-out HTTP connections close forcibly. Worker leases remain durable
and recoverable after a forced exit, with existing fencing preventing stale settlement.
Unhandled rejections/uncaught exceptions log a static fatal category, drain within the same
bound and exit unsuccessfully; the process does not resume normal serving. Listener failures
also exit unsuccessfully. Supervisors should restart failed processes with backoff and allow
a termination grace period longer than SHUTDOWN_TIMEOUT_MS. Provider request deadlines and
worker concurrency/lease configuration safety checks remain intact.

## Recommended alerts and incident procedures

These are configurable starting recommendations, **not measured production baselines**.
No notification destination, monitoring backend or alert rule is activated by this repository.

| Condition               | Initial recommendation                                                            | Action                                                                |
| ----------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| HTTP 5xx                | >2% for 5 minutes with >=100 requests                                             | Check unexpected/dependency errors and correlated request IDs         |
| Database unavailable    | Readiness failing >60 seconds or connection failure growth                        | Check DB health, TLS, pool budget and saturation; never reset DB      |
| Worker absent/stalled   | Missing target >2 minutes, running=0, or successful cycle age > max(60s, 3×lease) | Check process, DB and shutdown logs; restore worker capacity          |
| Growing backlog         | READY count growing for 10 minutes; >100 initially                                | Check retry rate, provider health and configured concurrency          |
| Stale jobs/leases       | Oldest READY age >2×reservation TTL or expired leases persisting >2×lease         | Inspect protected job logs; verify claims recover; preserve fencing   |
| Manual intervention     | New MANUAL job or count increasing                                                | Review payment/provider references with authorized operational access |
| Invalid signatures      | >10/min for 5 minutes                                                             | Check provider configuration/secret rotation and abusive ingress      |
| Reconciliation failures | >5% failed checks for 10 minutes with >=20 checks                                 | Check provider reachability and mismatch/conflict trends              |
| Checkout failures       | 5xx >1% for 5 minutes; 4xx >2×normal baseline                                     | Separate abuse/validation from stock, DB or calculation failures      |

During payment incidents, correlate internal references in restricted logs, confirm authoritative
provider status using the existing verification/recovery path, and inspect manual flags.
Never infer payment success from callbacks, retry UNKNOWN initiation, edit ledger/inventory
rows or bypass a claim lock to clear an alert. During worker outages, restore worker availability
and let durable leases expire/reclaim safely. During DB incidents, shed traffic using readiness,
check acquisition timeouts and total pools across replicas; do not raise concurrency blindly.
For suspected leaked operational credentials, rotate the dedicated token in scrapers and
process configuration, restrict access and review log retention. No secret values belong in
incident tickets or metrics labels.

## Configuration, compatibility and limitations

New variables: `OPS_METRICS_TOKEN` (optional, 32–256 base64url characters), `WORKER_OPS_PORT`
(0 disables; otherwise an explicit port), `OPS_BIND_HOST` (default 127.0.0.1). No private token
is checked into `.env.example`. Existing DB, provider, worker and shutdown settings remain.
No paid subscription or local monitoring service is needed. Local tests use mock time/probes
and the documented disposable PostgreSQL runner.

Flutter requires no request, response, auth, tenant-header or payment changes. Valid correlation
IDs are echoed; invalid ones are replaced. New operational routes are separate from customer
APIs. Existing health/ready envelopes remain compatible. No production deployment occurred.

Limitations: process-local counters are not durable audit evidence, scrape gaps lose events,
route families trade endpoint granularity for bounded cardinality, fleet aggregate query cost
grows with active/manual backlog, and readiness does not certify provider or mail availability.
Distributed tracing/APM, host/DB-server metrics, alert delivery, TLS/ingress rules and retained
monitoring storage require operator configuration. Existing real-email delivery and live Kuwait
sandbox verification remain outstanding operational items from earlier phases.

## Phase 6 changed files

- `.env.example`
- `docs/monitoring-and-reliability.md`
- `src/app.ts`
- `src/common/lifecycle/fatal-errors.ts`
- `src/common/logger/logger.ts`
- `src/common/observability/context.ts`
- `src/common/observability/metrics.ts`
- `src/common/observability/operations.ts`
- `src/common/observability/readiness.ts`
- `src/config/database.ts`
- `src/config/env.ts`
- `src/middleware/error.middleware.ts`
- `src/middleware/request-id.middleware.ts`
- `src/middleware/request-logger.middleware.ts`
- `src/modules/payments/payment-verification.service.ts`
- `src/modules/payments/payment.service.ts`
- `src/modules/recovery/recovery.worker.ts`
- `src/routes/health.routes.ts`
- `src/server.ts`
- `src/worker.ts`
- `tests/observability.postgres.test.ts`
- `tests/observability.test.ts`
- `tests/payments/myfatoorah.integration.test.ts`

Operational SQL smoke tests require `npm run test:postgres -- tests/observability.postgres.test.ts`
and refuse non-disposable database names. They exercise the real readiness query and protected
fleet aggregate exporter, complementing mocked failure/timeout coverage.

## Verified results

- Full disposable PostgreSQL suite: **893 passed, 0 failed, 0 skipped**, 49 files;
  all 853 baseline tests retained plus 40 new observability tests.
- Focused hardening/security/payment/currency/worker/contracts/tenant/inventory and
  observability regression run: **702 passed, 0 failed, 0 skipped**, 20 files.
- Additional real-PostgreSQL operational endpoint run: **2 passed, 0 failed, 0 skipped**.
- Prisma validate/generate, typecheck, production build, strict typing of both new test
  files, focused ESLint and Prettier passed. Fresh deployment of all 16 migrations and
  schema drift checks passed through the documented test runner.
- No schema or migration changes. Prisma files and migration history match the
  pre-Phase-6 snapshot; no production DB access, reset, db push, deployment, commit or push.
- Phase 6 diff check is clean. Repository-wide `git diff --check` retains the pre-existing
  `notes.txt:36` blank line at EOF. User todo/notes and dependency files are unchanged.
- POINTS 1–14 and PHASES 1, 1B, 2, 3B, 4 AND 5 REMAIN COMPLETE. PHASE 3
  MYFATOORAH IMPLEMENTATION REMAINS INTACT; live sandbox verification remains pending.
