# Currency and money policy — Phase 3B

## Audit and scope

The prior monetary engine used exact BigInt cents, but assumed two fractional digits
in pricing, cart, checkout and coupon helpers, NUMERIC(12,2) storage and price schemas.
Shipping independently padded/truncated decimals to two digits. Tenant validation used
Intl's runtime currency list. MyFatoorah consequently rejected nonzero third decimals.
These assumptions are now replaced by explicit currency minor units and a versioned
catalog. Existing tax, inventory, transaction, checkout fingerprint and payment lifecycle
rules remain authoritative.

Inventory contains quantities, not monetary balances. Its product-price reads serialize
Decimal values without financial arithmetic. There is no separate refund amount/model
or refund calculator; MyFatoorah refund operations remain unsupported. Geographic distance,
ratings, pagination and display percentages use numbers but are not money calculations.
No FX, new checkout feature, endpoint or mandatory request field was introduced.

## Catalog and precision

`src/common/pricing/currency-catalog.ts` contains 165 codes with numeric minor-unit
metadata from [SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml),
published 2026-09-17, retrieved 2026-10-31. SIX is the ISO maintenance agency. Codes
with N.A. precision (including precious-metal/accounting placeholders) fail closed.
The catalog includes currency/fund codes with four fractional digits; support is not
limited to six hand-selected currencies. Provider availability is a separate policy.

| Examples           | Standard minor-unit digits |
| ------------------ | -------------------------- |
| JPY                | 0                          |
| USD, SAR, AED, EGP | 2                          |
| KWD, BHD           | 3                          |
| CLF, UYW           | 4                          |

`normalizeCurrency` trims/uppercases then checks metadata; `isCurrencyCode` retains its
strict uppercase predicate contract. Unknown codes never fall back to two decimals.
No locale formatting or shipping-country inference determines payment precision.

Four independent boundaries apply:

1. ISO standard precision determines valid catalog prices and final transaction amounts.
2. Intermediate money uses arbitrary-size BigInt minor units and exact integer ratios.
   The shared Decimal helper uses 96 significant digits; parsed intermediates permit
   fewer than 10^24 major units and at most 24 fractional digits. Division explicitly
   rounds HALF_UP to at most 24 fractional digits. Final money has the lower limits below.
3. MyFatoorah Kuwait sandbox currently accepts only positive KWD with at most three
   fractional digits, formatted in major units with three digits. Other currencies
   remain available to local NONE flows, not automatically to this provider.
4. Display/serialization uses currency digits in calculated cart/pricing strings.
   Existing Prisma-backed DTOs retain their existing Decimal.toString() conventions
   (trailing zeros may be omitted). Existing monetary JSON fields remain decimal strings.

The `Money` value object checks currency compatibility for addition/subtraction/comparison.
Multiplication/division return intermediate decimal strings; `quantize` explicitly rounds
calculated results. Price/final validation rejects nonzero excess digits instead of rounding.
Examples: KWD 12.345 and 12.34 are valid; USD 12.345 and JPY 1234.56 are invalid.
Trailing zero padding adds no precision: USD 12.3400 is exactly representable.
Exponent notation, non-finite values and ambiguous separators are rejected.

Compatibility helper names `toCents`/`centsToString` remain available; they now accept an
explicit currency and mean minor units. Their two-decimal default serves existing helper
callers/tests. Production monetary calculation paths supply the tenant/order currency.
Tax-rate serialization is deliberately still basis points, not currency minor units.

## Storage and validation

The additive migration `20261101100000_currency_aware_money` widens 22 monetary columns
to NUMERIC(14,4). This preserves the historical ten major-unit digits while supporting
all 0–4 digit numeric metadata in the pinned catalog. It does not indiscriminately widen
rates, distances or coordinates. Tax rate columns remain NUMERIC(5,2); percentage discounts
remain constrained to positive rates no greater than 100, with at most two decimals.
Discount-value columns also store fixed amounts, so their storage scale must support four.

Affected columns: Product.basePrice/discountValue; ProductVariant.price/discountValue;
Coupon.discountValue/minimumOrderAmount/maximumDiscountAmount;
Order.subtotal/discountAmount/shippingAmount/taxAmount/totalAmount;
OrderItem.unitPrice/itemDiscountAmount/finalUnitPrice/totalPrice/taxableAmount/taxAmount;
Payment.amount; ShippingRule.minOrderAmount/maxOrderAmount/flatRate.

Final amounts are nonnegative and below 10,000,000,000 major units. The maximum is
9,999,999,999.9999 for four-digit currencies, 9,999,999,999.999 KWD,
9,999,999,999.99 USD and 9,999,999,999 JPY. MyFatoorah additionally rejects zero. These are local safety limits; actual account and
invoice limits still require live sandbox confirmation.
Catalog/variant/coupon write boundaries validate against the tenant currency before
persistence. Shipping inputs/thresholds are checked before calculation; checkout checks
all persisted totals and line snapshots before writing. Database NUMERIC rounding is
not an input-validation strategy. Direct SQL/seed writers must call the same policy;
PostgreSQL itself cannot infer a product's tenant currency via a simple CHECK constraint.

## Rounding, tax, coupons and shipping

The existing shared checkout calculation engine still serves preview and checkout.
Currency changes its unit, not its business policy:

- Product/variant percentage discounts round HALF_UP per unit, then multiply quantity.
  Fixed discounts are exact and capped at the unit price.
- Checkout percentage coupons truncate once at order level, preserving the prior checkout
  rule. Coupon validation now uses that same rule; previously its separate helper rounded
  HALF_UP and could disagree with checkout. Fixed coupons/caps are exact currency amounts.
- Coupon allocation retains Hamilton/largest-remainder allocation, with stable variant keys
  breaking equal remainders. Allocated amounts sum exactly to the order coupon discount.
- Taxes round HALF_UP per line after coupon allocation. Exclusive taxes add to the payable
  amount; inclusive taxes extract tax from the discounted gross line. Zero-rated/exempt
  behavior and existing shipping-tax treatment remain unchanged.
- Shipping thresholds use discounted merchandise before tax/shipping. Fees/thresholds are
  exact currency units; extra decimals are rejected, never truncated. Shipping profile
  currency must match the transaction currency. Geography changes delivery eligibility,
  never transaction currency or prices.

Thus payable = discounted merchandise + shipping + exclusive line taxes. Inclusive line
taxes are already inside merchandise and are not added twice. Stored tax totals sum the
line taxes. No order-level tax rerounding overrides line snapshots or hides residuals.

## Tenant, orders, payments and Flutter

Each tenant has one configured transaction currency. Catalog reads obtain it from the
persisted tenant relation; customer requests do not choose it. New amounts are validated
against it. Orders and payments snapshot currency and exact totals; later tenant setting
changes do not reprice historical orders or invalidate their idempotent checkout replay.
Payment initiation and verification use the stored order/payment currency and amount.

Changing a tenant currency is not FX conversion: existing catalog numbers are not
converted. Administrators must deliberately review/reprice catalog, fixed coupons and
shipping/tax profile configuration before accepting new checkouts. Nonrepresentable
amounts and mismatched profiles fail closed. No multi-currency cart/FX engine is included.

Existing API paths, HTTP methods, names, authentication, tenant headers, success/error
envelopes, statuses and major-unit string representation are preserved. No endpoints or
mandatory fields were added. Monetary validation still returns controlled 400 errors;
new precision/range codes describe newly supported currency boundaries. Existing valid
two-decimal inputs retain their meaning. Clients should treat decimal strings as decimals,
not multiply by 100 or force two display digits. No Flutter transport/schema change is
required; update any client-side two-decimal input/display restrictions to use KWD/JPY/etc.

MyFatoorah now sends and verifies exact third-fils KWD, including 0.001, without scaling.
Webhook signatures, lifecycle rules, reservations, UNKNOWN handling and reconciliation
remain intact. Provider HTTP is mocked in automated tests. Live credentials, account
currency/version confirmation and actual portal delivery remain unverified from Phase 3.
This phase does not claim live sandbox compatibility.

## Migration and local database procedure

No configured existing development, shared or production database was reset or modified.
The original 13 migration files remain unchanged. Migration 14 is forward-only and
preserves existing numeric values. Widening large tables can require locks: schedule and
review deployment separately; this task does not deploy production.

Verification commands:

```sh
npm run test:postgres
npx tsx scripts/verify-money-migration.ts
npm run db:verify
npm run typecheck
npm run build
npx prisma validate --config prisma7.config.ts
npm run db:generate
```

The existing test runner uses only TEST_DATABASE_URL as its connection template, creates
its own UUID test database, applies all migrations, compares drift, enables all hardening
flags, then removes only that generated database. The upgrade verifier similarly creates
its own database, deploys the original 13 migrations, seeds representative historical
catalog prices/order items/payment snapshots, deploys 14, compares values/timestamps and
migration checksums, verifies four-decimal storage and drift, then removes its database.

To switch local development safely: identify the local host/port/role first; create a
new uniquely named local database with CREATEDB using the local development administrator;
set DATABASE_URL for that new identity in the deployment command environment; run
`npm run db:migrate:deploy` and `npm run db:migrate:status`; seed explicitly if desired;
then update only the local application environment and restart it. Keep the old database
until the new one is verified. Never reuse a production/shared URL, reset an unknown target,
rewrite old migrations or use db push. No environment file was switched automatically.

### Prepared isolated local development database

A fresh, unseeded database was prepared on the verified local Docker container
`commerce-api-postgres-test` (PostgreSQL 17), using its local test role:

- Host/port: `localhost:5433`
- Database: `commerce_api_dev_phase3b_9925b7202e154aeeaa32590e15323c69`
- Role: `commerce_test_user` (use local Compose credentials; no credentials are stored here)
- Migrations: 14 applied; migration status up to date; schema diff empty.

It is retained for an optional local development switch. `.env` and existing databases
were not changed. Use this database name in a local DATABASE_URL with the local role's
credentials and `schema=public`, then restart the app. TEST_DATABASE_URL can remain its
existing template. This database resides in the local test container's volume; preserve
that volume if you choose to use it for development. It is never a production target.

## Adding/updating currency metadata

Download SIX List One from the linked primary source. Record its publication date and
retrieval date; review amendments and changes to existing codes/precision. Regenerate the
sorted code-to-numeric-minor-unit map, excluding N.A. entries. Review the diff and run the
money/provider/checkout/migration regressions. Changing historical currency precision needs
an explicit historical-order compatibility review; never reinterpret stored order money.
New 0–4 digit entries need no calculation rewrite. A future currency with greater scale
must fail closed pending storage/provider review and an additive migration.

## Verification and files

Phase 3B files (prior-phase and user edits are excluded):

- `src/common/shipping/shipping.service.ts`
- `src/common/pricing/currency-catalog.ts`
- `src/common/pricing/currency.ts`
- `src/common/pricing/money.repository.ts`
- `src/common/pricing/money.ts`
- `src/common/pricing/pricing.service.ts`
- `src/modules/home/home.mapper.ts`
- `src/modules/home/home.repository.ts`
- `src/modules/payments/payment.service.ts`
- `src/modules/payments/payment.schemas.ts`
- `src/modules/payments/providers/myfatoorah.provider.ts`
- `src/modules/products/product.repository.ts`
- `src/modules/products/product.schemas.ts`
- `src/modules/products/product.mapper.ts`
- `src/modules/product-variants/product-variant.repository.ts`
- `src/modules/product-variants/product-variant.schemas.ts`
- `src/modules/product-variants/product-variant.mapper.ts`
- `src/modules/product-variants/product-variant.service.ts`
- `src/modules/checkout/checkout.service.ts`
- `src/modules/coupons/coupon.schemas.ts`
- `src/modules/coupons/coupon.repository.ts`
- `src/modules/coupons/coupon.service.ts`
- `src/modules/cart/cart.mapper.ts`
- `src/modules/cart/cart.service.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20261101100000_currency_aware_money/migration.sql`
- `docs/production-database.md`
- `docs/myfatoorah-integration.md`
- `docs/currency-and-money-policy.md`
- `scripts/verify-money-migration.ts`
- `tests/pricing/money.test.ts`
- `tests/checkout/checkout.transaction.integration.test.ts`
- `tests/payments/myfatoorah.integration.test.ts`
- `tests/helpers/catalog.ts`
- `tests/products/product.service.test.ts`
- `docs/testing.md`

No commit, push, deployment or environment switch was performed. User todo files were
preserved. Live MyFatoorah sandbox validation remains a separate Phase 3 limitation.

### Final verification results

- Full PostgreSQL suite: **730 passed, 0 failed, 0 skipped**, 43 files.
- Baseline retained: 670 tests; **60 new** cases (41 money/validation unit cases,
  16 PostgreSQL checkout/catalog/coupon currency cases, 3 exact-fils gateway cases).
- Separate Points 1–14 / MyFatoorah regression: **452 passed, 0 failed, 0 skipped**, 6 files.
- Prisma validate/generate: PASS, Prisma Client 7.10.1.
- Fresh deployment: all 14 migrations applied; empty schema diff.
- Representative historical-schema upgrade: 13 -> 14 PASS; values, timestamps,
  order-item/payment JSON snapshots and original migration checksums preserved.
- Typecheck and production build: PASS. Strict targeted money/gateway/upgrade-script
  typecheck: PASS. Focused ESLint/Prettier and git diff --check: PASS.
- Original 13 migration SQL checksums unchanged. No tests removed or skipped; existing
  assertions retained. The old gateway precision test now rejects fourth decimals,
  while new tests explicitly verify third-decimal amounts end to end.
- Catalog fixtures now explicitly configure USD and the mocked product includes its
  tenant currency relation, matching actual repository reads.

API compatibility: no endpoint, method, field name/type, major-unit representation,
authentication/verified-email/tenant requirement, HTTP status convention or envelope
changed. No endpoints added. Existing valid two-decimal flows remain compatible;
newly invalid currency-specific precision is rejected with controlled validation errors.
Breaking changes: **NO**. Flutter transport changes: none; currency-aware input/display
is needed wherever a client previously forced two decimals.

**POINTS 1–14 REMAIN COMPLETE. PHASES 1, 1B AND 2 REMAIN COMPLETE.
PHASE 3 PAYMENT IMPLEMENTATION REMAINS INTACT.**
