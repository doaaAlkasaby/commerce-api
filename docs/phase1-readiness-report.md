# Production readiness — Phase 1 verification report

Date: 2026-10-30. Branch: `hardening/tenant-isolation`. No commit or push.

## A. Initial errors

Both `npm run typecheck` and `npm run build` reproduced exactly 27 diagnostics.

| Root cause                                        | Count | Explanation                                                                                                                               |
| ------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Incorrect imports                                 |     4 | Two nonexistent `config/prisma.js` imports; nonexistent `ErrorCode` export and `UnauthorizedError` module.                                |
| Incorrect error constructor contract              |     4 | Country errors passed `(code, message, status)` instead of `(message, status, code)`.                                                     |
| Stale address schema references / mapper contract |    10 | Six mapper call errors and four repository write errors used `country` where the current database model uses `countryCode`.               |
| TypeScript strictness / DTO boundaries            |     8 | Commerce middleware optional values (1), tenant create DTO (1), Express 5 route parameters (4), Prisma tenant/member optional writes (2). |
| Repository/service contract                       |     1 | Tenant controller called nonexistent `getById` instead of `getTenantById`.                                                                |

No generated-client defect or schema migration is required.

| Original location                                         | Diagnostic |
| --------------------------------------------------------- | ---------- |
| `src/common/context/commerce-context.repository.ts(1,24)` | TS2307     |
| `src/common/context/commerce-context.service.ts(3,3)`     | TS2305     |
| `src/common/context/commerce-context.service.ts(40,11)`   | TS2345     |
| `src/common/context/commerce-context.service.ts(59,9)`    | TS2345     |
| `src/common/context/require-commerce-context.ts(15,7)`    | TS2345     |
| `src/middleware/commerce-context.middleware.ts(15,58)`    | TS2379     |
| `src/modules/addresses/address.controller.ts(25,24)`      | TS2345     |
| `src/modules/addresses/address.controller.ts(42,27)`      | TS2345     |
| `src/modules/addresses/address.controller.ts(60,24)`      | TS2345     |
| `src/modules/addresses/address.controller.ts(84,24)`      | TS2345     |
| `src/modules/addresses/address.controller.ts(130,24)`     | TS2345     |
| `src/modules/addresses/address.controller.ts(154,24)`     | TS2345     |
| `src/modules/addresses/address.repository.ts(39,9)`       | TS2559     |
| `src/modules/addresses/address.repository.ts(74,9)`       | TS2559     |
| `src/modules/addresses/address.repository.ts(126,7)`      | TS2375     |
| `src/modules/addresses/address.repository.ts(139,7)`      | TS2375     |
| `src/modules/countries/country.repository.ts(1,24)`       | TS2307     |
| `src/modules/tenants/tenant.controller.ts(18,35)`         | TS2307     |
| `src/modules/tenants/tenant.controller.ts(30,36)`         | TS2379     |
| `src/modules/tenants/tenant.controller.ts(45,29)`         | TS2339     |
| `src/modules/tenants/tenant.controller.ts(66,11)`         | TS2345     |
| `src/modules/tenants/tenant.controller.ts(89,11)`         | TS2322     |
| `src/modules/tenants/tenant.controller.ts(108,11)`        | TS2345     |
| `src/modules/tenants/tenant.controller.ts(130,11)`        | TS2345     |
| `src/modules/tenants/tenant.repository.ts(14,7)`          | TS2375     |
| `src/modules/tenants/tenant.repository.ts(58,7)`          | TS2375     |
| `src/modules/users/user.service.ts(105,53)`               | TS2345     |

## B. Exact fixes and files

- `src/common/context/commerce-context.repository.ts`: use the existing database client module.
- `src/common/context/commerce-context.service.ts`: remove nonexistent export, correct country error arguments, handle a missing user safely.
- `src/common/context/require-commerce-context.ts`: correct country error arguments.
- `src/middleware/commerce-context.middleware.ts`: represent absent optional country/user values with supported nulls.
- `src/modules/countries/country.repository.ts`: use the existing database client module.
- `src/modules/addresses/address.repository.ts`: map the existing public `country` input to `countryCode` in both transactional and standalone create/update operations; retain transaction boundaries.
- `src/modules/addresses/address.mapper.ts`: map database `countryCode` back to public `country`; keep the response field set.
- `src/modules/addresses/address.controller.ts`: parse validated values without the former `any` casts, omit absent update fields, pass the address ID string rather than the entire params object.
- `src/modules/tenants/tenant.controller.ts`: call the existing service method, validate Express 5 string params, construct strict DTOs with absent optional properties omitted, use the existing authentication error convention.
- `src/modules/tenants/tenant.repository.ts`: omit undefined optional fields so Prisma defaults and strict generated types remain effective.
- `src/modules/tenants/tenant.types.ts`: permit the existing schema's nullable `legalName` update.
- `src/modules/users/user.service.ts`: correct unsupported-country error arguments.
- `tests/readiness/phase1.api.test.ts`: seven real PostgreSQL contract regressions covering countries/context, addresses, tenants, membership, authentication and missing resources.
- `docs/phase1-readiness-report.md`: this report.

The pre-existing user edit to `todo.txt` was preserved. No tsconfig relaxation, suppression, unsafe assertion, new `any`, or test disabling was introduced.

## C–D. Typecheck and production build

`npm run typecheck`: PASS, zero diagnostics.

`npm run build`: PASS, exit 0.

## E. Tests

The checkout contains 572 existing tests, rather than the supplied 412-test baseline. With seven added regressions there are 579 tests.

Full run against real PostgreSQL, all five integration flags enabled, file parallelism disabled to prevent failed fixture cleanup from affecting concurrent suites:

- 482 passed, 68 failed, 29 skipped by failed suite setup; 28 files passed, 9 failed.
- No test was newly skipped or disabled. All five opt-in integration flags were set to `1`.
- The seven new contract tests pass in the full run.
- Separate definitive run of all five hardening integration suites plus the new contract suite: 387 passed, 0 failed, 0 skipped (six files). POINTS 1–14 REMAIN COMPLETE; their production implementations were preserved and these focused integrations remain green.
- 37 product-service failures: old signatures/repository mocks and removed methods such as `listAdmin`; fixtures still describe the former product-level SKU/price model.
- 13 category-service and 4 category/brand image-service failures: missing tenant arguments in older tests.
- 13 category API failures: older requests omit the tenant context/membership required by current hardening.
- 1 not-found failure: the existing root-mounted product-review router applies tenant middleware to unrelated paths, producing 401 before the 404 handler.
- 29 tests cannot run because older category/product/inventory repository and product API fixtures omit tenant-aware arguments or required relations. Their cleanup also uses undefined IDs, which can affect other suites during parallel execution.

These existing catalog tests were left intact; restoring obsolete production interfaces or weakening tenant isolation to satisfy them would violate this task's constraints. Repairing those fixtures and reconciling obsolete test expectations remains necessary before claiming a fully green Phase 1.

Reproduction (with `DATABASE_URL` and `TEST_DATABASE_URL` pointing to an isolated migrated test database):

```sh
RUN_CHECKOUT_INTEGRATION=1 \
RUN_COUPON_CONCURRENCY_INTEGRATION=1 \
RUN_INVENTORY_CONCURRENCY_INTEGRATION=1 \
RUN_RESERVATION_LIFECYCLE_INTEGRATION=1 \
RUN_TENANT_INTEGRATION=1 \
npm test -- --no-file-parallelism
```

## F–G. Prisma and database changes

`npx prisma validate --config prisma7.config.ts`: PASS.

`npx prisma generate --config prisma7.config.ts`: PASS; client 7.10.1.

Schema changes: NONE. Migration file changes: NONE. All 12 existing migrations deployed successfully to a fresh isolated database, `commerce_api_phase1_20261030`, in the documented PostgreSQL test service on localhost:5433.

The original test service was stopped. After starting it, its existing `commerce_api_test` database had tables but inconsistent migration history: migration deploy failed with P3018 / PostgreSQL 42710 (`ProductStatus` already exists). That failed attempt is recorded in its migration metadata. No reset, db push, destructive migration, old-migration edit, or production data erasure was performed. Verification continued in the separate database. The local test container and isolated verification database remain available.

## H. Lint, formatting and diff

Focused ESLint and Prettier checks cover all changed source files and the new test file. `git diff --check` covers the entire working diff. Results: PASS. No repository-wide lint-clean claim is made.

## I. API compatibility

| Area                       | Result                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing endpoints changed | Implementation repairs to address create/list/read/update/default endpoints, tenant create/read/update/member endpoints, and shared country resolution. No route registration, method or path changes.                                                                          |
| New endpoints              | NONE.                                                                                                                                                                                                                                                                           |
| Requests                   | Existing names, optionality and null behavior retained; address input remains `country`. No country-header or tenant-header change.                                                                                                                                             |
| Responses                  | Existing envelopes, messages and fields retained/restored; addresses expose `country`, not `countryCode`. No new coordinates or database fields exposed.                                                                                                                        |
| HTTP status/errors         | Correct intended country errors now return 400 with `COUNTRY_REQUIRED` / `COUNTRY_NOT_SUPPORTED`. Tenant lookup now reaches existing 200/404 behavior. Address lookup now passes the ID correctly. These repair broken execution rather than introduce a new intended contract. |
| Authentication / tenant    | Existing middleware and tenant enforcement retained. No header or verified-email policy changes.                                                                                                                                                                                |
| Flutter changes required   | NONE.                                                                                                                                                                                                                                                                           |
| Breaking changes           | NO.                                                                                                                                                                                                                                                                             |

Existing root product-review middleware spillover and `/tenants/me` ordering were not changed; changing routing/authentication semantics requires separate contract review.

## J. Remaining blockers and Phase 2

The production source typecheck/build implementation is complete, but full-suite verification is blocked by the stale catalog tests and existing routing behavior described above. Do not treat this report as a green production-readiness gate.

Before advancing, reconcile the catalog fixtures/tests with current tenant and variant contracts, constrain cleanup to created IDs, and agree on the existing 404/tenant routing contract. These are remaining verification tasks, not a reason to add Phase 2 migrations here.

For Phase 2, audit and reconcile the pre-existing test database migration metadata without destructive operations; review route scoping/order against Flutter expectations. No schema change has been shown necessary by these 27 errors. Payment gateways, workers, new features and Phase 2 migrations were not implemented. Checkout calculations and preview, inventory reservations, coupon concurrency, idempotency, payment transitions and tax implementations were untouched.
