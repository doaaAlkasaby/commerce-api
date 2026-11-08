# Phase 8.3 — Postman collection synchronization and verification

## Canonical files and scope

The existing collection is updated in place:

- `postman/commerce-api.postman_collection.json` — the single canonical collection, Postman v2.1.
- `postman/commerce-api.local.postman_environment.json` — sanitized Kuwait-fashion development environment.
- `postman/commerce-api.independent.postman_environment.json` — sanitized independent-store environment, with that tenant's fixture IDs.
- `postman/route-inventory.json` — generated source inventory with methods, paths, access, success statuses, source and validation-schema references.
- `postman/schema/collection-v2.1.schema.json` — official schema downloaded for repeatable local validation; formatted without semantic changes.

Current source, rather than OpenAPI or older phase reports, defines the collection.
The inventory follows all mounts in src/routes/index.ts, named/default imports,
router-level middleware, all route validation locations, the provider router and
operational router mounted directly by src/app.ts. Controller-only validation is
explicitly mapped for tenant/warehouse management, order policy and image uploads.
Source discovery rejects unresolved paths/router mounts instead of silently dropping them.
A regression also independently counts the runtime Express route tree.

There are **180 explicit API/ops/provider method-path endpoints** and **200 unique
collection requests**. The extra 20 are all 18 checked-in local WebPs and the two
existing Swagger UI/JSON entrypoints. The runtime tree contains 181 explicit routes:
the 180 API/ops/provider routes plus docs.json; Swagger UI and both static media
mounts are middleware. Arbitrary uploaded filenames, Swagger's own assets and
Express's implicit HEAD/OPTIONS behavior are infrastructure, not invented API CRUD.

All 136 original request names remain and are updated; **64 requests were added,
0 removed, 0 duplicates**. Additions comprise 44 previously absent explicit endpoints,
18 media requests and two documentation requests. No old saved responses or custom
scripts were present, so no useful captured examples were discarded. Existing folder
names/order remain; newly discovered modules are appended.

## Initial defects and corrections

The old generator recognized only default router imports and per-route authenticate.
It missed named routers (including tenants, coupons, app settings and reviews), new
storefront/warehouse/policy mounts, provider/ops mounts, and router-level protection.
It remembered only the last validation location, dropping bodies when params/query
validation appeared later. Examples included the invalid registration password
`string`, unresolved single-brace path tokens, no tenant headers and an old baseUrl
that mixed origin with API prefix. It had no reusable token rotation/guard scripts.

The replacement generator records all validation locations, generates examples from
actual Zod input schemas, validates concrete examples/refinements, binds deterministic
fixture IDs, and writes formatting-stable JSON. Controller success statuses and
module business error codes are read from source; request descriptions include access,
headers, fields, success statuses, side effects and schema/source references. Inline
and provider-specific requirements are documented explicitly. No server response
examples or provider-success IDs were fabricated; saved response arrays remain empty.

Shipping configuration and tax services have no registered HTTP management router.
No carrier, shipping/tax CRUD, worker-control, payment-create or shipment-tracking API
was invented. Product and variant discount fields are documented in their actual
input schemas; coupons use their real management/validation endpoints. Existing
registered RBAC/verified-email test routes remain represented.

## Folders

Existing grouping is retained. Reviews use their actual `/products/...` paths within
the products folder; customer and merchant access is described per request.

| Folder                 | Requests |
| ---------------------- | -------- |
| health                 | 1        |
| ready                  | 1        |
| auth                   | 10       |
| users                  | 5        |
| categories             | 10       |
| brands                 | 9        |
| products               | 14       |
| product-images         | 7        |
| inventory              | 11       |
| cart                   | 5        |
| product-variants       | 4        |
| product-attributes     | 11       |
| product-variant-images | 6        |
| home                   | 1        |
| collections            | 9        |
| wishlist               | 4        |
| banners                | 6        |
| addresses              | 7        |
| payments               | 8        |
| checkout               | 3        |
| orders                 | 5        |
| devices                | 4        |
| notifications          | 4        |
| warehouses             | 5        |
| order-policy           | 2        |
| storefront             | 2        |
| countries              | 1        |
| coupons                | 6        |
| app-settings           | 6        |
| tenants                | 7        |
| ops                    | 3        |
| payment-providers      | 3        |
| local-media            | 18       |
| documentation          | 2        |

## URL, variables and credentials

baseUrl is a backend **origin**, e.g. http://localhost:3000, without a trailing slash.
apiPrefix defaults to `api/v1`, without leading/trailing slashes. Business requests
use `{{baseUrl}}/{{apiPrefix}}/...`; ops, docs and media intentionally do not use
apiPrefix. Changing API_PREFIX on the backend requires matching the environment.
Do not retain the old collection's baseUrl ending in /api/v1.

The two environment files provide deterministic IDs derived from the Phase 8.1/8.2
fixture namespace, not claimed captured server responses. They include tenantSlug,
secondTenantSlug, product/size/category/brand/image/attribute/collection/banner IDs,
warehouse/stock/address/coupon IDs, shippingMethodCode and currency. cartId/orderId/
paymentId/reviewId/deviceId/notificationId/idempotencyKey remain empty until needed.
referenceId is intentionally manual for inventory reservation lifecycle operations.
The independent environment has no second warehouse ID because that store has one source.

Credentials, email, access/refresh tokens, verification/reset/device tokens, provider
signature and ops token are empty environment placeholders. They are not populated
in collection variables. Fixture passwords must be supplied privately from the
approved local seed; no default or real password is committed. Postman environment
secret type is a display hint, not permission to export filled values. Do not export
or commit a working environment with credentials. Scripts never log secrets.

Set authProfile to `customer`, `owner` or `admin` before login/refresh. Login and refresh
capture their returned pair into that profile's environment keys only. A customer
login cannot overwrite ownerAccessToken/ownerRefreshToken. Refresh rotates the
selected pair, using a request-local activeRefreshToken; serialize refresh calls.
Authentication mutation requests use request-local activeAccessToken. Merchant
requests bind ownerAccessToken, global ADMIN operations use adminAccessToken, and
customer operations bind customerAccessToken. Tenant OWNER accounts in this seed
are globally CUSTOMER; they cannot use global-ADMIN tenant creation/user status APIs.

Logout clears the selected local profile pair after success. Logout-all revokes all
server sessions; clear other saved local profiles as appropriate. A refresh response
contains tokens without a User payload; scripts do not assume user is always present.
No automatic role promotion, membership reactivation or email bypass is included.

Select the other sanitized environment to switch stores and all related fixture IDs
together. Changing only tenantSlug while leaving the first store's IDs should produce
tenant-isolated 404s, not cross-store access. Browsing never sends a delivery country
header; tenant currency and explicit destination shipping remain authoritative.

For a future test/deployed target, duplicate an environment privately, change only
origin/prefix and deliberately supply that target's real resource IDs and credentials.
Do not execute mutation folders against production. Tests use runner-owned disposable
databases, never an existing merchant database.

## Default execution safety

Importing sends no requests. Every POST/PUT/PATCH/DELETE, verification GET and cart
request requires allowMutations=`true`; GET cart is guarded because it can create a
cart. Read-only POST previews are guarded conservatively too. Protected requests
without their selected token are skipped. A normal run can browse public catalog,
storefront, health, docs and media without creating orders or changing inventory.

Payment mutation requests and final checkout additionally require
allowPaymentMutations=`true`. Provider webhooks additionally require
allowProviderWebhook=`true`, exact actual sandbox payload IDs and a privately supplied
MyFatoorah-Signature. No signature is generated and no provider mutation was run here.
These variables are string booleans; default is `false`. Turn them back off after the
specific manual action. The guard uses the supported pre-request
[pm.execution.skipRequest API](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution/).
Use a current compatible Postman runner; do not run this collection in a runner
that lacks that method or remove the guards to make a run proceed.

Post-response scripts assert success status/envelope, media type and key checkout
fields, capture only unambiguous IDs, and keep token profiles separate. They do not
send additional requests. Error responses intentionally fail success assertions:
inspect the actual code and error envelope instead of treating an unexpected error
as a passing happy path. Ops probes/metrics use their actual non-business response
contracts; readiness can return 503, and metrics requires independent OPS_METRICS_TOKEN.

## Customer registration through checkout

1. Import the canonical collection and choose one sanitized local environment. Start
   the backend with its guarded development seed already applied. Run GET storefront,
   home, products and local-media first. Bootstrap captures the tenant currency.
2. Enable allowMutations only for intended actions. Supply private email/password.
   Register returns a User (201) without tokens, or login an existing seeded customer.
   Set authProfile=customer for login; retain the captured rotating token pair.
3. For a newly registered user, call POST storefront/enroll with tenant header and
   strict `{}`. It grants CUSTOMER only: 201 new / 200 already active. Blocked
   membership states remain blocked; verification is still required for checkout.
4. Obtain the verification token from the existing private development outbox and
   set verificationToken. Send GET auth/verify-email deliberately. The collection
   exposes no outbox or verification bypass. The seeded verified customer can skip
   this onboarding step because its fixture is already verified.
5. Create/select an owned address using public `country` naming and a complete optional
   coordinate pair. Successful address create captures shippingAddressId. Billing
   may use the existing billingAddressId, but when billingSameAsShipping=true omit it.
6. Add a seeded size with POST cart/items, remembering that POST is additive. Prefer
   PATCH quantity for deterministic repeats. GET cart captures cartId. Guest cart
   remains client-local; nothing automatically clears or merges it.
7. Send checkout/shipping-options and checkout/preview with shippingAddressId,
   billingSameAsShipping and shippingMethodCode. Previews reserve nothing. Inspect
   currency, decimal-string money and fulfillment metadata. Do not submit a warehouse.
8. For final checkout, explicitly enable the second payment mutation guard. Use the
   actual example `CASH_ON_DELIVERY` + `NONE` for local recording. Manually set a fresh
   UUID idempotencyKey once for a new purchase (Postman's {{$guid}} dynamic value can
   be generated/copied into that variable). Keep the literal key (not the unevaluated {{$guid}} expression) and payload for
   retries; no pre-request script regenerates it. A changed purchase needs a new key.
9. Checkout captures data.order.id and data.payment.id after 201/new or 200/replay.
   Read orders/my, order details and owned payment endpoints. Reset opt-ins afterward.
   Local NONE records COD/bank-transfer intent, not an actual card or transfer.

MyFatoorah remains Kuwait/KWD sandbox-only as configured by the backend. Hosted URL
is data.metadata.checkoutUrl. Initiation/verification use strict `{}`. Provider return
URLs are UX signals; verify through the backend. UNKNOWN outcomes need conservative
reconciliation. Order status and payment status are independent. No real payment,
provider certification or reconciliation mutation was executed during this phase.

## Multi-warehouse and merchant checks

Privately login a seeded owner using authProfile=owner, then use ownerAccessToken
for warehouse, inventory, policy, order and catalog administration. Read warehouses,
coverage, inventory filtered by warehouseId and order-policy before editing anything.
The default fashion IDs select Kuwait and the second source is Riyadh; independent
IDs refer to its separate Riyadh source. Create examples never make a new default
warehouse automatically. Adjust city/country/address/coordinates explicitly if
creating a Riyadh source instead of the Kuwait example.

A schema-compatible manual Riyadh create example is:

```json
{
  "code": "POSTMAN_RIYADH",
  "name": "Manual Riyadh warehouse",
  "countryCode": "SA",
  "city": "Riyadh",
  "address": "Development showroom, King Fahd Road",
  "latitude": 24.7136,
  "longitude": 46.6753,
  "isActive": true,
  "isDefault": false,
  "priority": 30
}
```

It is a request example, not a claimed created source. Domestic coverage is
`{"countries":["SA"]}`; intentional Kuwait-to-Saudi coverage replacement is
`{"countries":["KW","SA"]}` on the Kuwait source. No such changes run automatically.

Available stock is on-hand minus reserved. Singular inventory-by-variant resolves
the default warehouse; list/by-ID access other rows. One order uses one eligible
source, and aggregate stock across warehouses is not a fulfillment guarantee.
Coverage PUT replaces the full list (domestic `KW` or `SA`; explicitly add `SA` to
Kuwait only for an intended cross-border test). Physical country alone grants none.
Stock, coverage and policy edits affect preview/checkout and may be blocked while
reservations/unresolved orders exist. Never run those mutation folders wholesale.
The PATCH policy example documents all five limits as decimal strings/integers;
null removes a limit, omitted fields stay unchanged. No script resets seed quantities.

Tenant administration uses its path ID and real tenantManagement rules, not a body
selector or tenant header. A tenant ADMIN cannot promote ownership. Shipping/tax
configuration is deliberately not exposed as invented HTTP endpoints.

## Local images and Flutter networking

The local-media folder contains the exact eighteen WebPs discovered from
public/seed-media/{fashion,independent}. The 800px product full/detail illustrations
also back category and size media; identity supplies brand/storefront logos, and
both desktop/mobile banners have dedicated files. Requests use backend origin plus
`/uploads/development-v82/...`, with no API prefix. Assertions require HTTP 200 and
image Content-Type; Postman may render the binary response directly.

Product detail variant images are represented by their own schema relationships.
The catalog is size-only; shared garment art does not claim distinct color images.
Relative media must be resolved against the backend origin in Flutter. Desktop
Postman can use localhost; Android emulator typically uses 10.0.2.2 or adb reverse,
iOS simulator can use host localhost, and devices need a reachable LAN origin.
Those are client/environment values, never database media hosts. Keep backend/LAN
reachable when internet uplink is disabled. The Phase 8.2 offline harness remains
available; this phase's HTTP smoke independently loads all local-media requests.
No new Flutter device rendering or container execution is claimed here.

## Generation and validation commands

```sh
npm run postman:generate
npm run postman:verify
npm run typecheck:postman
```

postman:verify validates against the official
[Postman Collection v2.1 schema](https://schema.getpostman.com/json/collection/v2.1.0/collection.json),
compares every explicit source route with its generated request, validates resolved
body/query/path examples against actual Zod schemas, checks public/protected/tenant
access, duplicate requests, variable references, script syntax, local WebP existence
and empty credential placeholders. The locked existing AJV installation supplies
draft-04 validation; no new dependency or external validation service is required.
Generation writes formatting-stable artifacts and does not access a database or
send HTTP requests. The order-policy schema import constructs its existing Prisma
client but makes no queries; application configuration must still be valid.

`npm run docs:generate` runs the existing Swagger generator then this canonical
Postman generator. Legacy generate-api-docs.ts/.js entrypoints delegate to that same
workflow. They cannot overwrite the collection with the obsolete implementation.
OpenAPI generation remains a separate artifact and is not certified as complete by
this Postman synchronization; docs/openapi.json was not modified by this phase.
The legacy generated declaration/maps are not used by the new entrypoints.

For safe collection-derived HTTP smoke with a disposable database:

```sh
TEST_DATABASE_URL='postgresql://LOCAL_TEST_USER@127.0.0.1:TEST_PORT/commerce_test' npm run test:postgres -- tests/postman
```

The runner creates/deletes only its UUID-named database and deploys all existing
migrations before test fixtures are seeded. The HTTP smoke itself executes GETs
only and asserts that it created no cart/order. It invokes response assertion
scripts in a small local VM using Chai; this is explicitly **not** Newman/Postman
sandbox certification. No Postman CLI/Newman binary was installed or available;
native collection execution/import remains unverified. Supported-schema validation
passed, which is the importability verification used for this phase.

## Actual verification results

| Check                                                         | Actual result                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Canonical collection / official Postman v2.1 schema           | Passed; 200 unique requests                                                                            |
| Source inventory / actual Zod bodies, query and path examples | Passed; all 180 explicit endpoints represented                                                         |
| Independent Express runtime tree count                        | Passed; 181 including docs.json                                                                        |
| Focused Postman regression file                               | **6 passed, 0 failed, 0 skipped**                                                                      |
| Collection-derived read-only HTTP smoke                       | **51 requests per tenant, 102 total**, with actual response assertion scripts; no carts/orders created |
| Repeated generation                                           | Passed; collection, both environments and route inventory are byte-identical                           |
| Full documented PostgreSQL suite                              | **982 passed, 0 failed, 0 skipped; 57 files**                                                          |
| `npm run typecheck:postman`                                   | Passed, strict configuration                                                                           |
| `npm run typecheck` / `npm run build`                         | Passed                                                                                                 |
| `npm run ci:quality`                                          | Passed; zero new/modified-file lint or formatting findings                                             |
| `git diff --check`                                            | Passed                                                                                                 |
| Native Newman/Postman CLI                                     | Unavailable; not run, not claimed passed                                                               |

All database checks used newly created runner-owned disposable databases on the
owned isolated PostgreSQL cluster, port 55439, UTC. The runner deployed the 19
unchanged migrations and found no schema drift. It removed only its own UUID
verification databases. No existing database was migrated or reset.

The full suite includes all 976 inherited tests and the six new Postman cases.
Actual image bytes, public catalog, category/brand/detail/review/collection requests,
storefront, safe provider return routes, probes and docs were loaded through HTTP
for both selected tenant environments. Schema/contract checks cover protected and
mutating requests statically; no bulk payment/stock/policy mutation run occurred.

Replacing the obsolete generator also removed its existing lint/format debt.
Remaining inherited debt is **10 lint findings and 200 unformatted files**, down
from 45/203. No baseline file was altered and no lint suppression was added.

No backend business logic, endpoint, auth, tenant, schema, migration or response
contract changed in Phase 8.3. All pre-existing Phase 8.1/8.2 working edits were
preserved. No notes, todos or skills configuration was modified. No production
connection, deployment, commit or push occurred. Points 1–14 remain complete.

## Changed files

```text
postman/commerce-api.postman_collection.json
postman/commerce-api.local.postman_environment.json
postman/commerce-api.independent.postman_environment.json
postman/route-inventory.json
postman/schema/collection-v2.1.schema.json
scripts/postman/routes.ts
scripts/postman/contracts.ts
scripts/postman/generate.ts
scripts/postman/verify.ts
scripts/generate-api-docs.ts
scripts/generate-api-docs.js
package.json
tsconfig.postman.json
tests/postman/collection.integration.test.ts
docs/phase8.3-postman-collection.md
```

The official schema is vendored solely for validation, with its source URL retained
above. No dependency-version/lockfile changes, migrations, live secrets or filled environments
were introduced. Existing user changes in package.json remain.

## Limits and manual follow-up

Native Postman UI/CLI import/run is unexecuted; do a public-read-only folder run in
Postman before enabling mutations. Auth/merchant/payment mutations were validated
statically and through existing backend regressions, not executed wholesale as a
collection. Provider identifiers/signatures are manual sandbox inputs. Saved response
examples are intentionally empty until actual responses are captured privately.
Future routing syntax or inline validation changes may need the generator's explicit
maps updated; verification fails rather than silently accepting drift. The complete
current inventory is in postman/route-inventory.json. Phase 8.3 does not close the
previous phase's outstanding rendered Flutter/device or Docker verification.
