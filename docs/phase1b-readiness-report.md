# Production readiness — Phase 1B

Date: 2026-10-30. Branch: `hardening/tenant-isolation`. Phase 1 fixes and user edits
(including `todo.txt`) preserved. No commit, push, or deployment.

## A–B. Initial failures and root causes

Reproduced against the Phase 1 disposable PostgreSQL database, with every
integration flag enabled: **482 passed, 68 failed, 29 setup-blocked/skipped**,
across 37 files. The pre-existing 579 tests include the seven Phase 1 contract tests.

| Classification                             | Root cause                                                                                                                                                                                                                                   | Initial impact                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A. Outdated tests                          | Product service signatures, repository mocks and method names predated tenant scoping and current public catalog APIs. Product-level SKU/price fields, admin GET routes, status query filters and pagination navigation flags were obsolete. | 37 failed product-service tests.                                                                                               |
| A/B. Outdated tests and incorrect fixtures | Category and image-service calls omitted tenant arguments; mock category results omitted `_count.children` required by the current mapper.                                                                                                   | 13 category-service and 4 image-service failures.                                                                              |
| B. Incorrect fixtures                      | Category API requests omitted `X-Tenant-Slug` and tenant membership/roles. A global admin role is not a tenant membership.                                                                                                                   | 13 failed category API tests.                                                                                                  |
| B. Incorrect fixtures / stale models       | Category/product/inventory repository and product API fixtures omitted tenants, used removed product fields, associated inventory with products rather than variants, or called former repository transaction APIs.                          | 29 tests blocked in four files.                                                                                                |
| C. Infrastructure                          | Failed-fixture cleanup could pass undefined IDs to Prisma, permitting broad cleanup or secondary failures in parallel suites. Existing direct test setup did not deploy migrations or enable the opt-in suites automatically.                | Secondary failures and unreliable repeatability.                                                                               |
| C. Migration history mismatch              | Existing `commerce_api_test` records refer to an older migration set.                                                                                                                                                                        | Existing test database unsuitable for this checkout; fresh databases deploy correctly.                                         |
| D. Genuine application bug                 | The root-mounted review router ran tenant middleware before checking whether the request matched a review route.                                                                                                                             | Unknown routes returned tenant errors instead of the intended 404; unrelated personal routes inherited the review tenant gate. |

## C. Test repairs

All existing test cases remain represented; none were deleted, disabled or converted
to skips. Tests now exercise the current application contracts rather than restoring
retired production interfaces.

- Category unit tests pass tenant IDs and model the actual category count selection.
- Category repository/API fixtures create dedicated tenants. API users have explicit
  tenant memberships; role-based 401/403 assertions and public retrieval assertions remain.
- Product fixtures use `basePrice` and variant-owned SKUs. SKU lookup and duplicate
  create/update rejection are checked against real PostgreSQL in the variant repository;
  a rejected duplicate update also verifies the original SKU remains intact.
- Product unit tests use typed spies on the current repository and retain duplicate
  slug/concurrent-unique-conflict, ownership, status transition, public visibility,
  pagination, filtering and search checks. Obsolete inactive-relation expectations
  are replaced by tenant-owned relation checks matching the existing service policy;
  no production relation policy was changed.
- Obsolete product-level SKU error expectations now test current P2002 translation;
  actual variant SKU uniqueness is covered at its owning repository, not mocked away.
- Pagination asserts all four current fields (`page`, `limit`, `total`, `totalPages`)
  and the correct offset. No fields were added to the response to satisfy old tests.
- Nonexistent admin GET test cases now exercise the existing authenticated product
  update/status routes and verify public visibility before/after activation. No admin
  endpoint was added. An additional test verifies activation requires an active variant.
- Inventory tests use variant IDs and the current tenant-scoped repository APIs.
  Low-level affected-row guards are tested directly; audit writes and idempotency are
  exercised through the transactional service where those responsibilities now live.
- New regressions cover all five review routes' tenant requirement, protected review
  authentication, public review reads, cross-tenant denial, personal-address ownership,
  and 404 envelopes for GET/POST/PATCH including query strings and unrelated tenant headers.

## D. Application bug fix

Only `src/modules/product-reviews/product-review.routes.ts` changes production
behavior in Phase 1B. `tenantMiddleware` now runs as the first middleware on each
of the five existing review routes. It no longer runs on requests merely passing
through that root-mounted router. Review authentication, validation, tenant scoping,
controllers, services and repositories retain their existing order and behavior.
The existing not-found middleware and error envelope are unchanged.

## E. Test infrastructure and database safety

Added `npm run test:postgres`, implemented by `scripts/test-postgres.ts` and documented
in `docs/testing.md`. It requires a PostgreSQL `TEST_DATABASE_URL` naming a test database,
rejects `NODE_ENV=production`, and never falls back to `DATABASE_URL`.

The runner creates a UUID-named disposable database, applies existing migrations,
sets **both** client URLs to it, enables all five integration flags, runs tests serially,
and drops only the database that this invocation successfully created. It cleans up
on test failure as well as success. Configuration safety has two focused tests.
Catalog teardown is scoped to a preallocated fixture tenant ID, including partial
setup failures; user cleanup filters undefined IDs or uses a known preallocated ID.

The existing test database was inspected in a **read-only transaction**: it contains
14 applied migration records from 2026-10-01 through 2026-10-14 that are absent from
this checkout, 21 public tables, and the failed newer initial migration record from
Phase 1 (`20261020143811_init`, zero applied steps). This is a different historical
migration lineage, not evidence that this checkout needs another schema migration.
No existing migration metadata was edited. No existing database was reset, pushed,
or destructively migrated. Every Phase 1B test write used disposable databases.

## F–G. Final test results

- Complete gate, `npm run test:postgres`: **597 passed, 0 failed, 0 skipped**, 39 files.
- Separate five-suite Points 1–14 hardening run: **380 passed, 0 failed, 0 skipped**, five files.
- Separate API contract/routing run: **23 passed, 0 failed, 0 skipped**, three files.
- API contract and routing regressions run against real PostgreSQL as part of the
  full gate, with no skipped suites. No assertion was changed merely to accept an
  erroneous application response.
- Count increased from 579 to 597: one activation guard, two runner-safety tests,
  twelve routing/ownership regressions, and three additional 404 method regressions.
- The runner successfully removes its newly created database after verification.

## H. Typecheck, build and checks

`npm run typecheck` and `npm run build`: PASS. Completed Phase 1 fixes were not repeated.

An additional strict TypeScript check covers the Phase 1B changed/new tests and runner,
using the existing compiler options and Express declarations: PASS. No compiler settings
were weakened and no suppressions, new `any`, or unsafe assertions were introduced.

Focused ESLint, Prettier and `git diff --check`: PASS.

## I. Prisma and migrations

`prisma validate --config prisma7.config.ts`: PASS.

`prisma generate --config prisma7.config.ts`: PASS, client **7.10.1**.

All **12 existing migrations** deploy successfully from empty databases in the disposable
runner. No schema changes, new migrations, edits to old migrations or generated-client
changes. No forward-only migration is needed.

## J. Flutter / API compatibility

| Area                       | Result                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing endpoints changed | Only review middleware placement is changed. Its five existing GET list/summary, POST, PATCH and DELETE routes retain paths and behavior. Unrelated routes no longer inherit the review router's tenant check.            |
| New endpoints added        | NONE.                                                                                                                                                                                                                     |
| Request changes            | NONE to declared fields, headers or validation. Review routes still require tenant context. Personal address routes retain their own authentication and ownership rules without an accidental review-tenant prerequisite. |
| Response changes           | NONE to successful response shapes, messages or the error envelope.                                                                                                                                                       |
| Status/error changes       | Unknown routes now reach the intended HTTP 404 / `ROUTE_NOT_FOUND` instead of an unrelated HTTP 401 tenant error. Existing review 401 authentication/tenant and cross-tenant 404 semantics are verified.                  |
| Authentication changes     | No review authentication, tenant membership, verified-email, checkout or address-ownership policy changed. Only middleware spillover onto unrelated paths was removed.                                                    |
| Flutter changes required   | NONE. Existing callers may continue sending the same headers.                                                                                                                                                             |
| Breaking changes           | **NO**. Routing correction restores intended Express fallthrough; no new public contract.                                                                                                                                 |

## K. Phase 1B files changed

Production:

- `src/modules/product-reviews/product-review.routes.ts`

Test repairs:

- `tests/categories/category.service.test.ts`
- `tests/categories/category.repository.test.ts`
- `tests/categories/categories.api.test.ts`
- `tests/categories/brand-category-image.service.test.ts`
- `tests/products/product.service.test.ts`
- `tests/products/product.repository.test.ts`
- `tests/products/products.api.test.ts`
- `tests/inventory/inventory.repository.test.ts`
- `tests/middleware/not-found.test.ts`

New test infrastructure and regression files:

- `tests/helpers/catalog.ts`
- `tests/readiness/routing.api.test.ts`
- `tests/readiness/test-postgres-config.test.ts`
- `scripts/test-postgres.ts`
- `package.json` (`test:postgres` script only)
- `docs/testing.md`
- `docs/phase1b-readiness-report.md`

The separate Phase 1 source changes, report and `tests/readiness/phase1.api.test.ts`
were preserved. The existing user changes to `todo.txt` were not modified.

## L. Remaining blockers

No implementation or verification blocker remains for the disposable PostgreSQL gate.
The old local test database's historical mismatch remains untouched and is bypassed
by the documented disposable runner. It is not a blocker and does not justify changing
production migration history.

No checkout features, gateways, workers, deployment, database redesign or unrelated
production refactors were implemented. **POINTS 1–14 REMAIN COMPLETE.**
