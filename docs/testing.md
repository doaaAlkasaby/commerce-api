# PostgreSQL test setup

Start the repository's PostgreSQL test service:

```sh
docker compose up -d postgres-test
```

Set `TEST_DATABASE_URL` in `.env` to the test service. The checked-in `.env.example`
contains the local test credentials and port (5433). The test role needs permission
to create databases; the Compose test role has it. Never point this setting at a
production server. Generate the current client:

```sh
npx prisma generate --config prisma7.config.ts
```

Run the complete suite:

```sh
npm run test:postgres
```

This command reads only `TEST_DATABASE_URL`, creates a uniquely named database,
applies the 16 checked-in migrations, verifies an empty Prisma schema diff, enables all five hardening integration flags,
and runs every test. Both Prisma clients and checkout replay subprocesses receive
the same disposable database URL. Test files run serially to bound database
connections and keep integration timing predictable. The command removes only the
database it created, on success or failure, and returns a nonzero status on failure.
It never resets an existing database, edits migration history, or runs `db push`.
`NODE_ENV=production` and URLs without a test database name are rejected.

To run focused tests, pass Vitest file filters after `--`:

```sh
npm run test:postgres -- tests/readiness tests/middleware/not-found.test.ts
```

To run the five Points 1–14 integration suites separately:

```sh
npm run test:postgres -- tests/checkout \
  tests/inventory/inventory.concurrency.integration.test.ts \
  tests/inventory/inventory.reservation-lifecycle.integration.test.ts \
  tests/tenant/tenant-isolation.integration.test.ts
```

`npm test` remains the existing direct Vitest command. When using it directly, you
must provision a disposable migrated database yourself, set both `DATABASE_URL`
and `TEST_DATABASE_URL` to it, and enable the five `RUN_*_INTEGRATION` flags listed
in `scripts/test-postgres.ts`. Otherwise the existing opt-in integration suites are
not enabled. Use `test:postgres` for the complete verification gate.

The older local `commerce_api_test` database has migration records from a different
migration set. It is not used or repaired by this command. No production or existing
test database needs to be reset to verify this checkout.

For a migration/schema-only check, run `npm run db:verify`. It creates and removes its
own disposable database without running tests. The full command also stops before
tests if schema drift exists. Production connection and recovery procedures are in
[production-database.md](production-database.md).

For historical monetary migration upgrade verification, run
`npx tsx scripts/verify-money-migration.ts`. See [money policy](currency-and-money-policy.md).

Phase 4 adds the separate PostgreSQL worker suite: `npm run test:postgres -- tests/recovery`.
See [worker and payment recovery policy](payment-recovery-and-workers.md) for lease,
shutdown, migration-upgrade and operational checks.

Phase 5 security regressions: `npm run test:postgres -- tests/security tests/auth`.
Production shared rate limiting requires migration 16; see [security hardening](security-hardening.md).
