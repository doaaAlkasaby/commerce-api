# Deployment and CI preparation

Phase 7 provides local artifacts and verification. No staging/production deployment, cloud
resource, GitHub secret, backup schedule, live payment activation, commit or push was performed.
Read [database operations](production-database.md), [worker operations](payment-recovery-and-workers.md),
[monitoring](monitoring-and-reliability.md), [security](security-hardening.md),
[currency policy](currency-and-money-policy.md) and [MyFatoorah](myfatoorah-integration.md) first.

## Artifacts and process architecture

`Dockerfile` uses a digest-pinned Node 24.22.2 Debian slim base, CA certificates/OpenSSL,
lockfile-only `npm ci`, Prisma generation and TypeScript compilation. `.nvmrc` pins the same
Node patch for CI; package engines restrict the major to 24. Update these pins together after
verification. Promote the same built image digest through environments; do not rebuild a
release separately for production. Debian security package updates can change build output;
record the final image digest and package inventory for each build rather than claiming
bit-identical images across future apt repositories.

| Target             | Contents/command                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `runtime`          | Production dependencies, compiled ESM `dist`, required public OpenAPI JSON, deployment checks; `node dist/server.js` |
| Same runtime image | Override command with `node dist/worker.js` for recovery only                                                        |
| `migration`        | Separate one-shot Prisma CLI/tooling, immutable migration files and minimal configuration; `node deploy/migrate.mjs` |

Runtime uses UID 1000 (`node`), SIGTERM and a shell entrypoint that validates production
configuration then `exec`s the Node process. Compose adds an init process to reap children.
No worker is launched by the API, and the worker does not import/start customer HTTP routes.
Production dependencies omit development tooling and optional peers (including the otherwise
auto-installed Prisma CLI/TypeScript); install scripts are disabled in that stage
and the packaged native Argon2 prebuild is verified by actual API startup. Migration tooling
stays out of the runtime image. Required OpenAPI JSON remains available for existing docs
contracts. No source tree, tests, Prisma CLI, seed scripts or `.env` files enter runtime.
The build context uses an allowlist and excludes all `.env` variants, keys and generated
host Prisma output. Production secrets are runtime inputs, never build arguments.

Local builds:

```sh
docker build --target runtime -t commerce-api:review .
docker build --target migration -t commerce-migrate:review .
```

## Isolated local Compose verification

Existing `docker-compose.yml` and its databases/volumes are untouched. New `compose.verify.yml`
is exclusively local verification, not a production deployment template. It deliberately sets
`NODE_ENV=test`, uses plaintext PostgreSQL on its private Docker network, selects provider NONE
and enables shared PostgreSQL rate limiting. It publishes only the API on loopback; neither
PostgreSQL nor worker operations are published to the host. Real staging/production requires
verified TLS and privately provisioned database roles/secrets.

```sh
npm run container:verify
```

This helper refuses remote Docker endpoints, generates a unique `commerce-verify-*` project
and independent random database/JWT/metrics credentials in memory, validates Compose, builds
both targets and starts PostgreSQL → singleton migration job → API and worker. Migration failure
prevents application startup. Readiness must pass before smoke checks. It verifies customer
health envelopes, operational probes, protected metrics, UID, absence of development/source
files, API/worker separation, idempotent migration rerun, successful SIGTERM shutdown and
rejection of unapproved production migrations/live provider selection.

Cleanup stops/removes only that generated project's containers/network. **Volumes are retained**;
no `down -v`, database reset or automatic volume deletion occurs. The helper prints the generated
volume names so an operator can inspect them and explicitly authorize later removal. Failed
builds may create no volumes at all. Do not reuse this helper against real staging/production.

For an interactive local rehearsal, place generated variables in a mode-0600 file outside the
repository (never use production credentials): `COMPOSE_PROJECT_NAME=commerce-verify-<unique>`,
`VERIFY_DB_PASSWORD`, `VERIFY_JWT_SECRET`, `VERIFY_METRICS_TOKEN` and optionally `VERIFY_HTTP_PORT`
(default 3080). Use URL-safe random hex values, at least 32 random bytes per secret.

```sh
docker compose --env-file /secure/path/verify.env -f compose.verify.yml config --quiet
docker compose --env-file /secure/path/verify.env -f compose.verify.yml build api migrate
docker compose --env-file /secure/path/verify.env -f compose.verify.yml up -d --no-build --wait api worker
docker compose --env-file /secure/path/verify.env -f compose.verify.yml ps
# After inspection: stop/remove containers and network, retaining all volumes.
docker compose --env-file /secure/path/verify.env -f compose.verify.yml down --timeout 45
```

Do not print the rendered Compose configuration: interpolation contains ephemeral secrets.
The automated helper uses an ephemeral loopback host port to avoid collisions.

## GitHub Actions and quality policy

`.github/workflows/ci.yml` verifies pull requests, pushes to develop/hardening/feature/fix
branches and manual verification requests. It has no deployment, publish or live-payment job.
It uses immutable checkout/setup-node action SHAs, read-only contents permission, no persisted
checkout credential, lockfile-keyed npm download cache, per-ref concurrency cancellation and
a 30-minute job timeout. PR code receives no staging/production secrets. Avoid pull_request_target
or granting write/cloud permissions to untrusted changes.

CI performs clean install, Prisma validate/generate, typecheck/build, lint/format regression
gates, checksum-pinned actionlint validation, deployment guard tests, production dependency
audit, the entire real PostgreSQL suite and actual Docker/Compose smoke verification.
A service PostgreSQL has only public disposable CI credentials, no external database DSN.
The existing `test:postgres` runner creates a UUID-named test database, deploys all 16 migrations,
checks schema drift, enables every hardening integration flag and drops only its own guarded
identifier. It never falls back to DATABASE_URL. Compose uses a separate private database.
Do not add real environment connection secrets to CI. No integration tests are silently skipped.

Repository-wide legacy debt exists: **46 lint errors and 214 unformatted files** at Phase 7
start. `npm run lint` and `npm run format:check` remain strict and unchanged. Rather than
rewriting unrelated application/user files, `npm run ci:quality` executes both tools across
the repository and reports unchanged legacy findings. `config/ci-quality-baseline.json`
exempts only exact SHA256 content of the original affected files. Any new finding, new file
or content change in an affected file must pass normally; clean files have no exemption.
Do not regenerate the baseline to hide regressions. Require explicit code review for baseline
changes and remove entries when legacy files are cleaned. This is a documented debt gate,
not a claim that repository-wide lint/format are clean. Focused Phase 7 checks must also pass.

The original lockfile failed clean Linux installation because optional cross-platform package
metadata was incomplete. It was repaired using the pinned container runtime: 26 package
entries added, **no existing package versions changed**. Do not hand-remove platform entries
or regenerate against a dirty node_modules tree. CI's npm ci fails on inconsistent manifests.

`node scripts/validate-workflows.mjs` downloads actionlint 1.7.7 from its official release,
verifies the pinned platform SHA256, runs workflow validation and removes its own temporary
directory. It requires curl, tar and HTTPS access. Supported verification hosts include
Linux x64 and macOS x64/arm64. The workflow uses Ubuntu x64. Hosted Actions execution itself
cannot be claimed verified until the reviewed changes are pushed and an actual run succeeds.

## Environment and secrets

`deploy/production.env.example` is a placeholder checklist, not a usable secret file. Store
real values outside source/build context in the platform secret manager, with least-privilege
access. Do not echo env files, Docker inspection environments or provider payloads into CI logs.

- **Database:** distinct runtime DML and migration DDL roles; explicit database identity;
  production requires verified TLS. Follow Phase 2 CA mounting/URL rules; do not disable
  certificate verification or combine conflicting URL/DB_SSL_MODE settings. Budget total
  pools across API/worker replicas and reserve migration/administrative capacity.
- **JWT:** private independent signing secret; existing HS256 behavior unchanged. Optional
  issuer/audience requires coordinated issuance/verification rollout. Do not use placeholders.
- **Tenants:** existing persisted tenants/members/roles and `X-Tenant-Slug`; no global default
  tenant or tenant-ID body override. Provision authorized verified-email test accounts using
  existing supported administrative procedures, never automatic production seed scripts.
- **Provider:** explicitly select PAYMENT_PROVIDER=NONE or MYFATOORAH. MyFatoorah requires
  explicit MYFATOORAH_ENV=sandbox, API v2, KWT/KWD account, separate sandbox API token/webhook
  secret and public HTTPS callback/error URLs. Live is rejected. No automatic money collection
  or sandbox-to-live fallback exists. Keep the current webhook signature protections.
- **CORS/proxies/HTTPS:** explicitly enumerate public HTTPS browser origins. The container
  preflight rejects missing/local/plaintext production origins. Terminate HTTPS at an approved
  ingress, configure exact trusted proxy CIDRs and prevent direct ingress bypass. Do not
  guess a proxy hop count or publish metrics ports. Native Flutter contracts are unchanged.
- **Metrics:** optional independent private OPS_METRICS_TOKEN; placeholder tokens rejected
  in production. Missing token disables metrics. Restrict `/ops/metrics` and worker operations
  to private scrape networks, with Bearer authentication and TLS where remote.
- **Worker:** configure existing concurrency, polling, lease, retry/grace and reservation TTL
  settings. Keep two spare pool connections and existing timeout/lease safety validation.
  Worker operational port is private; enable it for health/scraping. Do not share HTTP port.
- **Rate limiting:** production uses shared PostgreSQL counters. Never select memory storage.
- **Uploads:** persist the API's writable upload volume or approved asset storage; a read-only
  root filesystem is recommended. The worker has no upload mount in local verification.
- **Email:** the current delivery adapter remains a non-delivering stub. There is no SMTP
  setting that silently enables real delivery. Configure/implement and verify an approved
  transport in its own authorized task before production auth/email workflows are activated.

App startup retains existing Zod, secret, database TLS, provider and worker safety validation.
The runtime entrypoint adds deployment-only production checks before accepting traffic.
Keep that entrypoint; overriding it bypasses release checks.

## One-shot migrations, backup and drift

Never run migrations in every API/worker replica. Run exactly one serialized release migration
job using the matching migration image. Retain Prisma advisory locks; deployment preflight
refuses the disable-lock variable. Use a deployment mutex/one release owner as well: overlapping
jobs can time out on the advisory lock, and a timeout must stop rollout rather than trigger
unbounded automatic retries. Compose runs one migration service before application services.

Production migration preflight requires explicit MIGRATION_APPROVED=true,
MIGRATION_BACKUP_VERIFIED=true, EXPECTED_DATABASE_HOST and EXPECTED_DATABASE_NAME matching
the migration DSN, plus URL sslmode=verify-full. These are **operator attestations**, not proof
that the program created or validated a backup. No real target is touched in local tests.
The command is always `prisma migrate deploy --config prisma7.config.ts`; never db push/reset.
Historical migration files stay immutable. A failed preflight/CLI returns nonzero and blocks
new application startup. Investigate failure before retrying; inspect migration history with
the authorized migration role. Do not mark failed steps resolved without reviewing actual DDL.

Before migration, compare target identity, applied lineage/checksums and pending SQL with the
reviewed release. Rehearse the exact upgrade against a disposable restored snapshot. Expected
pending changes differ from drift; compare against the applied-prefix schema when reviewing an
older target. After deployment, run the documented schema diff against the release schema:

```sh
npx prisma migrate status --config prisma7.config.ts
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --config prisma7.config.ts
```

Run those commands only with an explicitly verified authorized target; never reuse CI DSNs
for staging or production. Exit 2 from diff means differences and requires investigation.
Fresh-database CI checks do not prove an arbitrary existing production database is drift-free.

Reuse the [Phase 2 backup/restore procedure](production-database.md#backup-strategy-and-retention):
automated encrypted backups, monitored completion/size/checksums, separate restricted storage,
provider physical/WAL PITR where required, tested restores and backup manifests with database,
server/client, release and migration versions. Example retention remains 7 daily/4 weekly/
12 monthly, subject to legal/privacy/business policy. Back up uploads and relevant external
assets/configuration too. A verified pre-migration recovery point is mandatory. Rehearse
restoring into a **new isolated target** and time validation/cutover. Define RPO from acceptable
lost transactions and WAL/backup frequency, and RTO from measured restore plus application/
provider reconciliation/cutover time. Dumps alone may not meet a low RPO. No production backup,
PITR, retention schedule or restore capability is claimed enabled by these files.

## Staging-first release and production checklist

The following describes future operator work; none was executed against real environments.

1. Review changes, test results, dependency audit, image/migration digests and compatible Node/
   PostgreSQL versions. Build once and record the artifact pair; scan artifacts with approved
   tooling before promotion. No registry push is automated here.
2. Provision isolated staging database/roles, private networking, verified TLS/CA and secrets.
   Verify target identity and restore rehearsal; review pending migrations and backup evidence.
3. Approve and run the singleton migration job. Stop on any failure. Verify history/drift.
4. Start API and worker separately with the same reviewed runtime digest. Route ingress traffic
   only after readiness succeeds. Start replicas conservatively within total DB pool budget.
5. Smoke health/readiness, wrong/right metrics credentials, tenant-isolated browsing and
   authorized verified-email customer flows using dedicated fixtures. Verify customer envelopes
   and X-Tenant-Slug. Exercise preview/checkout idempotency and observe reservations safely.
6. Run real Kuwait sandbox initiation, signed webhook/authoritative verification, duplicate
   delivery, failure/UNKNOWN handling and reconciliation tests with approved sandbox accounts.
   Live activation is **not supported** by this implementation. Pending real sandbox verification
   remains a release blocker before payment production activation.
7. Verify worker expiration/retry/manual behavior, leases/fencing, drain/restart recovery,
   protected metrics and backlog/cycle alerts. Do not synthesize financial settlement via SQL.
8. Review logs for errors/redaction, dashboards, alert delivery, persistence, HTTPS/proxy behavior
   and real email delivery. Confirm response shapes with Flutter clients.
9. Obtain production release approval: verified backup/restore, compatible migration review,
   exact target, secret owners, maintenance/cutover plan, incident owner and rollback decision.
10. Run one production migration job, then deploy API/worker in a controlled rollout. Keep
    readiness-gated routing and stop promotion if probes, error rates or reconciliation degrade.
    Drain old workers before incompatible changes; never overlap unfenced historical workers.
11. Verify post-release customer contracts, tenant isolation, payment/provider states, inventory,
    worker cycles, queue age, DB pools and alerts. Preserve release evidence and rollback window.

## Probe timings, rollback and incidents

The image health check uses `/ops/ready`, 10-second intervals, 3-second timeout, 20-second
startup grace and three failures. Compose waits up to 150 seconds. For an orchestrator,
use `/ops/live` for liveness independently of PostgreSQL/provider health, and `/ops/ready`
for traffic routing. Allow initial startup grace based on measured DB connectivity; do not
restart on a payment-provider outage. Worker health is its private operational listener,
not the API's health. Existing SHUTDOWN_TIMEOUT_MS defaults to 30 seconds; allow at least
45 seconds termination grace, longer when deliberately increasing the application bound.
SIGTERM drains requests/jobs and releases database connections; forced worker exits retain
leases for fenced recovery. Fatal/listener/startup failures exit unsuccessfully.

Application rollback selects the prior **compatible** image/configuration; it does not undo
Prisma migrations. Do not rewrite historical migrations, run reset or assume schema downgrade
safety. Prefer expand/backfill/contract releases across versions. Destructive/incompatible DDL
requires an approved maintenance/restore plan before release. After migration failure, pause
promotion, inspect history/schema on the verified target and plan a data-preserving forward fix.
Restoring a pre-migration backup is a separate incident operation with possible RPO data loss;
reconcile payment-provider transactions and inventory before reopening traffic.

During worker outages, restore capacity and let durable leases recover; never bypass fencing.
During payment incidents, use authoritative provider verification/manual review; never retry
ambiguous initiation or infer success from callbacks. During DB incidents, shed traffic through
readiness and follow Phase 2 restore/cutover procedures. Keep operational credentials and
customer data out of incident tickets. See the Phase 6 runbook for recommended alerts; none
is active until a collector and notification system are actually configured.

## Compatibility and verification limits

No customer endpoint, method, request/response field, envelope, auth requirement, tenant header,
HTTP status or checkout/payment calculation changed. Flutter rewrites are not required.
Deployment-only production configuration is stricter; valid client wire behavior is preserved.
No schema/migration edits or production seed execution occurred. Todo and notes edits remain.

Local validation does not prove target-specific DNS, TLS, secrets, ingress, backup restore,
hosted CI permissions, capacity or real provider/email delivery. Hosted Actions, real staging
and production procedures remain unexecuted by scope, not silently claimed complete.

References: [official Node image](https://github.com/nodejs/docker-node),
[setup-node](https://github.com/actions/setup-node),
[checkout](https://github.com/actions/checkout),
[actionlint release](https://github.com/rhysd/actionlint/releases/tag/v1.7.7).

## Phase 7 verification record

- Full PostgreSQL suite: **905 passed, 0 failed, 0 skipped**, 50 files. All 893 baseline
  tests remain; 12 new deployment guard tests cover production selection, secrets, origins,
  provider environment, migration approvals/target/TLS and advisory-lock safety.
- Focused regressions: **716 passed, 0 failed, 0 skipped**, 22 files.
- Prisma validate/generate, typecheck and production build passed. The guarded full test runner
  deployed all 16 migrations freshly and found no drift. All application sources and Prisma
  files are byte-identical to the pre-Phase-7 snapshot. No migrations added or changed.
- Actual local Docker runtime/migration builds and Compose startup passed on Linux ARM64:
  UID 1000; no project development tools/source/env files in runtime; independent API/worker;
  liveness/readiness; protected metrics; repeat migrate deploy; clean exit 0 on shutdown;
  rejected live selection and unapproved production migration. Containers/network removed;
  generated verification volumes retained. The default existing Compose/database was untouched.
- actionlint 1.7.7 checksum-verified workflow validation passed locally. Hosted Actions and
  Linux x64 container execution await a future authorized push/run; neither is claimed executed.
- Production dependency audit: **0 vulnerabilities**. Full audit: **11 moderate development
  findings, 0 high/critical**. CI fails on production moderate+ or any high/critical finding.
- Focused ESLint/Prettier and the no-new-debt quality gate passed. A temporary intentional
  unused/unformatted file was rejected by the gate and then removed. Strict global checks
  still report the unchanged 46 lint findings and 214 formatting files, documented above.
- Scoped diff check passed. Full git diff --check reports only pre-existing notes.txt:36
  whitespace; no user file was edited to hide it. Existing todo_production.txt edits that
  changed during the session were left untouched.
- No real environment, registry publication, production DB, backup schedule, live payment,
  commit or push was accessed/activated by this phase. Target TLS/ingress/secrets, email,
  hosted CI and real Kuwait sandbox validation remain operational steps.

Exact Phase 7 files:

- `.dockerignore`
- `.github/workflows/ci.yml`
- `.nvmrc`
- `Dockerfile`
- `compose.verify.yml`
- `config/ci-quality-baseline.json`
- `deploy/check-environment.mjs`
- `deploy/entrypoint.sh`
- `deploy/environment.mjs`
- `deploy/healthcheck.mjs`
- `deploy/migrate.mjs`
- `deploy/production.env.example`
- `deploy/tests/environment.test.mjs`
- `docs/deployment-and-ci.md`
- `package-lock.json`
- `package.json`
- `scripts/ci-quality.mjs`
- `scripts/validate-workflows.mjs`
- `scripts/verify-containers.mjs`
