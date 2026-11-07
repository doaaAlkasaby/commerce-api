# Phase 8: warehouse fulfillment and tenant order policies

## Architecture and compatibility

`Warehouse` is tenant-owned. `Inventory` remains the only stock model, but is now
unique by warehouse/variant rather than variant alone. Its existing `quantity`
field means on-hand units; available stock is `quantity - reservedQuantity`.
There is no aggregate inventory table and no split fulfillment.

`WarehouseCoverage` explicitly authorizes destination countries. A warehouse's
physical country does not authorize or prohibit cross-border delivery. Existing
tenant shipping profiles, zones, methods and rules provide the rate/coverage
calculation; distance uses the warehouse coordinates and the actual owned address.
Distance is Haversine distance, not a road-distance or carrier promise.

New orders retain `warehouseId` and `fulfillmentSnapshot`. Legacy orders may retain
null source metadata; migration does not invent historical fulfillment facts.
Inventory transactions retain their original IDs and inventory references. Sale
and release look up the original reservation, constrained by the order's warehouse
when known. Ambiguous legacy reservations fail conservatively.

Catalog browsing requires an active tenant, not a browsing-country header. The
unused commerce-country gate is removed from commerce routes: existing callers
may still send `X-Country-Code`, but it does not authorize delivery or override
currency. Address country and explicit shipping configuration remain authoritative.

Authentication, verified-email requirements, ownership checks, error envelopes,
checkout idempotency keys, payment verification and worker lease/fencing rules
remain in place. Checkout additionally requires active tenant membership, both
through HTTP middleware and direct service calls. This is an intentional Phase 8
policy change; provision customer memberships before purchasing.

All money remains in `Tenant.defaultCurrency`. No FX, provider expansion, workers,
subscription billing, app publishing or deployment is introduced by this phase.

## Allocation and transaction policy

1. Find active sources owned by the resolved tenant with explicit destination coverage.
2. Require each source to hold enough available stock for every cart variant.
3. Calculate an eligible shipping method/rate through the shared shipping service.
4. Rank by lower warehouse priority, then lower shipping amount, then warehouse code.
5. Choose exactly one source. Default designation is not an allocation preference.

`NO_ELIGIBLE_FULFILLMENT_WAREHOUSE` is the 409 error for no qualifying source or
insufficient combined-source feasibility. Established single-source errors such as
`INSUFFICIENT_STOCK` and shipping validation errors remain available for compatibility.

Preview runs in the existing PostgreSQL read-only repeatable-read transaction.
It does not lock/reserve inventory or consume coupons. Options and preview are estimates.

Checkout retains its scoped idempotency lock and coupon locks. Tenant/source locks
coordinate configuration changes, and conditional stock updates reserve only the
selected inventory records. Concurrent stock loss rolls the transaction back; a
client may refresh preview and start a new attempt. It never creates a partial order.

Warehouse identity on an inventory record is immutable. Database checks prevent
negative on-hand/reserved/available quantities and tenant-mismatched variant stock.
Reservation increases require an active source. Warehouse management rejects
deactivation, relocation or coverage changes with reservations/unresolved orders.
Legacy orders with unknown sources are handled conservatively. Deletion is not exposed.

## New APIs

Paths below use `/api/v1`; deployed `API_PREFIX` still applies. Tenant-owned APIs
resolve `X-Tenant-Slug`; body tenant IDs are never authoritative.

### Public bootstrap

`GET /storefront`, public with `X-Tenant-Slug`, returns:

```json
{
  "success": true,
  "message": null,
  "data": {
    "id": "tenant-id",
    "slug": "store-slug",
    "name": "Store name",
    "logoUrl": null,
    "currency": "tenant ISO currency",
    "timezone": "configured timezone",
    "settings": {}
  }
}
```

Settings use the existing public whitelist. Memberships, operational configuration,
credentials and private settings are not returned. Shared apps enter a slug;
dedicated apps configure one. Both send the same tenant header.

### Warehouse management

All require authentication, active membership and OWNER/ADMIN/MANAGER role.

| Method | Path                       | Contract                                                |
| ------ | -------------------------- | ------------------------------------------------------- |
| GET    | `/warehouses`              | Tenant warehouse array                                  |
| GET    | `/warehouses/:id`          | Tenant warehouse or 404                                 |
| POST   | `/warehouses`              | Create, 201                                             |
| PATCH  | `/warehouses/:id`          | Partial update, 200                                     |
| PUT    | `/warehouses/:id/coverage` | `{countries: string[]}`, replaces explicit destinations |

Create requires `code`, `name`, `countryCode`, `city`, `address`. Optional fields:
`description`, `region`, `latitude`, `longitude`, `isActive`, `isDefault`, `priority`.
Coordinates must be supplied/cleared as a pair. Countries must be active catalog
entries. Codes are unique within a tenant; lower priority is preferred. Defaults:
active true, default false, priority zero, nullable fields null.

Warehouse DTOs include those fields, `id`, `tenantId`, `countries`, and timestamps.
Coverage writes return `{warehouseId, countries}`. Relevant failures include
`WAREHOUSE_NOT_FOUND`, `WAREHOUSE_CONFLICT`, `WAREHOUSE_IN_USE`,
`WAREHOUSE_DEFAULT_INACTIVE`, `WAREHOUSE_COORDINATES_INCOMPLETE`, and
`COUNTRY_NOT_SUPPORTED`.

### Tenant order policy

`GET /order-policy` and `PATCH /order-policy` require the same tenant staff roles.

Fields are nullable: `minOrderAmount`, `maxOrderAmount` (decimal strings),
`maxOrderItems`, `maxDistinctItems`, `maxQuantityPerItem` (positive integers).
Omitted PATCH fields remain unchanged; null removes a limit. With no policy, all
limits are null. Existing cart/request quantity limits still apply.

GET/PATCH return the fields plus authoritative `currency`. A client cannot set currency.
Minimum/maximum amounts apply after product/coupon discounts and exclude shipping
and tax, including tax already included in catalog prices. Quantity checks apply
on cart add/update; all checks apply to preview and final checkout.

Errors: `ORDER_MIN_AMOUNT_NOT_MET`, `ORDER_MAX_AMOUNT_EXCEEDED`,
`ORDER_MAX_ITEMS_EXCEEDED`, `ORDER_MAX_DISTINCT_ITEMS_EXCEEDED`,
`ORDER_MAX_QUANTITY_PER_ITEM_EXCEEDED`, and `ORDER_POLICY_INVALID_RANGE`.

### Shipping options

`POST /checkout/shipping-options` requires tenant, authentication, active membership
and verified email. It accepts the same strict body as preview:
`shippingAddressId`, optional `billingSameAsShipping`, `billingAddressId`,
`shippingMethodCode`, `couponCode`. Billing consistency validation is unchanged.

Response data is `{estimated: true, options: [...]}`. Each option contains
`methodCode`, `methodName`, `currency`, `amount`, `distanceKm`,
`fulfillment: {warehouseId, warehouseCode}`, and `totalAmount`.
Each method uses the same read-only calculation/allocation path as preview.
Final checkout always recalculates and may choose another eligible warehouse.

## Existing API additions

- Inventory create accepts optional `warehouseId`; omission resolves the active
  default warehouse. Configure that source first. No second legacy inventory pool
  is created. Inventory DTOs add `warehouseId`; list accepts a warehouse filter.
- `GET /inventory/variant/:variantId` retains its singular shape and resolves the
  default warehouse. Other rows are accessible through list/by-ID APIs.
- Product detail's existing singular inventory summary represents one active
  source with maximum per-variant availability, not combined stock or delivery proof.
- Address requests/responses add nullable coordinate pairs. Country input is
  normalized and checked against active countries. Existing `country` naming stays.
- Preview adds `fulfillment`; order creation/history add `warehouseId` and
  `fulfillmentSnapshot`. Existing money, items, shipping and payment fields remain.
- Existing checkout request fields and 201/new versus 200/replay semantics remain.
  Use `shippingMethodCode` for shipping selection; the legacy `shippingMethodId`
  compatibility field is not promoted into a new selection contract here.

Shipping now requires all configured zone constraints, honors disabled/FREE rules,
and tries eligible methods in configured order instead of failing on the first
ineligible default method. A coordinate-free rule can serve as a fallback.

## Migration and operations

New forward-only migrations:

1. `20261107170000_tenant_warehouses`
2. `20261107180000_warehouse_inventory`
3. `20261107190000_tenant_order_policy`

All three are transactional. The 16 historical migration files are unchanged.
No db push, reset, production migration or existing-database deletion was performed.

For an empty database, deploy the migration history normally. For an existing
database containing inventory, stage deployment: apply the warehouse migration,
configure a real active default source for every tenant with stock, review that
mapping, then apply the inventory migration. Its preflight aborts without changing
stock if a mapping is missing. Do not invent source addresses or blindly mark a
failed deployment resolved. Configure explicit coverage and matching tenant-currency
shipping profiles/rates before enabling purchasing.

The migration regression test exercises rollback without mapping, then preservation
of inventory IDs, quantities, original reservations and historical monetary values.

Before production, verify physical stock/source mapping, shipping configuration,
actual carrier coverage, coordinates, provider behavior and deployed worker health.
The existing recovery implementation exhibits timezone-dependent behavior on a
non-UTC PostgreSQL server; verification here uses UTC. This phase does not claim
that pre-existing limitation is fixed. Validate UTC operation before release.
Legacy development seed scripts were not executed or certified by this phase.

## Flutter integration

1. Resolve the configured/entered slug through `/storefront`; display tenant currency.
2. Browse the tenant catalog independently of physical/browsing country.
3. Authenticate and ensure active membership and verified email before checkout.
4. Save/select an owned address, including coordinates where distance rules need them.
5. Obtain shipping options and preview; keep the cart when changing addresses.
6. Submit checkout with the selected method code and a persisted idempotency key.
7. Treat warehouse/preview data as estimates until order creation succeeds.
8. Continue existing payment initiation, backend verification and order-history flows.

Do not sum warehouse availability as proof of whole-cart feasibility, convert money
using country currency, infer payment success from a browser return, or reuse a
committed idempotency key for a changed purchase.

## Verification results

- Full documented PostgreSQL suite: **937 passed, 0 failed, 0 skipped**, 53 files.
- The 32 new tests cover warehouse management, allocation, shipping correctness,
  order-policy boundaries, migration rollback/data preservation and API contracts.
- Existing checkout Points 1–14, MyFatoorah, inventory concurrency, payment and
  recovery regressions are included. All 47 recovery cases additionally assert
  that a second warehouse remains untouched after becoming the default source.
- Typecheck and production build passed. Prisma 7.10.1 validate/generate passed.
- All 19 migrations deployed to a fresh disposable database; no schema drift.
- `ci:quality` passed: zero lint/format findings in new or modified files.
  Existing baseline debt remains 45 lint findings and 204 unformatted files.
- `git diff --check` passed. User notes, todo files and skills lock are unchanged.
- Verification used an isolated PostgreSQL cluster under `/tmp`, on port 55438,
  with UTC server time. Only disposable verification databases/schemas were removed.
  No existing database, production service, commit, push or deployment was changed.

The initial configured test server on localhost:5433 was unavailable. A first run
on a temporary server inheriting Cairo timezone produced 902 passes and three
pre-existing recovery timeouts. The recovery suite passed under UTC without
changing its timeout values or skipping tests. The final full result above uses UTC.

## Changed files

The implementation and fixture changes are confined to:

```text
docs/phase8-warehouses.md
prisma/migrations/20261107170000_tenant_warehouses/migration.sql
prisma/migrations/20261107180000_warehouse_inventory/migration.sql
prisma/migrations/20261107190000_tenant_order_policy/migration.sql
prisma/schema.prisma
src/common/shipping/shipping.repository.ts
src/common/shipping/shipping.service.ts
src/common/shipping/shipping.types.ts
src/modules/addresses/address.controller.ts
src/modules/addresses/address.mapper.ts
src/modules/addresses/address.repository.ts
src/modules/addresses/address.schemas.ts
src/modules/addresses/address.service.ts
src/modules/addresses/address.types.ts
src/modules/cart/cart.service.ts
src/modules/checkout/checkout.controller.ts
src/modules/checkout/checkout.mapper.ts
src/modules/checkout/checkout.repository.ts
src/modules/checkout/checkout.routes.ts
src/modules/checkout/checkout.service.ts
src/modules/checkout/checkout.types.ts
src/modules/inventory/inventory.controller.ts
src/modules/inventory/inventory.mapper.ts
src/modules/inventory/inventory.repository.ts
src/modules/inventory/inventory.schemas.ts
src/modules/inventory/inventory.service.ts
src/modules/inventory/inventory.types.ts
src/modules/orders/order.mapper.ts
src/modules/orders/order.types.ts
src/modules/payments/payment.service.ts
src/modules/products/product.mapper.ts
src/modules/products/product.repository.ts
src/modules/tenants/storefront.routes.ts
src/modules/tenants/storefront.service.ts
src/modules/warehouses/allocation.repository.ts
src/modules/warehouses/allocation.service.ts
src/modules/warehouses/order-policy.repository.ts
src/modules/warehouses/order-policy.routes.ts
src/modules/warehouses/order-policy.service.ts
src/modules/warehouses/warehouse.controller.ts
src/modules/warehouses/warehouse.repository.ts
src/modules/warehouses/warehouse.routes.ts
src/modules/warehouses/warehouse.schemas.ts
src/modules/warehouses/warehouse.service.ts
src/routes/index.ts
tests/checkout/checkout.transaction.integration.test.ts
tests/checkout/coupon.concurrency.integration.test.ts
tests/helpers/catalog.ts
tests/helpers/warehouse.ts
tests/inventory/inventory.concurrency.integration.test.ts
tests/inventory/inventory.repository.test.ts
tests/inventory/inventory.reservation-lifecycle.integration.test.ts
tests/payments/myfatoorah.integration.test.ts
tests/readiness/phase1.api.test.ts
tests/recovery/recovery.integration.test.ts
tests/security/security.integration.test.ts
tests/tenant/tenant-isolation.integration.test.ts
tests/warehouses/fulfillment.integration.test.ts
tests/warehouses/migration.integration.test.ts
tests/warehouses/warehouses.integration.test.ts
```
