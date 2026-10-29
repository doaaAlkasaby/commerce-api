# Checkout tax policy and calculation

The existing engine supports tenant/destination TaxProfiles, category-based
STANDARD/EXEMPT/ZERO_RATED treatment, inclusive or exclusive merchandise pricing,
and one selected TaxRule per line. ProductVariant.taxCategoryId overrides
Product.taxCategoryId, which overrides the selected profile's default category.
An unused default is not required when an explicit category is configured.
No new tax subsystem, provider, currency conversion or schema migration is added.

## Amounts and order totals

All money uses the existing two-decimal Decimal/integer-cent convention. Tax
rates are exact integer basis points parsed from Decimal text; supported rates
are 0 through 100 percent, with at most two decimal places. There is no monetary
JavaScript Number arithmetic in tax calculation, allocation or rate snapshots.

- Exclusive: tax = round_half_up(discounted net cents * basis points / 10000).
  Gross = net + tax. A net price of 100.00 at 10 percent gives 10.00 tax and 110.00
  gross, before shipping.
- Inclusive: tax = round_half_up(discounted gross cents * basis points /
  (10000 + basis points)). Net = gross - tax. Gross is preserved: 110.00 at
  10 percent contains 10.00 tax and 100.00 net. Included tax is reported, never
  added to the payable amount a second time.
- EXEMPT and ZERO_RATED both yield zero tax while retaining their distinct
  treatment and configured rule/rate for reporting. Prices are not repriced when
  a category becomes exempt. Even these categories require a matching active
  rule; absence of configuration does not silently mean exemption.

OrderItem.totalPrice remains the product/variant-discounted merchandise line
before the coupon; it includes tax only in inclusive pricing mode. Order.subtotal
is the sum of those catalog-price line totals. Order.discountAmount is the coupon
amount. OrderItem.taxableAmount is the post-coupon net base; taxAmount is the actual
rounded line tax. Order.taxAmount is exactly the sum of persisted line taxes.

Exclusive total = subtotal - coupon discount + shipping + line taxes.
Inclusive total = subtotal - coupon discount + shipping.
Payment amount/currency exactly match the resulting persisted order.

Each line rounds half-up once after all merchandise and coupon discounts; tax
sums are not rounded again. Two 0.05 exclusive lines at 10 percent therefore have
0.01 tax each, giving 0.02 order tax. This is intentionally line rounding, rather
than rounding 10 percent of the combined 0.10 base to 0.01. Inclusive extraction
uses the same policy, including one-cent and 100-percent-rate boundaries.
Checkout rejects values exceeding the existing Decimal(12,2) monetary columns
before order creation; no numeric truncation or silent overflow is permitted.

## Discounts and allocation

Variant override prices and existing product/variant discount rules apply before
tax. Their discount rounding and selection policies are unchanged. Coupon
eligibility, maximum discounts and global/per-user concurrency protection remain
unchanged. Fixed and percentage coupon totals are still capped at merchandise
subtotal.

An order-level coupon is allocated proportionally to product-discounted line
amounts using integer floor shares, then remaining cents go to the largest
fractional remainders. Ties use ascending variant ID. Zero-priced lines receive no
discount, each allocation is bounded by its line amount, and shares sum exactly
to the coupon total. This fixes the old last-line remainder rule, which could
assign a negative taxable base to a small/zero last line. Different-rate and
exempt lines participate proportionally; tax is then computed independently.

Thresholds retain the existing discounted catalog-price subtotal convention:
coupon minimums use merchandise before the coupon; shipping minimums use
merchandise after the coupon, before adding any exclusive tax/shipping. In
inclusive mode those catalog prices are gross. No conversion of existing coupon
or shipping thresholds into a newly invented net-price policy is performed.
Existing historical orders are not recalculated using this allocation policy.

## Profile and rule matching

Tax location comes from the persisted customer shipping address, not arbitrary
body/header country, region or tax-rate values. Country matches the configured
Country.code referenced by that address. Region/state comparisons trim whitespace
and ignore case, without rewriting saved addresses. City/postal code are preserved
in address snapshots but are not tax selectors in the current model. Billing
address does not determine tax in this checkout.

An active exact-region profile wins over an active country-wide profile. More
than one active profile at the selected normalized scope returns
TAX_PROFILE_AMBIGUOUS rather than choosing arbitrary currency/inclusion settings.
The profile currency must equal server-controlled Tenant.defaultCurrency.

Rule matching is scoped to the current tenant's selected category and saved
country. Rules must be active, effectiveFrom <= the checkout tax time (or null),
and effectiveTo > that time (or null). Exact normalized region wins over the
country fallback, preserving the existing specificity policy. Within that scope:

1. Higher priority first.
2. Latest effectiveFrom first, with unbounded/null starts last.
3. Ascending rule ID as the final stable tie-breaker.

Exactly one rule applies; overlapping alternatives never stack. Invalid date
intervals cannot match these filters. Inactive selected categories fail rather
than silently falling back. Foreign categories/rules cannot be used, even if
misconfigured database references point to them. Missing profiles, rules or
categories return controlled configuration/business errors; they do not imply
zero tax. Invalid stored rates return INVALID_TAX_RATE.

## Transaction and audit snapshots

Checkout creates a transaction-scoped TaxRepository and a per-checkout resolution
cache, never a process-global cache. The profile and each category/rule are
resolved once using one checkout tax time. Post-coupon tax uses that selected
calculation context without fetching potentially changed rules a second time.
New checkout attempts resolve fresh configuration. Idempotent replays use stored
order values and do not invoke the tax engine or require current rules to exist.

Existing line snapshots preserve category/rule IDs, category code, treatment,
exact rate, net base and tax amount. The existing order taxProfileSnapshot JSON
now also captures selected profile identity/settings, matching-rule region,
priority/effective dates, calculation time, rounding policy and allocation policy.
No new columns or historical backfill is needed. Stored totals/snapshots survive
profile/rule edits or deletions. Old orders are not silently corrected or populated
with today's configuration.

Tax failures roll back the existing checkout transaction: no order, payment,
reservation, coupon use, cart clearing or completed idempotency record remains.
Currency remains tenant-controlled. Inventory, payment/order transitions and
checkout idempotency semantics are unchanged.

## Unsupported policies and remaining boundaries

There is no shipping tax category/taxability flag: shipping is currently untaxed.
No shipping-tax regime was invented. Customer-specific exemption certificates,
compound/stacked taxes, city/postcode tax rules, alternative tax scope regimes,
FX, or currency-specific minor-unit rounding are not implemented. Exemptions are
category-based only. isTaxRegistered and taxRegistrationNumber are stored metadata;
the existing engine does not derive a legal collection policy from those fields.
Jurisdiction-specific tax compliance remains configuration/business policy.

Unrelated schema drift, remaining project typecheck/build errors, the local-only
NONE payment adapter, absent real provider/webhooks and expiration worker, and
unknown-payment reconciliation limitations are not fixed by this task.
