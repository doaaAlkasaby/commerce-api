# Phase 8.1 — Operational readiness and Flutter integration

## Scope and compatibility

This report supersedes Phase 8's timezone and seed limitations.
Phase 8's tenant-owned warehouse inventory and single-source allocation remain.
There are no schema changes, new migrations, payment gateways, deployment actions,
or changes to the 19 existing migration files. Existing API paths, registration
responses, authentication, verified-email gates, ownership and tenant roles remain.
The additive customer endpoint is `POST /api/v1/storefront/enroll`.

The preview `taxBreakdown[].taxRate` defect is corrected: basis points are converted
to a percentage independently of currency precision. A 15% rate is `"15"` in KWD
as well as two-decimal currencies; field names/types and monetary calculations remain.

## 1. PostgreSQL timezone root cause and correction

This was a functional conversion defect, not evidence of application/database
clock drift. The installed `@prisma/adapter-pg` 7.10.1 timestamp parser replaces
a `timestamptz` offset with `+00:00` without shifting the wall time. A Cairo clock
result could therefore become two hours ahead of the actual instant. Tests also
demonstrated offset loss when writing a Prisma `DateTime` into `timestamptz` in a
non-UTC session. The regression test compares an exact intended deadline with the
stored instant, independently of the session's displayed timezone.

Consequences included incorrect initiation age checks, disagreement with the SQL
staleness predicate, and recursive reinspection when no state transition occurred.
Reservation deadlines could also be stored at the wrong instant. Two stale-payment
fixtures implicitly cast session-local clock values into UTC-naive timestamps.

Targeted fixes:

- Recovery clock/deadline projections and claimed-job timestamp projections use
  `AT TIME ZONE 'UTC'` before crossing the affected adapter boundary.
- Checkout writes its deadline with an ISO string carrying an explicit offset,
  cast to `timestamptz`, inside the original order transaction.
- Payment initiation gets a correctly projected database clock for `updatedAt`.
- Recovery rechecks the deadline with the same repository projection under its
  existing order/payment locks and fencing guard.
- A zero-row transition to UNKNOWN schedules a bounded retry instead of spinning.
- Rate-limit reset instants use the same safe projection.
- Stale-payment test writes explicitly express UTC-naive time, matching that
  column's existing contract. Test timeouts were not increased.

Native lease, eligibility, expiration and retry comparisons remain in PostgreSQL.
SKIP LOCKED claims, claim tokens, lock ordering, retries and conservative uncertain
payment handling remain. No server/pool timezone override was added to application
configuration, and no dependency files were patched.

Regression verification uses an isolated PostgreSQL server configured first as
`Africa/Cairo`, then as UTC. Tests assert the actual session timezone and exact
clock/deadline instants. UTC remains a sensible deployment convention for existing
naive timestamp metadata; it is not the workaround used to pass Cairo recovery.
Historically incorrect timestamps are not automatically rewritten. Review affected
production records before intervention, particularly uncertain payments.

Evidence: `src/modules/recovery/recovery.repository.ts`, `recovery.service.ts`,
`src/modules/checkout/checkout.repository.ts`, `checkout.service.ts`,
`src/modules/payments/payment.repository.ts`, and
`tests/recovery/recovery.integration.test.ts`.

## 2. Safe development seeding

Both supported entrypoints now use `prisma/development/seed.ts`:

| Command                            | Database selection                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `npm run db:seed`                  | `DATABASE_URL`                                                                 |
| `npm run db:seed:test-data`        | `TEST_DATABASE_URL`, with no fallback                                          |
| `npm run db:seed:verify`           | Read-only verification of `DATABASE_URL`                                       |
| `npm run db:seed:verify -- --test` | Read-only verification of `TEST_DATABASE_URL`                                  |
| `npm run typecheck:seed`           | Strict compilation of the supported seed workflow                              |
| `npm run db:verify:seed`           | Fresh disposable migration deployment, both seed entrypoints, and verification |

The real seed commands require all of:

- Explicit `NODE_ENV=development` or `test`; production is refused.
- A loopback PostgreSQL host and a database name containing a dev/test segment,
  with production-like names rejected.
- `ALLOW_DEVELOPMENT_SEED=true`.
- `DEVELOPMENT_SEED_DATABASE` matching the exact selected database name.
- A configured `DEVELOPMENT_SEED_PASSWORD` with 12–128 characters, uppercase,
  lowercase, digit and special character.
- The final Phase 8 migration successfully deployed.

The seed never creates/resets a database. Stable UUIDs derive from a dedicated
development namespace. Fixture creation is transactional; reruns do not reset stock,
reservations, passwords, policies, usage counters or edited settings. Namespace
collisions abort rather than attaching staff credentials to unrelated identities.
Unrelated tenants and private settings are preserved. No password is printed.
Changing the configured seed password does not reset an existing account's password.

For an already-created, explicitly local empty development database:

```sh
export NODE_ENV=development
export DATABASE_URL='postgresql://LOCAL_USER@127.0.0.1:5432/commerce_dev'
export ALLOW_DEVELOPMENT_SEED=true
export DEVELOPMENT_SEED_DATABASE=commerce_dev
export DEVELOPMENT_SEED_PASSWORD="$(openssl rand -base64 32)Aa1!"
npm run db:migrate:deploy
npm run typecheck:seed
npm run db:seed
npm run db:seed
npm run db:seed:verify
```

Keep the generated password privately for local login. Supply real local database
authentication separately; the example does not provision database credentials.
For test seeding select `TEST_DATABASE_URL`, set its exact approved name, and use
`db:seed:test-data` / `db:seed:verify -- --test` instead. Legacy `prisma/seeds/*`
helpers are not entrypoints for the current schema.

### Dataset

| Store                  | Currency | Sources                | Policy                                                    |
| ---------------------- | -------- | ---------------------- | --------------------------------------------------------- |
| `dev81-kuwait-fashion` | KWD      | Kuwait City and Riyadh | Merchandise 5–250; 20 units; 5 variants; 10 units/variant |
| `dev81-independent`    | SAR      | Separate Riyadh source | Merchandise 10–1000; same quantity limits                 |

There are six products, twelve size variants, three warehouses and eighteen stock
rows across the two stores. The fashion store has these initial quantities:

| SKU suffix   | Kuwait | Saudi |
| ------------ | ------ | ----- |
| `tee-small`  | 20     | 8     |
| `tee-medium` | 2      | 15    |
| `denim-30`   | 4      | 0     |
| `denim-32`   | 0      | 12    |
| `shoes-40`   | 0      | 0     |
| `shoes-41`   | 3      | 0     |

Full SKUs start `DEV81-fashion-`. A cart containing five medium T-shirts and three
size-30 denims has enough aggregate stock but cannot be fulfilled by one source.
The out-of-stock size-40 product remains published for global browsing.

Default coverage is explicit domestic coverage. Cross-border tests explicitly add
Saudi coverage to the Kuwait warehouse; warehouse country alone never authorizes it.
Configured local rates require distance within 80 km; standard rates allow 2000 km.
Fashion fees are KWD 1.250 / 3.750; independent-store fees SAR 15 / 35.
Prices are explicitly tax-exclusive. Sample rules use Kuwait 0% and Saudi 15%,
with all amounts denominated in the tenant currency. These are development fixtures,
not tax/legal advice or evidence of a carrier agreement. Coupon `DEV81SAVE10` is 10%.

Development accounts, all with the privately configured password:

| Email                                     | Tenant role          | Verified |
| ----------------------------------------- | -------------------- | -------- |
| `fashion-owner@dev81.example.test`        | Fashion OWNER        | Yes      |
| `fashion-manager@dev81.example.test`      | Fashion MANAGER      | Yes      |
| `fashion-customer@dev81.example.test`     | Fashion CUSTOMER     | Yes      |
| `fashion-unverified@dev81.example.test`   | Fashion CUSTOMER     | No       |
| `independent-owner@dev81.example.test`    | Independent OWNER    | Yes      |
| `independent-customer@dev81.example.test` | Independent CUSTOMER | Yes      |

Their global user role is CUSTOMER; tenant staff privileges come only from the
explicit fixture memberships. Accounts and memberships are not promoted/reactivated
on rerun. Customers have sample owned addresses. No fake successful payments/orders
are seeded; commerce tests create orders through the actual APIs.

## 3. Customer enrollment and development email

Registration remains a global identity operation with its existing 201 user response.
The customer signs in, then calls `POST /storefront/enroll` with the selected tenant
header and strict empty JSON `{}`. This creates CUSTOMER membership only. A new
membership returns 201; an existing active membership returns 200. Existing staff
roles remain unchanged, and inactive/invited/suspended/removed memberships are never
reactivated. Concurrent calls converge on the unique tenant/user membership.

The service rechecks/locks active tenant and active user records in its transaction.
Target user, tenant, status and role are never taken from the body. Existing active
stores are public storefronts in this model; no private/invite-only store policy is
invented. Store-specific restrictions must not be inferred from slug secrecy.

Flow: bootstrap → register/login → enroll → verify email → cart/checkout. Enrollment
does not bypass verification: preview, shipping options and checkout retain their
verified-email requirement. A global customer may join another active store, but
memberships, carts, merchant roles, stock and orders remain scoped independently.

For local email testing:

```sh
export EMAIL_DELIVERY_MODE=development_file
export EMAIL_DEVELOPMENT_OUTBOX_DIR=/tmp/commerce-api-development-mail
npm run dev
```

The service creates an owner-only outbox (0700) and UUID-named JSON files (0600).
The parent must exist in the system temporary directory. Symlink/public-upload
targets and unsafe permissions are refused. Verification records contain `type`,
`email`, `firstName`, `verificationToken`, and `createdAt`; reset records instead
contain `resetToken`. Inspect locally and send the token to the existing verification
API. No HTTP outbox endpoint, token logging, production credentials or fake external
delivery is introduced. Remove only your own development outbox when finished.

`disabled` remains the default and does not deliver email. Production refuses
`development_file`. A real production transport, frontend links, delivery monitoring
and associated credentials are still required. If delivery fails after registration,
the account may already exist: sign in and use resend rather than bypass verification.

## 4. Verified end-to-end scenarios

`tests/operational/commerce.e2e.test.ts` uses the seed and actual HTTP stack:

- Public bootstrap/catalog; new registration without role elevation; private-outbox
  verification; active enrollment; rotated refresh token; authorized checkout.
- Existing-user multi-store enrollment, concurrent duplicate enrollment, blocked
  membership states, inactive store rejection, isolated carts and staff permissions.
- Kuwait and Saudi source selection, exact currency/totals, source snapshots,
  reservations and idempotent order replay.
- Explicit Kuwait-to-Saudi coverage, source-based distance and standard-method fallback.
- Unsupported fulfillment with a valid test tax profile, preserving cart/stock and
  creating no order/payment/provider operation; aggregate-only stock rejection.
- Every quantity/amount policy, discounted merchandise, tax/shipping exclusion and
  currency precision. Tax-rate percentage metadata remains currency-independent.
- Authorized local NONE payment success/failure after changing the default source;
  only original source stock is consumed/released. Safe expiration and fenced replay.
- Merchant/customer isolation for warehouses, stock, orders, policy and private settings.
- Repeatable seed execution, preserved reservations/settings and namespace collision refusal.

Existing MyFatoorah and recovery suites continue to cover duplicate webhooks,
provider retries, UNKNOWN outcomes, late payment, lease theft and conservative
reservation handling. They use provider mocks/sandbox contracts, not live certification.

## 5. Operational configuration

- Apply migrations as a distinct release step before starting API or worker. Do not
  reset or db-push a production database. Phase 8's staged mapping prerequisite still
  applies to a database with pre-warehouse inventory.
- Never run development seed commands in production. `.env.example` documents
  opt-ins; production secrets and real environment files were not changed.
- HTTP does not start recovery. Run the separate `npm run worker` process after
  build/migration, or `npm run worker:dev` locally. Monitor it independently.
- Review `RESERVATION_TTL_SECONDS`, `WORKER_POLL_MS`, `WORKER_CONCURRENCY`,
  `WORKER_SCAN_BATCH`, `WORKER_LEASE_MS`, `WORKER_MAX_ATTEMPTS`, retry bounds and
  `WORKER_INITIATION_GRACE_MS`. Startup checks require two spare pool connections
  and lease/grace headroom beyond provider timeout. Preserve shutdown draining.
- `PAYMENT_PROVIDER=NONE` is the development local-payment mode. MyFatoorah requires
  its existing sandbox token/signature/callback/account configuration and KWD support.
  No new real credentials or live provider certification were introduced.
- Real shipping needs active destination profiles/zones/methods/rules in tenant
  currency, explicit source coverage, real source coordinates and sufficient stock.
  Haversine distance is not road distance, carrier serviceability or an ETA.
- `/api/v1/health` is liveness; `/api/v1/ready` checks database readiness.
  `/ops/live` and `/ops/ready` are minimal probes; metrics require the existing
  independent `OPS_METRICS_TOKEN`. Optional worker ops listener uses
  `WORKER_OPS_PORT` and `OPS_BIND_HOST`. Do not expose metrics/provider secrets publicly.
- `docker-compose.yml` provisions local databases only. `compose.verify.yml` and
  `docs/deployment-and-ci.md` describe container verification; no infrastructure
  was deployed as part of this implementation.

## 6. Flutter API contract

All paths below use the configured prefix, default `/api/v1`. JSON requests use
`Content-Type: application/json`. T = `X-Tenant-Slug`; A = `Authorization: Bearer …`;
M = active tenant membership; V = verified email. `X-Country-Code` is optional
UI context and does not select currency or authorize delivery.

Success is `{success:true,message:string|null,data:...}`. Business errors retain
`{success:false,message,code,data:null}`. Read `code`, not message text. UUIDs are
strings. Monetary JSON values are decimal strings, not floats and not assumed cents;
trailing zeros are not guaranteed. Use bootstrap currency, never country currency.

### Store selection and identity

| Method/path                      | Headers/access     | Request                               | Success / important errors                                                                                                                                             |
| -------------------------------- | ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/storefront`                | T; guest           | No body                               | 200 `{id,slug,name,logoUrl,currency,timezone,settings}`; only public settings. Missing/inactive tenant 401, unknown slug 404 `TENANT_NOT_FOUND`                        |
| POST `/auth/register`            | Guest              | `{email,password,firstName,lastName}` | 201 User; no tokens. 409 `EMAIL_ALREADY_EXISTS`; 400 validation. Role is server-owned                                                                                  |
| POST `/auth/login`               | Guest              | `{email,password}`                    | 200 `{accessToken,refreshToken,tokenType,expiresIn,user}`; 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_INACTIVE`                                                           |
| POST `/storefront/enroll`        | T/A; no V needed   | Strict `{}`                           | 201/new or 200/existing `{id,tenantId,userId,role,status}`. 403 `TENANT_MEMBERSHIP_INACTIVE`; invalid extra fields 400. Inactive store retains tenant middleware's 401 |
| POST `/auth/refresh`             | No bearer required | `{refreshToken}`                      | 200 rotated token pair, tokenType/expiresIn. 401 `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED`                                              |
| GET `/auth/verify-email`         | Public             | Query `token`; no body                | 200 acknowledgement/null data. Invalid/used/expired token errors are 400                                                                                               |
| POST `/auth/resend-verification` | Public             | `{email}`                             | 200 null acknowledgement without account enumeration                                                                                                                   |
| POST `/auth/logout`              | No bearer required | `{refreshToken}`                      | 200 null acknowledgement                                                                                                                                               |
| POST `/auth/logout-all`          | A                  | No body                               | 200 null acknowledgement                                                                                                                                               |
| GET `/users/me`                  | A                  | No body                               | 200 User                                                                                                                                                               |
| GET `/tenants/me`                | A                  | No body                               | 200 active memberships with safe tenant summaries                                                                                                                      |

User fields: `id,email,firstName,lastName,role,isActive,emailVerifiedAt,createdAt,updatedAt`.
User role is global; use membership role for store authorization. Registration does
not grant tenant staff authority. Persist selected slug separately from credentials.
Refresh JWT identity is global; send T again after refresh. `expiresIn` retains
the configured duration string (for example `15m`), not a numeric seconds contract. Serialize refresh calls
and securely replace the single-use refresh token before retrying queued requests.

### Catalog and cart

| Method/path                     | Access               | Request                                                                         | Success / important errors                                                                         |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET `/countries`                | Guest, no T required | No body                                                                         | Active global `{code,name,currencyCode}[]`; not tenant serviceability                              |
| GET `/home`                     | T; optional A        | Query `platform=mobile                                                          | web`                                                                                               | `{platform,banners,categories,sections,brands}` |
| GET `/products`                 | T; optional A        | Query `page,limit,search,categoryId,brandId,minPrice,maxPrice,sortBy,sortOrder` | `{items,pagination}`; published tenant products, globally visible                                  |
| GET `/products/:id`             | T; optional A        | UUID path                                                                       | Product details, pricing, images, attributes, variants, inventory summary; 404 `PRODUCT_NOT_FOUND` |
| GET `/cart`                     | T/A/M                | No body                                                                         | Cart; may create an empty cart                                                                     |
| POST `/cart/items`              | T/A/M                | `{variantId,quantity}`                                                          | Updated cart; adds to an existing quantity                                                         |
| PATCH `/cart/items/:variantId`  | T/A/M                | `{quantity}`                                                                    | Updated cart; sets absolute quantity                                                               |
| DELETE `/cart/items/:variantId` | T/A/M                | No body                                                                         | Updated cart                                                                                       |
| DELETE `/cart`                  | T/A/M                | No body                                                                         | Cleared cart                                                                                       |

Catalog pagination is `{page,limit,total,totalPages}`. List items include
`id,name,slug,description,status,basePrice,discountType,discountValue,discountStartsAt,
discountEndsAt,primaryImage,category,brand,rating,isInWishlist`.
Details include `pricing` and active-state-marked variants with attributes, images,
nullable price override and `inventory`. Per-variant stock is not a whole-cart promise.

Cart is `{id,userId,items,itemCount,subtotal,createdAt,updatedAt}`; `itemCount` means
total units. Currency comes from the selected storefront. Cart quantities are
integers 1–1000, further constrained by tenant policy. Important errors include
`VARIANT_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `PRODUCT_NOT_AVAILABLE`,
`VARIANT_NOT_AVAILABLE`, `INSUFFICIENT_INVENTORY`, and `ORDER_MAX_*`.
Missing/inactive membership uses existing 401 `UNAUTHORIZED` middleware semantics.
Guest carts remain local; no server guest/merge API is invented. Do not blindly
retry additive POSTs; read/reconcile after an ambiguous response.

### Addresses, shipping, preview and checkout

| Method/path                            | Access                     | Request                                                                        | Success                                           |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| POST `/addresses`                      | A                          | Required `firstName,lastName,addressLine1,city,country`; optional fields below | 201 owned Address                                 |
| GET `/addresses`                       | A                          | No body                                                                        | 200 owned Address array                           |
| GET/PATCH `/addresses/:id`             | A                          | UUID; PATCH editable address fields                                            | 200 owned Address                                 |
| DELETE `/addresses/:id`                | A                          | UUID                                                                           | 200 null                                          |
| POST `/addresses/:id/default-shipping` | A                          | UUID, no body                                                                  | 200 updated Address                               |
| POST `/addresses/:id/default-billing`  | A                          | UUID, no body                                                                  | 200 updated Address                               |
| POST `/checkout/shipping-options`      | T/A/M/V                    | Preview JSON below                                                             | 200 `{estimated:true,options:[...]}`              |
| POST `/checkout/preview`               | T/A/M/V                    | Preview JSON below                                                             | 200 authoritative estimate; no reservation        |
| POST `/checkout`                       | T/A/M/V; `Idempotency-Key` | Checkout JSON below                                                            | 201 new / 200 replay `{order,payment,idempotent}` |

Optional address fields: `label,company,addressLine2,state,postalCode,phone,
isDefaultShipping,isDefaultBilling,latitude,longitude`. Responses add ID/timestamps.
`country` remains the public name and is normalized/validated against active countries.
Coordinates may be absent; a stored pair must be complete. Addresses are owned by
the global user, not attached to a tenant. Another user's ID returns 404
`ADDRESS_NOT_FOUND`/`SHIPPING_ADDRESS_NOT_FOUND`. Country/coordinate failures use
`COUNTRY_NOT_SUPPORTED`, `DELIVERY_COORDINATES_INCOMPLETE` or validation errors.

Preview request:

```json
{
  "shippingAddressId": "owned-address-uuid",
  "billingSameAsShipping": true,
  "shippingMethodCode": "local",
  "couponCode": "DEV81SAVE10"
}
```

Only shippingAddressId is required. Omit optional method/coupon when unused.
When billingSameAsShipping is false, provide billingAddressId; when true, omit it.
The schema rejects client totals, payment fields, cart selectors and other extra fields.
Options use the same body; a method code filters the options when supplied.
Each option contains `methodCode,methodName,currency,amount,distanceKm,fulfillment,
totalAmount`. Fulfillment is `{warehouseId,warehouseCode}`.

Preview contains `estimated,currency,items,subtotal,productDiscount,couponDiscount,
shippingAmount,taxAmount,totalAmount,pricesIncludeTax,shipping,coupon,taxBreakdown,
warnings,fulfillment`. Item amounts and tax amounts are decimal strings; taxRate is
a percentage string. Coupon is nullable. Warnings explain that preview reserves nothing.

Checkout extends the preview options with required `paymentMethod`, optional
`paymentProvider`, legacy `shippingMethodId`, and compatibility `currency`. Currency
is server-controlled regardless of the submitted value. Use shippingMethodCode;
the legacy ID field remains compatibility input. Do not submit a warehouse selector.
Idempotency keys are 1–255 visible ASCII characters without spaces, scoped to tenant/user.
Retry the same attempt with the same key/payload; a changed purchase needs a new key.

Important failures: `EMAIL_NOT_VERIFIED` (403), `CART_EMPTY` (400), availability and
`INSUFFICIENT_STOCK` (409), `NO_ELIGIBLE_FULFILLMENT_WAREHOUSE` (409), shipping/country
and missing tax configuration errors, coupon validity/usage errors, `ORDER_MIN_AMOUNT_NOT_MET`,
`ORDER_MAX_AMOUNT_EXCEEDED`, quantity limits, and idempotency conflicts. Missing tax
configuration can be detected before warehouse allocation. Address changes do not
clear the cart; refresh options/preview before a new checkout attempt.

### Payments and order history

| Method/path                    | Access             | Request                                 | Success / limitations                                                                                    |
| ------------------------------ | ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| POST `/payments/:id/initiate`  | T/A, owned payment | Strict `{}`                             | 200 Payment; MyFatoorah hosted URL is `data.metadata.checkoutUrl`                                        |
| POST `/payments/:id/verify`    | T/A, owned payment | Strict `{}`                             | 200 backend-verified Payment for supported MyFatoorah reference; local NONE returns reconciliation error |
| GET `/payments/:id`            | T/A, owned payment | UUID                                    | 200 Payment                                                                                              |
| GET `/payments/order/:orderId` | T/A, owned order   | UUID                                    | 200 payment array                                                                                        |
| GET `/orders/my`               | T/A                | Query `page,limit,status,paymentStatus` | 200 `{items,pagination:{page,limit,totalItems,totalPages}}`                                              |
| GET `/orders/my/:id`           | T/A, owned order   | UUID                                    | 200 Order; wrong tenant/owner 404 `ORDER_NOT_FOUND`                                                      |

Payment fields: `id,initiationState,orderId,provider,method,status,amount,currency,
providerPaymentId,providerTransactionId,failureCode,failureMessage,metadata,createdAt,updatedAt`.
Order fields include `id,orderNumber,userId,status,paymentStatus,currency,subtotal,
discountAmount,shippingAmount,taxAmount,totalAmount,couponSnapshot,shippingProfileSnapshot,
taxProfileSnapshot,pricesIncludeTax,shippingMethodId,shippingMethodCode,shippingMethodName,
shippingRuleId,shippingDistanceKm,shippingAddress,billingAddress,items,payments,itemCount,
warehouseId,fulfillmentSnapshot,createdAt,updatedAt`. Checkout's
order/payment DTOs are smaller than the order-history/payment-detail DTOs; keep separate models.

NONE supports local COD/bank-transfer recording, not an actual transfer or card gateway.
MyFatoorah remains the existing Kuwait/KWD sandbox implementation. Enum values do
not imply configured wallet/provider support. Important errors include
`CARD_PAYMENT_NOT_CONFIGURED`, `DIGITAL_WALLET_PAYMENT_NOT_CONFIGURED`,
`PAYMENT_NOT_FOUND`, `PAYMENT_INITIATION_IN_PROGRESS`, `PAYMENT_RECONCILIATION_REQUIRED`,
and `PAYMENT_CONFIGURATION_MISMATCH`. UNKNOWN outcomes require conservative reconciliation;
closing a browser is not payment failure. Provider return URLs do not prove success.
Use backend verification/status and preserve pending states. Order status is independent
of payment status; no shipment/carrier tracking endpoint is introduced.

Source of truth: the auth/storefront/cart/address/checkout/payment/order routes,
schemas and mappers under `src/modules`, plus the HTTP integration tests above.

## 7. Verification results

All checks used isolated, newly created disposable PostgreSQL databases. The configured
local test service was not needed; a private temporary cluster used port 55439. No
existing database was reset, migrated or deleted. Only this run's disposable objects
were removed. The cluster was tested with native server timezone Africa/Cairo, then UTC.

| Check                                             | Actual result                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                               | Passed                                                                                                       |
| `npm run typecheck:seed`                          | Passed                                                                                                       |
| `npm run build`                                   | Passed                                                                                                       |
| Prisma validate / `npm run db:generate`           | Passed, client 7.10.1                                                                                        |
| Fresh migration deployment / drift                | All 19 passed; no difference detected                                                                        |
| `npm run db:verify:seed`                          | Passed: development seed, test seed against the same approved disposable target, then read-only verification |
| Full `npm run test:postgres`, UTC                 | **959 passed, 0 failed, 0 skipped; 55 files**                                                                |
| Recovery under UTC                                | **49 passed**, included in the full run                                                                      |
| Recovery and operational tests under Africa/Cairo | **69 passed, 0 failed, 0 skipped; 3 files**, including all 49 recovery tests                                 |
| `npm run ci:quality`                              | Passed; zero new/modified-file lint or formatting findings                                                   |
| `git diff --check`                                | Passed                                                                                                       |

The Cairo command was `npm run test:postgres -- tests/operational
tests/recovery/recovery.integration.test.ts`, with the isolated server set to
Africa/Cairo. The full command used that server after switching it to UTC.
Both commands received an explicit `TEST_DATABASE_URL` for the isolated cluster.
The runner creates its own UUID-named database and never falls back to DATABASE_URL.

The seed verification reported two stores, three warehouses and eighteen inventory
rows after both seed entrypoints. Test approval and a generated temporary development
password were supplied only to its owned disposable database; credentials were not logged.

There are **22 additional tests** over Phase 8's 937: twenty operational/email/seed/HTTP
cases and two explicit session-timezone regressions. Existing checkout Points 1–14,
MyFatoorah, inventory, authorization and recovery tests remain green. No tests were
removed or skipped, and recovery test timeouts were not raised.

Existing CI baseline debt remains 45 lint findings and 203 unformatted files; it was
not suppressed or rebaselined. No migration, schema, dependency-version or lockfile
change was required. No commit, push, deployment, live credential update or production
data change was performed. User notes/todo files and skills-lock.json are unchanged.

## 8. Remaining production work

- Integrate and operate a real production email transport and frontend verification/reset links.
- Verify real provider accounts, signatures, callbacks and reconciliation operations;
  mocked/local tests are not live payment certification.
- Review physical stock mapping, real shipping coverage, coordinates, tax registrations
  and rates; seed examples are not production settings.
- Review historical incorrectly offset timestamps before any manual repair. This
  phase changes forward logic, not historical production data.
- Keep dev credentials/outboxes out of production and do not reseed real merchant stores.
- Exercise actual API/worker deployment, readiness, private metrics, graceful shutdown,
  backups and restart recovery before production release. No deployment was performed here.

## 9. Changed file manifest

```text
.env.example
docs/phase8.1-operational-readiness.md
package.json
prisma/development/cli.ts
prisma/development/seed.ts
prisma/seed-test-data.ts
prisma/seed.ts
prisma/verify-development-seed.ts
scripts/test-postgres.ts
src/common/email/development-outbox.ts
src/common/email/email.service.instance.ts
src/common/email/email.service.ts
src/common/rate-limit/postgres-rate-store.ts
src/config/development-seed-options.ts
src/config/email-options.ts
src/config/env.ts
src/modules/checkout/checkout.repository.ts
src/modules/checkout/checkout.service.ts
src/modules/payments/payment.repository.ts
src/modules/recovery/recovery.repository.ts
src/modules/recovery/recovery.service.ts
src/modules/tenants/customer-enrollment.controller.ts
src/modules/tenants/customer-enrollment.repository.ts
src/modules/tenants/customer-enrollment.service.ts
src/modules/tenants/storefront.routes.ts
tests/operational/commerce.e2e.test.ts
tests/operational/development-safety.test.ts
tests/recovery/recovery.integration.test.ts
tsconfig.seed.json
```
