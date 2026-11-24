# Development seed and automated fixtures

Use the guarded development seed entrypoints described in the Phase 8.1 report. The account and fixture details below supersede the historical account table and two-store visual coverage in the Phase 8.1 and 8.2 reports.

## Accounts and test isolation

An empty development database receives the four shared accounts defined in `prisma/development/seed.ts`. Their tenant roles are admin, manager, customer and customer. The seed initializes memberships for newly created shared accounts. It preserves passwords, active status, existing roles and deliberately removed memberships on subsequent runs. The password comes from the configured seed environment.

The operational commerce suite creates independent test identities in the disposable PostgreSQL database. They exercise tenant-specific ownership, administration, management, verified and unverified customers, foreign membership and missing membership. Checkout customers receive owned shipping and billing addresses. Tests log in through the normal API, and the regular development seed does not create these identities.

## Store coverage

| Store | Catalog | Variants | Warehouse coverage |
| --- | --- | --- | --- |
| Luma | Cotton shirt, denim, sneakers | Two sizes per product, each with media | Kuwait and Saudi Arabia |
| Noura | Cotton shirt, denim, sneakers | Two sizes per product, each with media | Saudi Arabia |
| Toota | Play blocks, picture book, play ball | One default variant per product | Egypt |
| Dar | Vase, cushion, lamp | One default variant per product | UAE |
| Velo | Training mat, resistance band, bottle | One default variant per product | Kuwait |
| Sera | Cleanser, moisturizer, lip balm | One default variant per product | Saudi Arabia |

Fresh stores receive a logo, cover, domain categories, two gallery views per product, and desktop and mobile banner assets. All have documented prices, tax categories and inventory spanning normal, low and zero stock. Stable technical keys such as `tee`, `denim` and `shoes` remain in IDs and paths for compatibility with previously seeded data. Product names, descriptions and category names give these keys their store-specific meaning on a fresh seed. Legacy default variants and existing business fields are preserved.

The four additional stores use original, small geometric placeholder illustrations. The files are local development artwork, not production product photography. Names are store-prefixed within the existing immutable media directory so the server's static-path allowlist stays unchanged.

## Reseed ownership

| Field | Reseed behavior |
| --- | --- |
| Tenant ID, slug and code | Stable identity. Conflicting ownership aborts. |
| Storefront name, logo, cover, listing, timezone and legal values | Defaults on creation. Existing values and cleared artwork are preserved. |
| Category, brand, product and variant fields | Initialize bundled fixtures. Existing merchant-edited fields, status and media stay in place. The previously established compatibility rule can repair known fixture-only galleries and normalize an exact bundled legacy URL. |
| Account password, status and tenant permissions | Existing account and membership rows are preserved. Memberships removed from existing shared accounts are not recreated. |
| Warehouse and inventory | Reuse compatible warehouse and stock identities. Initialize missing stock. Existing quantities, reservations and movements are preserved. |

Run regressions with `npm run test:postgres` against the dedicated test container. Never point the runner at development or production. For candidate HTTP smoke, set `POSTMAN_TEST_ARTIFACT_DIR` to the verified local candidate directory and target `tests/postman/collection.integration.test.ts`.

## Historical refund upgrade verification

With the dedicated `postgres-test` container healthy and `TEST_DATABASE_URL` set only for the process to its loopback test endpoint, run `./node_modules/.bin/tsx scripts/verify-refund-upgrade.ts`. The script verifies the PostgreSQL cluster identity, installs the 26 historical migration files in runner-owned databases, inserts fixtures using parameterized PostgreSQL queries, and applies the four November 24 migrations in sequence. It checks compatible financial data, selected preflight rejections, final Prisma drift, and cleanup on success or failure. It does not write migration history or make provider calls.
