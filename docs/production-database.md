> Phase 5 adds migration 16 for shared PostgreSQL rate budgets. Apply it before deploying the API with production shared rate limiting. See [security policy](security-hardening.md). Earlier phase counts below remain historical.

> Phase 4 adds migration 15 for reservation deadlines and durable PostgreSQL recovery jobs. See [worker operations](payment-recovery-and-workers.md). Prior phase verification counts below remain historical.

> Phase 3B adds migration 14 for currency-aware NUMERIC(14,4) money. See [money policy](currency-and-money-policy.md). Earlier phase verification counts below are historical.

# Production database and migration safety

Phase 3 adds an additive thirteenth migration for MyFatoorah mapping/event tracking;
see [myfatoorah-integration.md](myfatoorah-integration.md). The 12-migration verification
records below describe the completed Phase 2 baseline. Existing migration files remain
unchanged; the current disposable runner deploys all checked-in migrations.

This runbook prepares deployment; it does not configure a production server, backups,
retention jobs or point-in-time recovery. No real production database was accessed.
Phase 2 verification used disposable PostgreSQL 17 databases only.

## Configuration and secrets

Supply secrets through the deployment secret manager or mounted secret files. Do not
commit `.env`, enable shell tracing around secrets, print URLs, or put passwords in
command arguments. URL-encode reserved characters in URL credentials. Use a dedicated
runtime role with only the application privileges it needs and a separately controlled
migration role with the DDL privileges required by the reviewed migration files.
The test role needs `CREATEDB` on the test cluster only.

| Setting                    | Behavior                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Required PostgreSQL URL with a database name; used by the API and Prisma CLI.   |
| `TEST_DATABASE_URL`        | Test-cluster URL only. Never a fallback to `DATABASE_URL`.                      |
| `DB_POOL_MAX`              | Maximum connections per application process; default 10.                        |
| `DB_CONNECTION_TIMEOUT_MS` | Bounded connection acquisition/connection wait; default 5000 ms.                |
| `DB_IDLE_TIMEOUT_MS`       | Idle connection retirement; default 10000 ms; zero disables idle retirement.    |
| `DB_SSL_MODE`              | `url` (default), `disable` (local only), or `verify-full`.                      |
| `DB_SSL_CA_FILE`           | Optional mounted CA file, allowed only with explicit `DB_SSL_MODE=verify-full`. |
| `SHUTDOWN_TIMEOUT_MS`      | Total HTTP drain plus database disconnect budget; default 30000 ms.             |

Local development and disposable tests can continue using plaintext PostgreSQL.
`NODE_ENV=production` requires certificate-verified TLS. The preferred configuration
for both API and CLI is a URL whose query contains `sslmode=verify-full`, with
`DB_SSL_MODE=url`. If the provider uses a private CA, add an URL-encoded
`sslrootcert` file path as supported by the client/provider. Mount the CA at the same
path for the migration job and API. Never use certificate-verification bypass flags.

For the API alone, explicit `DB_SSL_MODE=verify-full` builds a node-postgres SSL
configuration with `rejectUnauthorized: true` and optional mounted CA contents.
Do not combine explicit mode with URL TLS parameters: node-postgres can replace the
SSL object when URL TLS parameters are present. The application rejects that mixture.
The Prisma CLI has its own connection handling: it always needs TLS configured in
its URL; an API-only `DB_SSL_MODE` does not configure migrations. Production Prisma
commands reject URLs without `sslmode=verify-full`.

A `schema` URL parameter is forwarded to the Prisma adapter; the default is `public`.
Pool settings belong to the Node adapter, not Prisma URL pool parameters such as
`connection_limit`. Do not assume those URL parameters resize the driver pool.
There is no new statement/query timeout: adding one blindly could interrupt the
existing checkout transaction. Choose server statement/lock/idle-in-transaction
limits from measured operation durations and recovery objectives, and rehearse them.

## Connections and shutdown

The API owns one adapter-managed pool. Prisma `$disconnect()` closes it. Tests own a
separate pool with `TEST_DATABASE_URL`. Budget maximum connections across all replicas,
rolling-deploy overlap, migration/maintenance sessions and operational headroom; do
not allocate the entire PostgreSQL connection limit to normal API replicas.

Startup performs an actual `SELECT 1` before accepting HTTP requests, since the pool
is lazy. Idle-pool/connection errors are handled and logged using bounded codes only;
startup/shutdown logs do not serialize connection errors or credentials. Invalid
environment diagnostics contain validation paths/messages, not environment values.

SIGTERM/SIGINT stop new HTTP acceptance, allow active requests to finish, then close
the database. Duplicate signals do not start another shutdown. A stalled request or
disconnect is bounded by `SHUTDOWN_TIMEOUT_MS`; connections are force-closed and the
process exits unsuccessfully on timeout. Set the orchestrator's termination grace
period higher than that budget. Timeout termination can abort in-flight transactions;
PostgreSQL rollback and existing checkout replay/idempotency remain the recovery path.

## Schema consistency: actual Phase 2 findings

All 12 checked-in migrations deploy from empty PostgreSQL. The initial supported
`prisma migrate diff` comparison **did find drift** between that physical result and
the schema declarations:

- Five intentionally retained legacy columns: `ShippingProfile.name` and `scopeKey`,
  `ShippingRule.isActive`, `TaxCategory.scopeKey`, `TaxProfile.scopeKey`.
- The database has `ShippingProfile.currency DEFAULT 'USD'`; the schema omitted it.
- 25 existing non-unique indexes were absent from the schema declarations.
- Three indexes existed only as declarations, not in any migration:
  `User(defaultCountryCode)`, `TaxProfile(countryCode, regionCode)`, and
  `TaxRule(countryCode, regionCode, taxCategoryId)`.

The exact retained index declarations missing from the initial schema were:

| Table             | Indexed column sets                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------- |
| AppSetting        | `(isPublic)`                                                                                 |
| Banner            | `(endsAt)`, `(isActive)`, `(sortOrder)`, `(startsAt)`                                        |
| Brand             | `(isActive)`                                                                                 |
| Category          | `(isActive)`, `(parentId)`                                                                   |
| Order             | `(couponId)`, `(createdAt)`, `(paymentStatus)`, `(status)`, `(userId,createdAt)`, `(userId)` |
| Product           | `(brandId)`, `(categoryId)`, `(createdAt)`, `(status)`                                       |
| ProductCollection | `(isActive)`                                                                                 |
| ShippingRule      | `(isActive)`                                                                                 |
| ShippingZone      | `(countryCode)`, `(countryCode,regionCode)`, `(isActive)`                                    |
| TaxCategory       | `(isActive)`                                                                                 |
| TaxProfile        | `(countryCode)`                                                                              |

The four retained legacy name/scope columns are nullable text. The retained
`ShippingRule.isActive` is a non-null Boolean with its existing `true` default.

The tenant migration explicitly retained old scope/name data for review. Removing
those columns to match the old declarations would discard data. Phase 2 instead
reconciles **schema metadata to the existing physical database**: retained columns
are `@ignore` so they remain excluded from Prisma client reads/writes and API outputs;
the existing default/indexes are declared; the three never-deployed index declarations
are removed. None of this executes DDL. No old migration was changed and no new
migration is necessary. A new disposable deployment now produces **no difference**.

Prisma compares the objects it supports. A clean diff is not a guarantee about
out-of-band views, triggers, RLS policies, extensions, role grants or provider settings;
review those separately when they exist on a deployment target.

### Reproduce safely

```sh
# Uses TEST_DATABASE_URL, creates a fresh database, deploys migrations, compares,
# and drops only its own UUID-named disposable database.
npm run db:verify

# Same migration/drift gate, followed by ALL tests and automatic cleanup.
npm run test:postgres
```

The underlying read-only comparison is:

```sh
npx prisma migrate diff --config prisma7.config.ts \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Run it with `DATABASE_URL` set to a disposable deployment or restored rehearsal copy.
Exit 0 means no supported-object differences, 2 means drift, and 1 means a comparison
error. Never pipe generated SQL into a database automatically. The runner stops before
tests if drift exists. Its `--schema-only` mode is used by `db:verify`.

## Production migration deployment

The repository's `db:migrate` and `db:migrate:deploy` both use **`prisma migrate deploy`**
with `prisma7.config.ts`. The former development-default command was replaced so a
normal deployment command does not start interactive schema reconciliation. No
production command invokes `db push` or `migrate reset`. Review all migration SQL:
`migrate deploy` applies it, and cannot make arbitrary destructive SQL safe.

1. Identify the target, release artifact and current migration history. Use a restored
   copy first; confirm it belongs to this checked-in lineage, including checksums.
2. Review pending SQL, locks, deployment overlap and disk space. Take and verify a
   pre-migration backup/PITR recovery point. Rehearse on the restored representative data.
3. Do not baseline an unknown existing database by marking migrations applied merely
   to suppress errors. The older local test database uses a different lineage and is
   deliberately left untouched. A real target with a mismatch needs its own reviewed
   reconciliation plan before deployment.
4. The historical tenant migration creates a legacy tenant and derives related
   ownership. Its guards abort on ambiguous ownership, unsupported/ambiguous address
   countries or shipping profiles spanning countries. Inspect these conditions on the
   restored copy; do not bypass the guards or invent tenant ownership automatically.
5. Run one controlled migration job per release, using the migration role and verified
   TLS URL. Do not run development/test seeds as part of production deployment.

```sh
# Run only in the intended release job with secret-managed DATABASE_URL.
NODE_ENV=production npm run db:migrate:status
NODE_ENV=production npm run db:migrate:deploy
NODE_ENV=production npm run db:migrate:status
```

6. Deploy/continue the API only after the migration job succeeds. Verify health,
   runtime-role privileges, a representative tenant read, and the approved smoke flow.
   Monitor pool acquisition failures, locks, query latency and idempotent replays.

Generate/review future migrations in an isolated development environment. Prefer
expand/backfill/contract across compatible releases; keep legacy data until retention
and compatibility review permits removal. Add forward-only migrations only for an
actual physical change, and test them on representative existing data. Phase 2 adds none.

## Backup strategy and retention

Choose RPO/RTO with the service owner. An example starting policy is daily logical
custom-format dumps plus provider-managed physical backups and continuous WAL/PITR
for a shorter RPO. A daily dump alone permits nearly a day's data loss and is not PITR.
Example retention is 7 daily, 4 weekly and 12 monthly copies, subject to privacy,
legal and business requirements. These are recommendations, **not configured jobs**.

Encrypt backups in transit and at rest, separate storage and access from the database
account, use immutable/object-lock copies where available, and protect encryption keys
separately. Monitor job completion, object size/checksums and retention deletion. Keep
backup manifests with UTC time, database/server/client version, release ID and migration
checksums; never put passwords in the manifest. Backup roles need the provider-approved
read privileges, and backup files contain sensitive application data.

Use a `pg_dump` client compatible with the server (the disposable rehearsal used
PostgreSQL 17 tools). Logical dumps cover one database, not cluster roles, tablespaces,
server parameters or external files. Preserve role/grant/provider configuration through
a separate secured process; any globals export may contain sensitive role information.

### Executable logical backup example

Provision `PGSERVICEFILE` and `PGPASSFILE` outside the repository with restrictive
permissions. Define `commerce_backup` to point to the intended database with verified
TLS. The password lives in the mounted passfile, not the command line. This example
assumes a secure backup directory has already been created by the backup service.

```sh
set -eu
umask 077
export PGSERVICEFILE=/run/secrets/pg_service.conf
export PGPASSFILE=/run/secrets/pgpass
export PGSERVICE=commerce_backup
backup_dir=/var/lib/commerce-backups
backup_path="$backup_dir/commerce-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --no-password --format=custom --file="$backup_path"
pg_restore --list "$backup_path" > "$backup_path.toc"
sha256sum "$backup_path" > "$backup_path.sha256"
```

Upload/archive using the approved encrypted storage tool and verify the remote checksum.
A TOC/checksum check is not a restore test. The `sha256sum` example targets Linux
production tooling; macOS can use `shasum -a 256`.

### Restore rehearsal and recovery

Perform restore verification regularly (for example weekly), before risky migrations,
and after backup, PostgreSQL or encryption changes. Restore into a **new isolated
database** on a non-production recovery server; prevent outbound application emails,
webhooks and jobs. Define a separate `commerce_restore` service that has no production
endpoint. The following example never overwrites an existing database:

```sh
set -eu
umask 077
export PGSERVICEFILE=/run/secrets/pg_service.conf
export PGPASSFILE=/run/secrets/pgpass
export PGSERVICE=commerce_restore
backup_path=/secure/restore-input/commerce.dump
restore_name="commerce_restore_$(date -u +%Y%m%dT%H%M%SZ)"
createdb --no-password "$restore_name"
pg_restore --no-password --exit-on-error --single-transaction \
  --no-owner --no-privileges --dbname="$restore_name" "$backup_path"
psql --no-password --dbname="$restore_name" --set=ON_ERROR_STOP=1 \
  --command='SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at;'
```

Apply approved ownership/grants for the restore environment separately: `--no-owner`
and `--no-privileges` deliberately do not recreate production role assignments. Verify
foreign keys, representative row counts, order/payment totals, inventory quantity and
reservation totals, tenant separation and legacy retained values against the backup
manifest. Run the read-only schema comparison with the restored URL and compatible
release artifact. Test business reads and the agreed recovery smoke checks. Record
elapsed restore and recovery time against RTO. Do not deploy the test suite against the
restored copy: its fixtures/cleanup are for disposable test databases, and the canonical
runner creates a different fresh database.

For an incident: stop/contain writes, preserve failed-job logs without secrets, identify
the last good backup/PITR timestamp, restore to a new target, verify data and migration
state, then perform an explicitly approved application cutover. PITR setup and cutover
commands depend on the provider and are not configured by this repository. Reconcile
writes made after the restore point before reopening traffic.

A code rollback does not reverse schema/data migrations. Roll back application code
only if it remains compatible with the deployed schema; otherwise use a reviewed
forward repair or restore-and-cutover plan. Some migrations can partially apply before
failing; inspect actual state and replay on the restored copy. Do not edit historical
SQL, mark an unknown migration resolved blindly, or drop data to make deploy succeed.

## Index review

| Operation / repository       | Existing support                                                                | Review outcome                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tenant resolution/membership | Unique `Tenant.slug`, `Tenant.code`, `(tenantId,userId)` membership             | Direct indexed equality lookup; no missing required index demonstrated.                                                        |
| Product catalog              | Tenant/category/brand/status/createdAt indexes plus retained global indexes     | Filters/order supported; investigate `(tenantId,status,createdAt)` only with representative plans, selectivity and write cost. |
| Variants                     | Unique SKU, `(productId,combinationKey)`, `(productId,isDefault)`               | SKU/combination/default lookup supported.                                                                                      |
| Inventory                    | Unique `variantId`, PK; transaction uniqueness `(inventoryId,type,referenceId)` | Existing locks/guards and idempotent lookup remain unchanged.                                                                  |
| Cart                         | Unique `(tenantId,userId)` and item `(cartId,variantId)`                        | Current access paths supported.                                                                                                |
| Orders                       | Tenant/user/status/paymentStatus/createdAt and legacy user-createdAt indexes    | A compound tenant-user-createdAt candidate needs real workload evidence; no speculative addition.                              |
| Payments                     | PK, orderId, status, provider, providerPaymentId, providerTransactionId         | Tenant ownership is checked through indexed order joins.                                                                       |
| Coupon usage                 | Unique orderId and `(couponId,userId)`, userId, couponId                        | Concurrency/count/lookup patterns supported.                                                                                   |

Potential overlapping B-tree indexes include single `tenantId` indexes with tenant-leading
unique/composite indexes, `CartItem(cartId)` with `(cartId,variantId)`, and
`CouponUsage(couponId)` with `(couponId,userId)`. They are **review candidates**, not proof
of redundancy under real write/read/FK workloads. No index was added or dropped.

On 10,000 synthetic products across ten tenants, `EXPLAIN (ANALYZE, BUFFERS)` for a
20-row active tenant listing ordered by creation time used existing
`Product_createdAt_idx`: 20 rows, 370 filtered rows, 13 shared buffer hits, 0.117 ms
execution time on local PostgreSQL 17. This is a rehearsal, not a production benchmark.
It also demonstrates why old global indexes should not be removed without measurement.
Use production-like restored data, statistics, `pg_stat_statements` where approved,
and before/after plans before proposing index migrations.

## Verification and deployment checklist

- [ ] Secrets, database identity, verified TLS/CA and runtime/migration roles checked.
- [ ] Replica pool budget, acquisition timeout and shutdown grace period reviewed.
- [ ] Backup/PITR configured by the operator, retention monitored, restore timed/tested.
- [ ] Target migration lineage/checksums match; representative restored data rehearsal passed.
- [ ] `db:verify`, complete PostgreSQL tests, Prisma validate/generate, typecheck/build passed.
- [ ] Migration SQL/locks and application compatibility reviewed; one deploy job succeeds.
- [ ] Health, tenant smoke checks, monitoring and recovery/cutover ownership confirmed.

Phase 2 rehearsal successfully dumped/restored 10,000 products, all 12 migration
records, legacy shipping/tax values and inventory 12 physical/3 reserved into a second
disposable database, compared values, and found no schema drift afterward. Both
rehearsal databases were removed. This verifies the local procedure, not production
backup scheduling, storage durability or provider recovery.

References: [node-postgres TLS](https://node-postgres.com/features/ssl),
[node-postgres pool](https://node-postgres.com/apis/pool),
[PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html),
[PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Phase 2 verification record

- Initial migration deployment: 12 existing migrations succeeded; initial comparison
  detected the drift listed above. Final fresh comparison: **no difference detected**.
- Final full PostgreSQL suite: **617 passed, 0 failed, 0 skipped**, 41 files. All 597
  Phase 1B tests remain green; 20 tests were added for configuration, shutdown and
  disposable identifier guards. All five hardening integration flags remain enabled.
- Prisma validate/generate: PASS, client 7.10.1. Typecheck and production build: PASS.
- Focused ESLint, Prettier and `git diff --check`: PASS.
- Built-server smoke: actual PostgreSQL startup/HTTP health, SIGTERM drain and clean
  exit PASS; unreachable-database startup exits unsuccessfully without logging the
  synthetic password or connection URL. The smoke database was removed.
- Actual pg_dump/pg_restore rehearsal and restored-schema comparison: PASS, with
  representative retained data and inventory values preserved. No backups scheduled.
- No physical schema change, new migration, index creation/removal or old migration edit.
- No real production database access, deployment, commit or push. Existing user edits
  including `todo.txt` and the completed Phase 1/1B changes were preserved.

Phase 2 changed files (earlier phase changes remain separate):

- `.env.example`, `package.json`, `prisma7.config.ts`, `prisma/schema.prisma`
- `src/config/database-options.ts`, `src/config/env.ts`, `src/config/database.ts`,
  `src/config/test-database.ts`, `src/common/lifecycle/shutdown.ts`, `src/server.ts`
- `scripts/test-postgres.ts`, `tests/config/database-options.test.ts`,
  `tests/config/shutdown.test.ts`, `tests/readiness/test-postgres-config.test.ts`
- `docs/testing.md`, `docs/production-database.md`

API compatibility: **no existing endpoints changed**, no new endpoints, no request or
response changes, no HTTP status/error-envelope changes, no authentication or tenant
header changes. Flutter changes required: **none**. Breaking changes: **NO**. Production
TLS/pool/shutdown settings are deployment configuration requirements, not wire-contract
changes. Retained legacy fields remain ignored by the generated Prisma client.

No implementation/verification blocker remains. Actual production role provisioning,
CA/secret mounting, backup/PITR configuration and target-specific migration preflight
remain operator deployment steps; none is claimed configured or verified on production.
The older local test database remains untouched and bypassed.

**POINTS 1–14 REMAIN COMPLETE. PHASE 1 AND PHASE 1B REMAIN COMPLETE.**
