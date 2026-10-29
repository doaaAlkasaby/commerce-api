# Checkout preview API

`POST /api/v1/checkout/preview` returns current server-calculated estimates without
placing an order or holding stock/prices. It shares the same calculation function
as actual checkout, including discounts, coupon eligibility, shipping, tax,
precision limits and tenant currency resolution.

## Authentication and input

Send a valid Bearer access token and `X-Tenant-Slug`. The existing checkout rules
also require an active user with verified email. Preview uses the authenticated
user's cart in that tenant; cart/user/tenant selectors in the body are rejected.
Addresses are globally user-owned in the current schema, not tenant-owned: the
selected shipping/billing address must belong to the authenticated user and the
tenant must have applicable shipping/tax configuration for its destination.

```json
{
  "shippingAddressId": "<saved address UUID>",
  "billingSameAsShipping": true,
  "shippingMethodCode": "standard",
  "couponCode": "SAVE10"
}
```

Only shippingAddressId is required. billingSameAsShipping defaults to true; when
false, billingAddressId is required. When true, omit billingAddressId. Shipping
method code and coupon code are optional and trimmed. Coupon matching uses the
existing normalization. Shipping rules are selected by the server; preview does
not accept a rule ID or the legacy checkout shippingMethodId field, which is not
a calculator selector. Unknown fields (including currency, prices, taxes, totals,
distance, payment fields and identity/cart selectors) return a validation error.

No Idempotency-Key is needed. A supplied header is ignored by preview: it neither
creates/consumes a key nor replays an old order.

## Response

HTTP 200 uses the existing envelope. Example for two 20.00 merchandise units,
2.00 coupon discount, 3.00 shipping and exclusive 5 percent tax:

```json
{
  "success": true,
  "message": null,
  "data": {
    "estimated": true,
    "currency": "EGP",
    "items": [
      {
        "productId": "<product ID>",
        "variantId": "<variant ID>",
        "productName": "Example product",
        "sku": "SKU-1",
        "quantity": 2,
        "currency": "EGP",
        "unitPrice": "20",
        "itemDiscountAmount": "0",
        "finalUnitPrice": "20",
        "totalPrice": "40",
        "couponDiscount": "2"
      }
    ],
    "subtotal": "40",
    "productDiscount": "0",
    "couponDiscount": "2",
    "shippingAmount": "3",
    "taxAmount": "1.9",
    "totalAmount": "42.9",
    "pricesIncludeTax": false,
    "shipping": {
      "methodCode": "standard",
      "methodName": "Standard",
      "currency": "EGP",
      "amount": "3",
      "distanceKm": 48.14
    },
    "coupon": {
      "code": "SAVE10",
      "discountType": "FIXED_AMOUNT",
      "discountValue": "2",
      "currency": "EGP",
      "discountAmount": "2"
    },
    "taxBreakdown": [
      {
        "variantId": "<variant ID>",
        "currency": "EGP",
        "taxCategoryCode": "STANDARD",
        "taxTreatment": "STANDARD",
        "taxRate": "5",
        "pricesIncludeTax": false,
        "taxableAmount": "38",
        "taxAmount": "1.9"
      }
    ],
    "warnings": [
      "This is an estimate. Prices, availability and eligibility may change before checkout. No stock or price is reserved."
    ]
  }
}
```

Money and percentage rates are exact decimal strings using the existing checkout
serialization convention; trailing zeroes are not guaranteed. Rates such as "5"
mean 5 percent. Quantities and geographical distance are numbers, not monetary
amounts. itemDiscountAmount is per-unit merchandise discount; productDiscount is
the order-wide merchandise discount sum, accounting for quantities. subtotal and
line totalPrice are after merchandise discounts and before the coupon. Coupon
line allocations sum exactly to couponDiscount. Coupon is null if omitted.

Shipping amount/distance and rule eligibility use the existing server-origin
Haversine calculation and discounted merchandise thresholds. Tax breakdown uses
the same net bases, category treatment, proportional allocation, rate selection
and half-up line rounding as checkout. Inclusive tax is reported but not added a
second time. Currency always comes from Tenant.defaultCurrency; no FX exists.

## Read-only and concurrency guarantees

Calculation is separated from checkout persistence. Preview executes in an
explicit PostgreSQL READ ONLY, REPEATABLE READ transaction. Cart/catalog, coupon,
shipping and tax reads all use that transaction. It has one consistent MVCC data
snapshot even when configuration changes while it runs. It does not acquire
coupon FOR UPDATE locks, checkout advisory locks or stock write locks, and does
not serialize unrelated checkouts. Normal short read transactions/table access
locks still exist; no application business write occurs.

Preview never creates/modifies Order, OrderItem, Payment, CheckoutRequest,
CouponUsage, inventory counters/ledger, cart contents, or operational/payment
initiation states. There is no separate InventoryReservation model; the existing
inventory reservation counters/ledger are not changed. No provider is invoked.
Database read-only enforcement guards against future accidental writes.

Availability is checked, not reserved. Coupon usage is checked, not consumed.
Coupons are currently tenant-wide: no product/category applicability restrictions
exist in the model, so none are invented here. Shipping/tax unsupported policies
remain as documented in tax-calculation.md.

This is not an immutable quote. Prices, stock, coupon eligibility (including
expiry), tax effective dates, shipping rules or currency settings can change
before Place Order. Actual checkout recalculates current valid data and retains
its atomic stock reservation, coupon row locking and scoped idempotency behavior.
Preview does not alter any of those controls. The same inputs and unchanged
eligible state produce matching monetary values; a later preview always resolves
fresh state. If checkout clears the cart, another preview returns CART_EMPTY
rather than replaying that checkout, even with the old key header.

## Errors

Errors retain `{ "success": false, "message": "...", "code": "...", "data": null }`.
Existing authentication, verification and tenant errors apply. Examples include:

- VALIDATION_ERROR for unknown/invalid options or inconsistent billing selection.
- CART_EMPTY or CART_TENANT_MISMATCH.
- SHIPPING_ADDRESS_NOT_FOUND / BILLING_ADDRESS_NOT_FOUND for missing/foreign-owner
  addresses (without leaking another customer's data).
- PRODUCT_NOT_AVAILABLE / VARIANT_NOT_AVAILABLE / INSUFFICIENT_STOCK.
- COUPON_NOT_FOUND, COUPON_INACTIVE, COUPON_EXPIRED, COUPON_NOT_STARTED,
  COUPON_USAGE_LIMIT_REACHED, COUPON_USER_USAGE_LIMIT_REACHED, or minimum violation.
- SHIPPING_METHOD_NOT_AVAILABLE, SHIPPING_NOT_AVAILABLE, or existing coordinate
  validation errors.
- Existing controlled currency/tax configuration and monetary precision errors.

A failed preview also leaves no business writes. Internal database/provider
information is not returned. There is no provider operation to retry from preview.

## Flutter flow

1. Load the cart.
2. Select an owned saved address.
3. Select the shipping method code, and optionally a coupon.
4. Request preview without an idempotency key or client-calculated amounts.
5. Display the server's monetary strings/currency and informational warning.
6. User confirms Place Order.
7. Generate and persist one Idempotency-Key for that logical checkout attempt.
8. Submit actual checkout with the supported payment options.
9. Reuse the same key and intent for timeout/network retries; handle documented
   checkout in-progress/conflict responses.
10. Initiate the existing local payment separately when supported. Never treat a
    preview as an order or a payment session.

No Flutter code, gateway integration, price locking or preview reservation was
added. Existing build/typecheck errors, unrelated schema drift, local-only NONE
provider, missing real provider/webhooks/expiration worker, and unknown-outcome
reconciliation remain limitations.
