# Phase 8.2 — Visual seed data and Flutter UI readiness

## Scope and media architecture

This phase extends the guarded Phase 8.1 development dataset. No schema, migration,
business endpoint, authentication, response shape, money, warehouse allocation or
order-policy change is introduced. This mandatory offline update supersedes the
earlier absolute-URL and container-exclusion guidance. The controller/service/repository architecture remains intact.
User notes, todos, skills configuration and existing Phase 8.1 work are preserved.

Existing models provide all required fields:

| Model               | Existing media contract                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| ProductImage        | Required storageKey/url, nullable altText, sortOrder, isPrimary; product relationship |
| ProductVariantImage | Same media fields, related to a size variant                                          |
| Category            | imageStorageKey/imageUrl, parent/children hierarchy, tenant ownership                 |
| Brand               | imageStorageKey/imageUrl; API calls the logo field **imageUrl**                       |
| Tenant              | logoStorageKey/logoUrl; storefront exposes logoUrl and existing display name          |
| Banner              | Desktop/mobile image pairs, active/time bounds, ordering and collection targets       |
| ProductCollection   | Tenant-owned featured collection, image pair, ordered product links                   |

The existing `/uploads/development-v82` prefix now has a narrow immutable static
mount backed by project-owned `public/seed-media`, before the ordinary writable
`/uploads` mount. It is independent of UPLOAD_DIR and exposes only WebPs in the two
store directories. SVG sources, README, dotfiles and traversal attempts are not
served. Source and compiled code locate the bundle relative to import.meta.url.
No new business API or upload dependency is introduced. Ordinary merchant uploads
retain UPLOAD_BASE_URL behavior; fixture media stores stable root-relative paths.
Public settings retain their existing whitelist; public theme colors are unsupported
and were not invented. Store names remain the established development names.

Home already provides BEST_SELLERS, SPECIAL_OFFERS, NEW_ARRIVALS and FEATURED_PRODUCTS.
The seed supplies the tenant's `featured` collection and active collection-target
banner. New arrivals uses the existing published-product query. Best sellers and
special offers are not artificially populated with fake sales or price changes.
Banners support mobileImageUrl rather than a platform field; no platform field is
invented. Clients select mobileImageUrl on mobile, falling back to imageUrl.

## Assets, sources and coverage

All assets are checked in under `public/seed-media/{fashion,independent}`.
Original SVG illustrations and their WebP exports are CC0; see the bundle's README.
No external image request, retail hotlink, unauthorized logo, API key or runtime AI
service is used. Dune 81 Studio and Form 81 Studio are fictional development labels.
The safe fallback is deliberately illustrative, not claimed to be product photography.

Each store has three products: Cotton T-shirt, Straight denim and Everyday sneakers.
Each receives a primary full illustration and an ordered detail crop, with descriptive
alt text. Each of the twelve existing size variants gets its product's full view;
these are the same garments in different sizes, not invented color variants.
There are 12 product-image rows and 12 variant-image rows across both stores.

Each tenant retains its original Development collection root, with Clothing →
T-shirts/Jeans and a Footwear child. All five categories have images. Untouched
Phase 8.1 products move from the original generic root to the matching subcategory
and receive the tenant's fictional brand. Customized category/brand assignments are
preserved. Both storefronts receive logos where the tenant record is untouched and
has no prior logo. No private settings become public.

| Asset per tenant              | Dimensions | Use                                         |
| ----------------------------- | ---------- | ------------------------------------------- |
| Six product full/detail files | 800 × 800  | Product cards, galleries, sizes, categories |
| identity                      | 512 × 512  | Storefront, category root, fictional brand  |
| everyday-edit                 | 1200 × 600 | Desktop banner and featured collection      |
| everyday-edit-mobile          | 800 × 800  | Mobile banner                               |

The 18 WebP files are each under 100 KB; sources and exports together are under
400 KB. Sources remain editable. Raster exports were generated once with an
already-installed workspace tool; no dependency or lockfile was changed.
Local HTTP tests verify all 18 WebP files through the existing static mount. This
verifies local serving, not remote device connectivity or a deployed CDN.

## Repeatability and safety

All Phase 8.1 environment, loopback database, explicit-name approval, password and
migration guards remain. The CLI checks that bundled WebPs are present under the
project-owned public/seed-media directory before database writes. It never copies or writes media files.
There are no production storage writes, resets, migrations or deployment actions.

Visual IDs derive from the existing deterministic development namespace. Visual
writes remain in the original seed transaction. Tenant row locking serializes the
visual portion; ownership checks abort on foreign fixture identities. Existing
image, category, brand, collection and banner rows use empty upsert updates.
A scoped compatibility conversion recognizes known fixture IDs/storage keys whose
old absolute URL still names the exact bundled `/uploads/{storageKey}` object.
It changes only that URL to its equivalent relative path, preserving identity,
relationships, ordering, flags and alt text. Custom URLs naming another object are
not converted. No arbitrary tenant/merchant records are rewritten.
Existing custom product-image sets are left alone. Missing fixture galleries are
restored when the product contains only known fixture IDs; edited fixture images
retain their URL, text, order and primary flag. Existing custom variant-image sets
are also left alone, and merchant-created variants do not acquire fixture images.

An untouched old generic product may receive its category/brand once. The conditional
write requires its original category, no brand and unchanged createdAt/updatedAt.
Edited products are preserved. Empty tenant/category logos are similarly filled
only on untouched records. Existing featured collections owned by a merchant take
precedence; fixture banners are not attached to them.

A deliberately deleted fixture row may be recreated on a later seed run. Existing
edited visual content is never refreshed. Bundled fixture paths no longer depend
on UPLOAD_BASE_URL or a developer host; clients can change backend origin without
reseeding. The limited legacy URL conversion above changes origin resolution,
not the selected image content. Intentional
branding removal is best represented by an edited retained row, rather than expecting
the seed to infer intent from a missing record. Verification flags missing primary
coverage for review without repairing customized records.

The local storage service treats `development-v82/` as immutable bundled artwork.
Removing/replacing an image reference does not delete a shared checked-in source.
Ordinary uploaded files retain their established deletion behavior. These are public
assets: cross-tenant API isolation does not mean image URLs are private or secret.

Passwords, memberships, stock, reservations, tax/shipping profiles, coupons, policies
and merchant-edited settings retain Phase 8.1's existing behavior. The established
operational HTTP suite continues to exercise actual checkout and policy boundaries.

## Commands

Run from `commerce-api`. First create/approve your own empty local development
PostgreSQL database; these commands do not create one or provision database users.
For an existing database, follow Phase 8's staged warehouse mapping prerequisite.

```sh
export NODE_ENV=development
export DATABASE_URL='postgresql://LOCAL_USER@127.0.0.1:5432/commerce_dev'
export ALLOW_DEVELOPMENT_SEED=true
export DEVELOPMENT_SEED_DATABASE=commerce_dev
export DEVELOPMENT_SEED_PASSWORD="$(openssl rand -base64 32)Aa1!"
export UPLOAD_DIR=./uploads
npm run db:migrate:deploy
npm run typecheck:seed
npm run db:seed
npm run db:seed
npm run db:seed:verify
npm run dev
```

Keep the generated development password privately; changing it on rerun does not
reset existing passwords. No media copy or UPLOAD_BASE_URL override is required for
these fixtures, even when UPLOAD_DIR points elsewhere. Keep public/seed-media beside
src/dist when packaging a plain Node build. npm run build compiles code in place;
the checked-in public directory remains available to npm start.

The Dockerfile copies the bundled directory into /app/public/seed-media, separate
from /app/uploads, so a writable upload volume does not mask it. The build context
allows only the two directories' WebP files. No image build/push/deployment or
production volume modification was performed; the Docker daemon was unavailable
for container execution. Compiled Node runtime serving was verified directly.

For test seeding, explicitly configure TEST_DATABASE_URL and approve its exact name,
then use `db:seed:test-data` and `db:seed:verify -- --test`; there is no DATABASE_URL
fallback. For disposable verification:

```sh
TEST_DATABASE_URL='postgresql://LOCAL_TEST_USER@127.0.0.1:TEST_PORT/commerce_test' npm run db:verify:seed
TEST_DATABASE_URL='postgresql://LOCAL_TEST_USER@127.0.0.1:TEST_PORT/commerce_test' npm run test:postgres
```

These runners create and remove their own UUID-named disposable databases. The seed
CLI now reports visual coverage alongside the unchanged warehouse summary.

## API examples and Flutter rendering

Send `X-Tenant-Slug: dev81-kuwait-fashion` or `dev81-independent`. Existing success
and error envelopes remain. Examples below are selected fields, not new DTOs;
IDs are illustrative placeholders. Fixture paths are relative to the configured backend origin.

```json
{
  "success": true,
  "message": null,
  "data": {
    "slug": "dev81-kuwait-fashion",
    "name": "Development Kuwait Fashion",
    "logoUrl": "/uploads/development-v82/fashion/identity.webp",
    "currency": "KWD"
  }
}
```

GET `/api/v1/products` item excerpt:

```json
{
  "name": "Cotton T-shirt",
  "primaryImage": {
    "id": "image-uuid",
    "url": "/uploads/development-v82/fashion/tee-front.webp",
    "altText": "Cotton T-shirt, full view (development illustration)"
  }
}
```

GET `/api/v1/products/:id` gallery excerpt:

```json
{
  "images": [
    {
      "url": "/uploads/development-v82/fashion/tee-front.webp",
      "sortOrder": 0,
      "isPrimary": true
    },
    {
      "url": "/uploads/development-v82/fashion/tee-detail.webp",
      "sortOrder": 1,
      "isPrimary": false
    }
  ]
}
```

GET `/api/v1/home?platform=mobile` uses banners[].imageUrl/mobileImageUrl,
categories[].imageUrl, brands[].imageUrl and sections[].products[].image. Product
lists use primaryImage.url; product details and variants use images[].url.
Category and brand APIs retain imageUrl. Storefront alone uses logoUrl.
Featured products and banner targets refer only to the selected tenant's catalog.
No endpoint, request, response field, HTTP status/error, authentication or tenant
semantics changed. **Breaking business API changes: NO.** Seed URL strings now intentionally contain
root-relative paths. Flutter must resolve media references against its backend
origin; existing custom/merchant absolute URLs continue to work. JSON fields and
nullable/image relationships are unchanged.

Use Image.network (or an existing cached image widget) for WebP, constrained aspect
ratios, loading placeholders, errorBuilder fallback and accessible semantic labels.
Production products can still have primaryImage=null, images=[], category/brand
imageUrl=null and storefront logoUrl=null. Handle each without assuming seed coverage.
Do not infer variant availability or shipping feasibility from a displayed picture.

Resolve a media reference before handing it to Image.network:

```dart
Uri resolveMedia(String reference, Uri backendOrigin) =>
    backendOrigin.resolve(reference);
// backendOrigin: scheme + reachable backend host + port, not a country/store URL.
// A leading /uploads/... resolves from the host root even with /api/v1 elsewhere.
final imageUri = resolveMedia(variant.images.first.url, backendOrigin);
```

Use the selected variant's own images when present; this seed models size-only
variants with the same garment, not distinct colors. Do not silently replace a
provided variant image with a product image. A missing variant image may use an
explicit UI fallback according to the client's design. The API tests select each
size variant and resolve its actual image relationship; no Flutter repository or
emulator/device session was available for a rendered Flutter test.

Configure only the Flutter backend origin for the environment:

| Client                    | Typical local backend origin                                          |
| ------------------------- | --------------------------------------------------------------------- |
| Android emulator          | http://10.0.2.2:3000, or localhost with adb reverse tcp:3000 tcp:3000 |
| iOS simulator on the host | http://localhost:3000                                                 |
| Physical device           | Host computer's reachable LAN address and API port                    |

These are client configuration examples, never database values. The backend must
listen on an interface reachable from the device, and the firewall must allow the
local port. Phone and host need local connectivity even without internet. Use
Flutter debug-only local HTTP allowances as required; production should use HTTPS.
Test offline by disabling WAN/uplink while retaining LAN, request storefront/catalog,
then open every returned media path and select each size. Restart the backend and
repeat. Actual physical device/emulator display and LAN/firewall behavior remain a
local integration check, not a claim made from backend-only tests.

The automated macOS harness runs the compiled backend inside a child-process OS
sandbox that denies all external network traffic while permitting loopback only.
It first asserts an external socket is rejected with EPERM, then loads all 18
WebPs on each of two fresh backend starts with an unrelated writable upload root:

```sh
npm run build
node scripts/verify-seed-media-offline.mjs
```

The profile is scripts/seed-media-offline.sb. It does not change host networking or
require stopping Wi-Fi. Other platforms can use a loopback-only network namespace;
the normal API tests remain portable and do not depend on this macOS harness.

## Verification results

All database checks used newly created disposable databases on the previously owned
isolated temporary PostgreSQL cluster, port 55439, with UTC server time. The runner
deployed all 19 migrations and found no schema drift. No existing database was
reset, migrated or deleted; only runner-owned UUID databases were removed.

| Check                                         | Actual result                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Full `npm run test:postgres`                  | **976 passed, 0 failed, 0 skipped; 56 files**                                                                               |
| Operational HTTP/seed/email suites            | **37 passed**, including 17 visual cases; included in full run                                                              |
| Existing commerce regressions                 | All 959 inherited tests remain passing, including checkout Points 1–14, inventory, MyFatoorah, tenant/security and recovery |
| `npm run db:verify:seed`                      | Passed: fresh deployment/drift check, both seed entrypoints on the same owned target, then read-only verification           |
| `npm run typecheck`                           | Passed                                                                                                                      |
| `npm run typecheck:seed`                      | Passed                                                                                                                      |
| `npm run build`                               | Passed                                                                                                                      |
| Prisma validate / `npm run db:generate`       | Passed; client 7.10.1                                                                                                       |
| `npm run ci:quality`                          | Passed; zero new/modified-file lint or format findings                                                                      |
| Offline compiled backend / OS network sandbox | Passed: external access denied; all 18 WebPs served on two process starts                                                   |
| `git diff --check`                            | Passed                                                                                                                      |

Seed verification reported three products, six product images, five categories,
one brand and one banner per store after both entrypoints. The inventory summary
remained two/one warehouses and twelve/six stock rows. Tests exercised all eighteen
WebP paths through actual HTTP, API serialization, repeatability, partial gallery
repair, edited image preservation, missing-media fallbacks and cross-tenant lookups.
The existing operational tests also exercised real checkout, reservations, policies
and source selection with the extended dataset.

The focused updated visual suite passed all 17 cases, including relative API paths,
all-entity media retrieval, traversal refusal, process restarts and legacy fixture URL
conversion. The offline compiled-backend harness passed: 18 images returned 200
with image/webp after each of two process starts, with external networking denied. No assertions were weakened, tests
removed/skipped or existing timeouts increased. Existing baseline debt remains **45 lint
findings and 203 unformatted files**; it was not rebaselined or suppressed.

No schema, migration, dependency version or lockfile changed in Phase 8.2. Points
1–14 remain complete. No commit, push, deployment or production data change occurred.

## Changed file manifest

Phase 8.2 adds or modifies only:

```text
prisma/development/seed.ts
prisma/development/cli.ts
prisma/development/visuals.ts
prisma/development/normalize-visual-paths.ts
src/app.ts
src/common/storage/development-media.ts
Dockerfile
.dockerignore
scripts/verify-seed-media-offline.mjs
scripts/seed-media-offline.sb
src/common/storage/local-storage.service.ts
tests/operational/visual-seed.integration.test.ts
public/seed-media/README.md
public/seed-media/fashion/*.{svg,webp}
public/seed-media/independent/*.{svg,webp}
docs/phase8.2-visual-seed-data.md
```

The working tree also contains the preceding Phase 8.1 implementation, which was
preserved. No notes, todos or skills files were changed. No commit or push was made.

## Remaining limitations

The assets are development illustrations, not real merchant photography. Real
product media, trademark clearance, production hosting/CDN, device connectivity,
shipping/tax/provider/email certification and deployment remain operational work.
Bundled media has no external asset dependency. No remote-host accessibility or live provider certification is claimed. Public theme
colors and extra configurable Home section types are unsupported by the current
contracts and were not introduced. Edited seed records may intentionally differ
from the pristine coverage counts; inspect verification diagnostics rather than
resetting merchant data.

Backend implementation and automated offline verification are complete. Final Phase
8.2 sign-off remains pending the requested Flutter variant-selection check on an
emulator/device: this workspace contains no Flutter project and no device session
was available. Container execution was also not verified because the Docker daemon
was unavailable. Neither limitation is reported as a passed check.
