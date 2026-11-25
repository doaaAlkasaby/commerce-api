# Special Orders requests and quotations

Enable the feature with a public tenant AppSetting named `special_orders`. Its JSON value is `{ "enabled": true, "instructionsAr": "...", "instructionsEn": "..." }`. Instructions are optional. The storefront exposes `settings.specialOrders`; an absent, private, or disabled setting prevents new submissions. Existing requests remain accessible.

All routes below are relative to `/api/v1/special-orders` and require a bearer token and the `X-Tenant-Slug` header. Customer routes require active CUSTOMER membership and scope records to the caller. Merchant routes require active OWNER, ADMIN, or MANAGER membership for the tenant.

| Method and path | Purpose |
| --- | --- |
| POST `/my` | Submit a request. Requires an `Idempotency-Key` header. |
| GET `/my` | List the customer's requests with `page` and `limit`. |
| GET `/my/:id` | Read customer request details and history. |
| PATCH `/my/:id` | Replace the item list for a NEW request or explicitly resubmit a QUOTED or ACCEPTED request. Include existing item IDs for items to retain, including their attachments. Dropped items and their attachments are removed. Omitted contact phone and notes are preserved. |
| POST `/my/:id/cancel` | Cancel a NEW, UNDER_REVIEW, QUOTED, or ACCEPTED request. |
| POST `/my/:id/attachments` | Add a file to a NEW request. Use multipart field `file` and optional text field `itemId`. |
| GET `/my/:id/attachments/:attachmentId` | Download an attachment owned by the customer on this request. |
| GET `/` | Merchant list with `page`, `limit`, `status`, and `search`. Search accepts a request number, name, phone, or product name. |
| GET `/:id` | Read merchant request details and history. |
| POST `/:id/review` | Move a NEW request to UNDER_REVIEW. |
| POST `/:id/reject` | Reject a NEW, UNDER_REVIEW, or QUOTED request with `{ "reason": "..." }`. |
| GET `/:id/attachments/:attachmentId` | Download an attachment belonging to this tenant and request. |

A JSON submission includes 1–20 `items`, optional `contactPhone`, and optional `notes`. Each item has `name`, integer `quantity`, and optional `specifications`, `productId`, and `variantId`. Use specifications for details such as brand, weight, volume, or concentration. A variant ID can supply the catalog product implicitly. If contact phone is omitted, the server looks for a valid phone on the customer's saved addresses, preferring defaults.

For an atomic multipart submission, put the same JSON in the text field `request`. Use file field `attachment` for request-level supporting files and `itemImage-0`, `itemImage-1`, and so on for zero-based item positions. A request can hold up to six files, each no larger than 3 MiB. Supported types are JPEG, PNG, GIF, and WebP, plus PDF for request-level attachments. File validation checks binary signatures and PDF cross-reference structure. Downloads are authorized individually, forced as attachments, and marked private and non-cacheable. Files stay in PostgreSQL and are never served from public uploads.

A matching submission replay returns HTTP 200 with the request's current representation. A reused key with different content returns 409. An initial submission returns 201. Edits update the same request number and retain only the latest submitted items and contact details. History keeps the latest 100 lightweight actions and status changes without copying request content. Request creation and rejection enqueue notifications through the existing notification worker.

## Merchant quotations

| Method and path | Purpose |
| --- | --- |
| PUT `/:id/quotation/draft` | Save a full draft for an UNDER_REVIEW or QUOTED request. To update an existing draft, supply its `draft: { quotationId, version }`. |
| GET `/:id/quotation` | Return `{ current, draft }`. Each can be null. |
| POST `/:id/quotation/publish` | Send the draft identified by `{ quotationId, version }`. Publishing a new draft replaces the previous unaccepted offer atomically. |
| GET `/:id/quotation/:quotationId/items/:itemId/image` | Download a private quotation image. |

A draft requires `sourcingDays` and `items`. The merchant can set `validityHours` from 1 to 720 (default 48), `notes`, `sourcingFee` as a nonnegative decimal string, `sourcingFeeDescription`, `sourcingFeeTaxCategoryId`, and `sourcingFeeIncludesTax`. The fee defaults to zero and is separate from product and shipping charges.

Each item has `type` (AVAILABLE or SUGGESTED), `name`, `offeredQuantity`, `unitPrice` as a decimal string, and `pricesIncludeTax`. Optional fields are `specifications`, `notes`, `productId`, `variantId`, `requestedItemId`, and `taxCategoryId`. Catalog and requested-item IDs are validated in this tenant and request. Each list can be empty when the other contains at least one product. The merchant can quote several options for the same original item. Original request items remain read-only for merchants.

Drafts accept JSON or multipart. For multipart, send the JSON as the text field `request` and add image files named `itemImage-0`, `itemImage-1`, and so on. The positions correspond to the combined input `items` array. To keep a previously uploaded image when saving, set `retainImageFromItemId` to the image-bearing item from the same request. The request attachment limits also apply to each quotation. Customers can download images only from their current published or accepted quotation.

The response includes `quotationId`, `requestId`, `tenantId`, `version`, `status`, `currency`, `taxCountryCode`, `sourcingDays`, `validityHours`, `notes`, `sourcingFee`, `sourcingFeeDescription`, `sourcingFeeTax`, `createdAt`, `publishedAt`, `expiresAt`, `availableProducts`, `suggestedProducts`, and `acceptance`. Product rows include an `id`, the quoted terms, `tax`, and `hasImage`. The response reports `EXPIRED` for a published quotation after its deadline. The merchant can publish a replacement while the request remains QUOTED.

Tax comes from the tenant's configured tax profile and rules for its default country. The category resolves from the merchant's explicit choice, the variant, the product, or the profile default. Each line and the fee can use inclusive or exclusive pricing. The tax snapshot exposes the effective `rateBasisPoints` (1400 means 14%), `treatment`, and category and rule identifiers. An exempt or zero-rated line uses a zero effective rate. The draft saves the resolved tax terms. Publication sets the validity deadline and freezes the offer. Destination validation belongs to Special Checkout.

## Customer selection and acceptance

| Method and path | Purpose |
| --- | --- |
| GET `/my/:id/quotation` | Read the current quotation and any acceptance snapshot. |
| POST `/my/:id/quotation/calculate` | Calculate a selection using authoritative quoted terms. |
| POST `/my/:id/quotation/accept` | Recalculate and persist the selected products and terms. |
| POST `/my/:id/quotation/reject` | Close the request with the current `quotationId`, `version`, and optional `reason`. |
| GET `/my/:id/quotation/:quotationId/items/:itemId/image` | Download a private image from the current quotation. |

Calculation and acceptance take this shape. Use the actual quotation and item IDs returned by the GET endpoint.

```json
{
  "quotationId": "11111111-1111-4111-8111-111111111111",
  "version": 1,
  "items": [
    { "itemId": "22222222-2222-4222-8222-222222222222", "quantity": 2 },
    { "itemId": "33333333-3333-4333-8333-333333333333", "quantity": 1 }
  ]
}
```

Select at least one item across either product list. Use each selected ID once, with an integer quantity between 1 and its quoted maximum. Selection returns each item's unit price, tax inclusion, tax treatment and rate, offered and selected quantities, pre-tax subtotal, tax, and gross total. It also returns `productsSubtotalBeforeTax`, `productsTax`, `productsTotalIncludingTax`, the separate fixed sourcing fee and its tax breakdown, `totalBeforeShipping`, and `currency`. Tax rounds half-up per extended line or fee in the currency's minor units. A fee applies once regardless of the selection.

Acceptance returns `{ id, createdAt, snapshot }`. The snapshot contains the selection totals and quoted terms for Special Checkout. Retrying the same quotation and selection returns the same acceptance, even if the item order differs. A changed selection after acceptance, an expired quotation, and a stale quotation version produce HTTP 409. Acceptance creates no order, payment, stock reservation, or cart item.

## Resubmission and lifecycle

To resubmit a QUOTED or ACCEPTED request, send the full edited request to `PATCH /my/:id` and include `resubmit: { quotationId, version, status }`, using the current request status. Optional `removeAttachmentIds` removes retained files. The multipart format also accepts replacement files by item position. To cancel a QUOTED or ACCEPTED request, send `{ quotationId, version, status }` to the cancellation endpoint. An ordinary NEW request edit or NEW / UNDER_REVIEW cancellation uses the original contract. Opening the edit form leaves the offer intact.

- NEW → UNDER_REVIEW when the merchant begins review.
- UNDER_REVIEW → QUOTED when the merchant publishes a draft.
- QUOTED → ACCEPTED when the customer confirms a selection.
- QUOTED or ACCEPTED → NEW after a successful, explicitly versioned resubmission.
- QUOTED → REJECTED when the customer rejects the quotation. History records the customer actor and action. A merchant can also reject a request.
- Cancellation invalidates any active offer and its unconsumed acceptance. ORDER_CREATED is reserved for Special Checkout.

A request retains its ID and number across edits. The service keeps one current quotation and at most one working draft. Replacement removes the superseded unaccepted data. The accepted quotation and snapshot remain available unless the customer explicitly resubmits or cancels before order creation. Publication and replacement notify the customer. Acceptance, resubmission, and customer rejection notify the merchant through the existing notification queue.

## Special Checkout and final orders

Special Checkout uses the accepted selection and immutable quotation terms. The
customer supplies the acceptance ID, fulfillment selection and an authorized
payment method. The preview and confirmation bodies reject extra fields,
including amounts, prices and quantities. An accepted quotation remains valid
under the existing request lifecycle. To change the selection, use the
existing versioned request resubmission workflow before an order is created.

| Method and path under `/api/v1/special-orders` | Access and response |
| --- | --- |
| `GET /my/:id/checkout` | Customer. Request, active acceptance, accepted products and financial terms |
| `GET /my/:id/checkout/options` | Customer. Eligible saved addresses and explicitly enabled public pickup locations |
| `GET /my/:id/checkout/options?addressId=<uuid>` | Customer. Shipping methods and prices for one owned address |
| `POST /my/:id/checkout/preview` | Customer. Fulfillment, selected/available payment terms, totals and preview token |
| `POST /my/:id/checkout/confirm` | Customer. Creates the order with HTTP 201 or replays it with HTTP 200 |
| `GET /my/orders` | Customer. Paginated owned orders |
| `GET /my/orders/:id` | Customer. Owned order with items |
| `GET /my/:id/order` | Customer. Final order by associated request ID |
| `GET /orders` | Owner, admin or manager. Paginated tenant orders, with optional `state` and `search` |
| `GET /orders/:id` | Owner, admin or manager. Tenant order with items |

The existing request detail includes `finalOrder.id` after creation. Merchant
search accepts an order number such as `SO-1001`, or a fragment of the customer's
snapshot name, email or phone. List endpoints accept the existing `page` and
`limit` parameters.

### Delivery and pickup

For home delivery, use the existing address APIs to manage addresses and select
one by ID. The shipping engine evaluates the tenant's eligible methods using
the sum of accepted quoted unit prices multiplied by selected quantities.
The shipping tax uses the selected destination's default tax category and
inclusive/exclusive tax profile. This preserves inclusive shipping rates and
adds tax once to exclusive rates. A destination that requires different
product or sourcing-fee tax terms returns `409 SPECIAL_CHECKOUT_TAX_CONFLICT`
and requires a new quotation. Delivery estimates are currently null because
the shipping configuration has no estimate field.

Pickup uses the tenant's private `special_checkout` app setting, managed via
the existing App Settings API. Create it with `POST /api/v1/app-settings` or
update it with `PATCH /api/v1/app-settings/special_checkout`. Example setting:

```json
{
  "key": "special_checkout",
  "isPublic": false,
  "value": {
    "cashEnabled": true,
    "pickupLocations": [
      {
        "id": "main-store",
        "enabled": true,
        "name": "Main Store",
        "address": "1 Main St",
        "countryCode": "US",
        "regionCode": "CA",
        "instructions": "Use the customer entrance."
      }
    ]
  }
}
```

Only explicitly enabled, uniquely identified locations with valid public
details and matching tax treatment appear in the checkout options. Pickup
requires no delivery address and has zero shipping subtotal, tax and total.
The selected method and address or pickup details are copied to the order.

### Preview and confirmation

Home-delivery preview body:

```json
{
  "acceptanceId": "996ff5ee-cad1-4cba-a242-78807defc120",
  "fulfillment": {
    "method": "HOME_DELIVERY",
    "addressId": "aad25d66-d7d8-4a62-a1a9-fdad6839be91",
    "shippingMethodCode": "standard"
  },
  "paymentMethod": "CASH_ON_FULFILLMENT"
}
```

For pickup, use `"fulfillment": { "method": "STORE_PICKUP",
"pickupLocationId": "main-store" }`. The preview returns the accepted products,
request and acceptance IDs, selected fulfillment, available and selected
shipping and payment options, sourcing duration, and the full currency-aware
breakdown. Example home-delivery `financials` for USD:

```json
{
  "currency": "USD",
  "productsSubtotalBeforeTax": "143.86",
  "productsTax": "20.14",
  "productsTotalIncludingTax": "164.00",
  "sourcingFeeSubtotalBeforeTax": "10.00",
  "sourcingFeeTax": "1.40",
  "sourcingFeeTotalIncludingTax": "11.40",
  "shippingSubtotalBeforeTax": "10.00",
  "shippingTax": "1.40",
  "shippingTotalIncludingTax": "11.40",
  "grandTotal": "186.80"
}
```

The equivalent pickup preview has `fulfillmentMethod: "STORE_PICKUP"`,
`deliveryAddress: null`, `shippingMethod: null`, `shippingOptions: []`,
a `pickupLocation` snapshot, three shipping amounts of `"0.00"`, and a
`grandTotal` of `"175.40"`. Both previews include `previewToken` when an
executable term is selected.

Confirm with the preview's payment and fulfillment selections, its
`previewToken`, and an `Idempotency-Key` header. Include the selected
`shippingMethodCode` explicitly for delivery. The service recalculates the
preview during confirmation. A changed preview or unavailable selection
returns HTTP 409. Retry the same confirmation with the same body and key.
An altered body, a different key for an already confirmed request or reuse
of the key for another request returns a conflict.

Example excerpt from the final pickup order response:

```json
{
  "orderNumber": "SO-1001",
  "requestNumber": "SR-1001",
  "state": "PENDING_SOURCING",
  "paymentStatus": "PENDING",
  "fulfillmentMethod": "STORE_PICKUP",
  "initialPayment": "0.00",
  "remainingBalance": "175.40",
  "estimatedSourcingDays": 3
}
```

### Quotation payment terms

A merchant can set `paymentTerms` on a quotation draft. Published terms are
disclosed with the quote and snapshotted at acceptance. A quotation without
explicit terms follows the legacy cash-at-fulfillment path, subject to the
tenant's cash capability. An explicit list can authorize any of:

- `CASH_ON_FULFILLMENT`
- `FULL_ADVANCE_ONLINE`
- `DEPOSIT_REMAINING_CASH` with `deposit`
- `DEPOSIT_REMAINING_ONLINE` with `deposit`

A deposit is either `{"type":"FIXED","amount":"25.01"}` or
`{"type":"PERCENTAGE","percentage":"12.50"}`. Percentage deposits are rounded
half up in the currency's minor unit on the products total including tax.
Shipping and sourcing fees are excluded from the deposit and allocated to the
remaining balance. For USD 164.00 in products and a USD 175.40 pickup grand
total, a 12.50% deposit is **USD 20.50**, leaving **USD 154.90**.
Invalid calculated deposits return a conflict.

Cash is available when enabled by the tenant. Advance and deposit checkout
require a compatible, tenant-authorized payment account. When no account can
serve the quotation, preview displays those disclosed terms and their financial
breakdown with `executable: false`. A preview with no executable term has no
confirmation token.

### Lifecycle, retention and scope

Confirmation locks the request and acceptance, creates the order and items,
records acceptance consumption, transitions the request to `ORDER_CREATED`
and queues deduplicated customer and merchant notifications in one transaction.
Unique constraints protect the request, acceptance, tenant order number and
scoped idempotency key. Order numbers reuse the already allocated tenant
request number with the `SO-` prefix.

The latest original request and its attachments are preserved. Obsolete drafts
and unselected quotation lines, including their inline images, are removed.
Selected quotation rows and images remain referenced by the final items, and
the accepted snapshot remains available as commercial evidence and to support
existing acceptance reads. Disabling new submissions leaves eligible
previously accepted requests able to complete checkout.

New Special Orders are pending sourcing. SO-BE.4A exposes the financial sourcing
prerequisite separately from the order state. SO-BE.4B reserves stock and records sourcing against the Special Order. SO-BE.4C records dispatch, handover, cash collection, and completion. Special
Orders do not write regular carts, orders, payments or inventory.

## Special Order payments

Special Order payment obligations are fixed when checkout is confirmed. The
first online obligation has a 30-minute deadline. A cash obligation remains
outstanding through this phase. A remaining online obligation has no deadline
and becomes payable once all products are secured and the merchant marks the order ready.

All paths are relative to `/api/v1/special-orders`. Order IDs in these paths
are the final Special Order IDs.

| Method and path | Behavior |
| --- | --- |
| `GET /my/orders/:id/payment` | Customer financial summary and obligations |
| `GET /my/orders/:id/payment/options` | Customer obligations, amounts, and payable flags |
| `POST /my/orders/:id/payment/attempts` | Body `{"obligationId":"<uuid>"}` and `Idempotency-Key` header. Returns 201 for a new attempt or 200 for the same key |
| `GET /my/orders/:id/payment/attempts/:attemptId` | Customer attempt status and available checkout URL |
| `POST /my/orders/:id/payment/attempts/:attemptId/verify` | Verifies using trusted provider status and returns the attempt and updated summary. The optional body is empty |
| `GET /orders/:id/payment` | Tenant owner, admin or manager read-only access to obligations, attempts, verified settlements, and financial conflicts |

The final order detail includes `paymentSummary`. Amounts are strings in the
order currency. `verifiedCollected` includes attributable verified
settlements only. `overpaid` explicitly shows collection above the grand
total. Settlement evidence in a different currency and duplicate transaction
references are available to authorized merchants for reconciliation.

### Full advance example

For a KWD 23.260 order, checkout creates an initial obligation of KWD 23.260.
The customer initiates the obligation and follows the returned checkout URL.
A redirect or mock scenario result does not settle the order. The customer
calls verification, or the existing authenticated MyFatoorah webhook or
recovery worker checks the provider. Trusted matching evidence moves the
financial status to `PAID`, outstanding to KWD 0.000, and opens the financial
sourcing gate.

### Deposit example

For KWD 20.010 in products and KWD 3.250 in sourcing fees, a 12.50% accepted
deposit is KWD 2.501. After verification, the response includes:

```json
{
  "currency": "KWD",
  "grandTotal": "23.260",
  "requiredInitialPayment": "2.501",
  "verifiedCollected": "2.501",
  "outstanding": "20.759",
  "overpaid": "0.000",
  "status": "PARTIALLY_PAID",
  "initialSourcingPrerequisiteSatisfied": true,
  "furtherPaymentAllowed": false,
  "financialConflict": null
}
```

The remaining KWD 20.759 is preserved as a cash or online obligation according
to the accepted terms. The online balance uses the same initiation and verification endpoints after readiness. For cash balances, the merchant records collection at handover. For full cash,
the required initial payment is zero and the financial sourcing gate is open
while the full total remains outstanding.

### Provider binding and recovery

Online Special Orders currently use the existing Kuwait MyFatoorah sandbox
adapter for KWD, or its mock counterpart outside production. The tenant must
have exactly one matching active authorized account. Sandbox accounts must
reference the configured `env:MYFATOORAH_API_TOKEN` credential. Attempts bind
the provider account, environment and credential version. No provider
credentials or raw gateway payloads are returned.

Initiation claims and settlement application use order locks, and network
calls run outside database transactions. A live or uncertain attempt blocks a
new attempt. The existing Recovery Worker leases and rechecks known invoices.
Uncertain mock initiation can be replayed with the same provider key. An
uncertain sandbox initiation without an invoice ID stays blocked until an
authenticated webhook identifies it using trusted provider references.
Expiration closes initiation and checkout URL exposure while verification
remains available. Expiration alone does not prove that funds were not
collected.

The existing MyFatoorah webhook signature and live status checks apply.
Verified collection identities are checked against regular payments as well
as Special Order evidence. Repeated webhook and customer verification calls
converge on the same settlement. Additional successful collections are
preserved and block the financial sourcing and payment gates pending
reconciliation. This phase provides no manual settlement override, refund,
cancellation, cash collection, or sourcing execution.

## Inventory reservation and sourcing

Merchants with the owner, admin or manager tenant role can read
`GET /api/v1/special-orders/orders/:id/sourcing` and send actions to
`POST /api/v1/special-orders/orders/:id/sourcing` with an `Idempotency-Key`.
Reusing a key with the same action and fields returns current progress.
Reusing it with different fields returns a conflict.

| Action body | Behavior |
| --- | --- |
| `{"action":"START","warehouseId":"<uuid>"}` | Assign an eligible warehouse, begin sourcing, and reserve available catalog units |
| `{"action":"RESERVE"}` | Reserve newly available units up to the amount still required |
| `{"action":"RECEIVE","itemId":"<uuid>","quantity":3}` | Add the units to warehouse stock and reserve them in the same transaction |
| `{"action":"SECURE","itemId":"<uuid>","quantity":1}` | Record physically secured non-catalog units for this order |
| `{"action":"READY"}` | Record readiness once every unit is secured and the financial gate is satisfied |

Home delivery uses the warehouse's configured destination country coverage.
Pickup requires a warehouse in the pickup country and, when the pickup
snapshot specifies a region, the same region. A public pickup location and
the internal warehouse remain separate. The warehouse can change before
entries are recorded. Corrections after recording require a later controlled
compensating workflow. The API preserves prior movement evidence.

Catalog operations share the existing inventory rows with regular checkout.
They lock rows in variant order and use the existing conditional stock and
reservation updates. Each entry is tied to its tenant order and item and,
for catalog stock, to the inventory and namespaced movements. Manual stock
operations cannot use that namespace. Non-catalog sourcing creates only
order-local progress entries. Every action checks the initial settlement and
financial conflicts while holding the order lock. Insufficient or unresolved
catalog stock remains outstanding.

Example merchant progress excerpt for a mixed order:

```json
{
  "state": "SOURCING",
  "canMarkReady": false,
  "blockers": ["QUANTITIES_OUTSTANDING"],
  "items": [
    { "requiredQuantity": 5, "reservedCatalogQuantity": 2, "securedNonCatalogQuantity": 0, "remainingQuantity": 3 },
    { "requiredQuantity": 1, "reservedCatalogQuantity": 0, "securedNonCatalogQuantity": 1, "remainingQuantity": 0 }
  ]
}
```

After receipt and readiness, the response has `state: "READY_FOR_FULFILLMENT"`,
an ISO `readyAt` timestamp, and zero outstanding items. Readiness leaves physical
and reserved totals intact. Order details return sourcing progress. The customer
view shows required and secured quantities without warehouse or movement data.

For a deposit plus online balance, readiness unlocks the existing balance
obligation. Payment uses the previously disclosed amount and the same
initiation, verification, webhook and recovery behavior as initial payment.
`paymentSummary.onlinePaymentPrerequisiteSatisfied` tracks the verified
online prerequisite independently of physical readiness. A blocking
financial conflict preserves sourcing evidence and closes operational gates.
SO-BE.4C consumes the reserved inventory at dispatch or actual pickup.

## Delivery, pickup and completion

Tenant owners, admins, and managers can read `GET /api/v1/special-orders/orders/:id/fulfillment`
and submit actions to `POST /api/v1/special-orders/orders/:id/fulfillment` with an
`Idempotency-Key`. Reuse a key with exactly the same action and fields to read
current progress without repeating effects. Customer order details show
fulfillment state, checkout address or pickup location, tracking and milestones,
and the payment summary. The merchant view also includes the evidence log.

| Action | Rule |
| --- | --- |
| `DISPATCH` | Home delivery in `READY_FOR_FULFILLMENT`. Supply `deliveryMethod` as `MERCHANT` or `EXTERNAL_CARRIER` and a short `evidence` reference. Optional `carrierName`, `trackingNumber`, `trackingUrl`, and `estimatedDeliveryAt` describe the shipment |
| `DELIVERY_ATTEMPT` | A dispatched order can record `UNSUCCESSFUL`, `REFUSED`, or `FAILED` as `outcome`, with `evidence`. It stays shipped, and the outcome is visible to the customer |
| `DELIVER` | Record actual home handover with `handedOver: true` and `evidence` |
| `AVAILABLE_FOR_PICKUP` | Move a ready pickup order to `AWAITING_PICKUP` and notify the customer |
| `PICK_UP` | Record actual counter handover with `handedOver: true` and `evidence` |
| `REMIT_CASH` | Record a treasury `reference` once for an existing verified cash collection. This does not affect the customer balance |
| `COMPLETE` | Record completion after handover, settlement of all customer obligations, and verification of stock evidence |

An optional `occurredAt` is an ISO datetime with offset. When omitted, the
server records the current time. Delivery dates follow dispatch, and pickup
handover follows the pickup availability timestamp.

Fulfillment rechecks the payment gate, warehouse, and exact Special Order
reservation evidence. The complete order is fulfilled together. Home delivery
consumes catalog stock on dispatch. Pickup consumes catalog stock at handover.
Non-catalog goods use the order's sourcing and handover evidence. A delivery
attempt or refusal does not return any physical stock to inventory.

For orders with a cash balance, the authorized merchant records the actual
receipt with `cash: {"observedAmount":"20.915","currency":"KWD","reference":"receipt-42"}`
at `DELIVER` or `PICK_UP`. The customer cannot set this amount. The backend
checks the observation against the exact outstanding cash obligation. A valid
observation writes one verified settlement and updates the payment summary.
A mismatched amount, currency, missing receipt, or inconsistent handover
assertion is preserved for reconciliation. The response flags
`requiresReview`, and completion is blocked. A confirmed physical handover
with mismatched cash still accounts for the stock handed over.

For example, home delivery proceeds from `READY_FOR_FULFILLMENT` to `SHIPPED`
to `DELIVERED`. After `COMPLETE`, the order retains `DELIVERED` and has a
separate `completedAt` timestamp. Store pickup follows `READY_FOR_FULFILLMENT`,
`AWAITING_PICKUP`, and `PICKED_UP` with the same completion rule. Full advance
and deposit-plus-online orders require verified online settlement before
dispatch or pickup. Full cash and deposit-plus-cash settle at actual handover.

The resolution endpoints below record cancellation, returns, and controlled adjustments. The fulfillment API preserves the underlying evidence.

## Cancellation, returns, refunds and corrections

Customer endpoints use `/api/v1/special-orders/my/orders/:id/resolution`.
Merchant owner, admin and manager endpoints use
`/api/v1/special-orders/orders/:id/resolution`. Read with `GET`. Submit actions
with `POST` and an `Idempotency-Key`. Each action requires a `reason`.
The merchant view also includes audit events and sourcing entry IDs for
controlled corrections. Customer responses omit inspection evidence, actors,
inventory references and provider refund identifiers.

| Actor | Action | Required fields in addition to `action` and `reason` |
| --- | --- | --- |
| Customer | `REQUEST_CANCELLATION` | None |
| Customer | `REQUEST_RETURN` | `items: [{itemId, quantity}]` |
| Merchant | `CANCEL`, `REJECT_CANCELLATION` | None |
| Merchant | `DECIDE_RETURN` | `returnId`, `approved` |
| Merchant | `RECEIVE_RETURN` | `returnId`, `warehouseId`, `evidence`, `items: [{itemId, quantity, condition}]` |
| Merchant | `WAREHOUSE_RETURN` | `warehouseId`, `evidence`, `items: [{itemId, quantity, condition}]` |
| Merchant | `CORRECT_SOURCING` | `entryId`, `quantity`, `correction`, `evidence` |
| Merchant | `CLEAR_HANDOVER_DISCREPANCY` | `evidence` confirming that handover did not occur |
| Merchant | `RECONCILE_CASH` | `evidence`, `cash: {observedAmount, currency, reference}` for an actual completed handover |

An eligible customer can cancel before sourcing. Otherwise the request enters
`UNDER_REVIEW`. Review freezes sourcing, dispatch and new payment initiation.
Provider settlement evidence still applies. A merchant cannot finalize
cancellation while an attempt could still collect. Verified collections are
refundable in full because the existing accepted terms contain no supported
deduction rules. A payment arriving after cancellation creates a refund due
against its verified settlement and leaves the order cancelled.

Cancellation before dispatch releases the remaining Special Order reservation.
Physical catalog stock stays in inventory. Dispatched goods require actual
warehouse receipt and inspection after a recorded failed delivery. Returns
restore only `SELLABLE` catalog units to the original warehouse. `DAMAGED`
units are recorded without stock restoration. Non-catalog units have order-local
receipt evidence. Partial receipts of a failed shipment prevent subsequent
delivery through the fulfillment endpoint.

Customers can submit multiple partial return cases up to the handed-over
quantities. Merchant approval follows the tenant's applicable return policy.
Receipt records the exact approved case quantities, with condition and evidence.
Partial refunds use the difference between cumulative rounded shares of the
accepted tax-inclusive line totals. Once all original units have been received,
the remaining refundable order charges are included. Refund allocations
cannot exceed attributable verified settlements. There is no automatic
refund for unreturned goods.

Use `POST /api/v1/special-orders/orders/:id/refunds` with an idempotency key,
`refundId`, and `reason`. For an actual cash repayment also supply the repayment
`reference`. The amount comes from the refund allocation. Online execution uses
the original provider account binding. The existing mock adapter can supply a
verified final result. MyFatoorah sandbox refunds are unsupported, so the
allocation remains due. A pending or ambiguous provider result is retained
as `UNKNOWN` and blocks retries. Resolution reads expose refund status and the
payment summary separately reports verified collections, settled refunds,
net collections, outstanding customer obligations and refund due.

Sourcing corrections append an audit event and a compensating entry.
`RELEASE_RESERVATION` leaves catalog stock present, `REVERSE_RECEIPT` reverses
a verified erroneous physical receipt, and `REVERSE_SECURED` adjusts an
order-local quantity. A correction before dispatch or pickup handover can
move readiness back to `SOURCING`. Verified balance payments are preserved.

Clearing an unsuccessful handover allows a subsequent genuine handover.
Reconciling cash after actual handover records a new receipt against the
original obligation and links the original evidence. It does not overwrite
the initial observation or count merchant remittance as customer payment.

## Merchant analytics

Tenant owners, admins and managers can use the following read-only endpoints
under `/api/v1/special-orders`.

| Endpoint | Date basis and meaning |
| --- | --- |
| `GET /analytics/overview` | Requests and orders are cohorts based on their original `createdAt`. Request and active order state counts reflect the current state of each cohort member. Confirmed, completed, and cancelled orders are counted once per confirmed order. Return activity uses case opening and inspection receipt dates. Refund activity uses allocation and trusted settlement dates. |
| `GET /analytics/demand` | Original demand uses the latest retained items of the request creation cohort. Confirmed and fulfilled quantities use the order creation cohort. Fulfilled means recorded customer handover, before returns. Merchant-suggested confirmed units are reported separately and never increase original requested quantities. |
| `GET /analytics/financial` | Uses the order creation cohort and all currently verified collections, settled refunds and outstanding obligations for those orders. Collection or refund dates can fall outside the order range. Amounts are separated by currency. |

Both dates use `YYYY-MM-DD` and are inclusive UTC calendar days. The default is
30 days ending on the current UTC date. A range can contain up to 366 days.
The demand endpoint accepts `page` and `limit` and uses the existing pagination
envelope. Original demand groups the stored catalog product/variant identifiers
or normalized lowercase non-catalog item titles with trimmed, collapsed
whitespace. Labels that resemble contact or prescription records are grouped
under a null label. Only dedicated product labels are considered. The report
does not query specifications, request notes, contacts, or attachment content.

Conversion is the fraction of original requests in the selected request
cohort that have a confirmed order, even if confirmation came later. A zero
denominator yields zero. Current review includes `NEW` and `UNDER_REVIEW`.
Confirmed order value includes subsequently cancelled orders as historical
order value. Sourcing fees and shipping are the quoted tax-inclusive
components of that value. They are not receipts or profit. Financial
collections include attributable verified payment evidence. The cash and
online totals are separate from remittance, attempts, and pending refunds.
Outstanding is per active order after verified same-currency collections,
with cancelled debt excluded. Overpayments and off-currency collections have
separate fields. Refund due includes unsettled allocations.

Representative response excerpts from the analytics integration fixture:

```json
{
  "requests": { "submitted": 4, "quoted": 1 },
  "orders": { "confirmedOrders": 3, "completedOrders": 1, "cancelledOrders": 1 },
  "conversion": { "submittedRequests": 4, "convertedRequests": 3, "rate": 0.75 }
}
```

```json
{
  "items": [
    { "kind": "NON_CATALOG", "productId": null, "variantId": null, "name": "generic item", "requestedQuantity": 6, "confirmedQuantity": 0, "suggestedConfirmedQuantity": 0, "fulfilledQuantity": 0 }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 4, "totalPages": 1 }
}
```

```json
{
  "byCurrency": [
    { "currency": "KWD", "confirmedOrderValue": "30.000", "verifiedOnlineCollections": "10.000", "verifiedCashCollections": "20.000", "verifiedCollections": "30.000", "settledRefunds": "2.000", "refundDue": "3.000", "netCollected": "28.000", "outstanding": "0.000" },
    { "currency": "USD", "confirmedOrderValue": "19.00", "verifiedCollections": "0.00", "outstanding": "7.00" }
  ]
}
```

## Frontend integration reference

Read `settings.specialOrders` from public `GET /api/v1/storefront` with
`X-Tenant-Slug`. The storefront request does not require a bearer token.
The `enabled` flag controls new submissions. An established request, accepted
checkout, order history, and eligible fulfillment do not depend on it.

Customer routes require an active `CUSTOMER` tenant membership. Merchant
routes require tenant `OWNER`, `ADMIN`, or `MANAGER`. Send the existing access
token in `Authorization: Bearer …` and select the tenant with
`X-Tenant-Slug`. Response data is under `data`. Handle 400 schema errors, 401
authentication, 403 authorization or disabled submission, scoped 404,
409 stale state or idempotency conflict, 413 upload limits, and 429 rate limits.
Use the returned `pagination` object for paginated lists. For any operation
that requires `Idempotency-Key`, retry the identical request with the same
key. Use a new key for a different logical action. Checkout confirmation also
requires the current signed preview token. Payment attempts use a separate key.

### Customer routes and actions

All paths in this reference are relative to `/api/v1/special-orders`.

| Route | Use and availability |
| --- | --- |
| `POST /my`, `GET /my`, `GET /my/:id` | Submit, list, and read an owned request. Submission uses an idempotency key. |
| `PATCH /my/:id`, `POST /my/:id/cancel` | Edit a new request. Explicit resubmission from quoted or accepted uses the observed quotation identity, version, and state. Cancellation is state-gated. |
| `POST /my/:id/attachments`, `GET /my/:id/attachments/:attachmentId` | Add to an owned new request or download authorized evidence. Create and edit also support the documented multipart request. |
| `GET /my/:id/quotation`, `GET /my/:id/quotation/:quotationId/items/:itemId/image` | Read the current published offer and privately download its image. |
| `POST /my/:id/quotation/calculate`, `POST /my/:id/quotation/accept`, `POST /my/:id/quotation/reject` | Calculate, accept, or decline a current quoted version. Accepted item quantity belongs to that version. |
| `GET /my/:id/checkout`, `GET /my/:id/checkout/options` | Read an active acceptance and eligible address, shipping, or pickup options. |
| `POST /my/:id/checkout/preview`, `POST /my/:id/checkout/confirm` | Calculate and confirm from the accepted snapshot. Confirm uses the preview token and idempotency key. |
| `GET /my/orders`, `GET /my/orders/:id`, `GET /my/:id/order` | Read owned confirmed orders, including sourcing, fulfillment, payment and resolution summaries. |
| `GET /my/orders/:id/payment`, `GET /my/orders/:id/payment/options` | Read financial and obligation status. An initial online obligation must be eligible and within its payment window. A remaining online obligation becomes available after readiness. |
| `POST /my/orders/:id/payment/attempts`, `GET /my/orders/:id/payment/attempts/:attemptId`, `POST /my/orders/:id/payment/attempts/:attemptId/verify` | Initiate an eligible obligation, read attempt status, or request trusted provider verification. A redirect is not settlement evidence. |
| `GET /my/orders/:id/resolution`, `POST /my/orders/:id/resolution` | Read resolution evidence summaries, request cancellation or request a return. Received or approved return cases reserve their item quantities against duplicate requests. |

A request starts as `NEW`, can move through `UNDER_REVIEW`, `QUOTED`, and
`ACCEPTED`, and ends as `ORDER_CREATED`, `REJECTED`, or `CANCELLED`.
Resubmission returns a quoted or accepted request to `NEW`. Quote status is
`DRAFT`, `PUBLISHED` or `ACCEPTED`, with `EXPIRED` derived on the response for
published offers outside their acceptance window. Accepted checkout uses the
existing validity rules described above.

Example request and acceptance bodies:

```json
{ "contactPhone": "+96555551234", "items": [{ "name": "Special item", "quantity": 2 }] }
```

```json
{ "quotationId": "996ff5ee-cad1-4cba-a242-78807defc120", "version": 1, "items": [{ "itemId": "aad25d66-d7d8-4a62-a1a9-fdad6839be91", "quantity": 2 }] }
```

The checkout sections give working home and pickup structures. Payment initiation
uses `{"obligationId":"<uuid>"}`. Verification accepts an empty body. The
attempt response includes `id`, `obligationId`, `provider`, `status`,
`initiationState`, `checkoutUrl`, and `conflictCode`.

### Merchant routes and actions

| Route | Use and availability |
| --- | --- |
| `GET /`, `GET /:id`, `POST /:id/review`, `POST /:id/reject` | List and review tenant requests. Reject from an eligible request state with a reason. |
| `GET /:id/attachments/:attachmentId`, `GET /:id/quotation/:quotationId/items/:itemId/image` | Authorized request attachment or quotation image download. |
| `GET /:id/quotation`, `PUT /:id/quotation/draft`, `POST /:id/quotation/publish` | Inspect, draft and publish a reviewed offer. Use the draft ID and version on updates and publication. |
| `GET /orders`, `GET /orders/:id`, `GET /orders/:id/payment` | Tenant order list, detail, and financial evidence. |
| `GET /orders/:id/sourcing`, `POST /orders/:id/sourcing` | `START` once the financial prerequisite is satisfied. `RESERVE`, `RECEIVE`, and `SECURE` are available in sourcing. `READY` requires all accepted quantities secured. |
| `GET /orders/:id/fulfillment`, `POST /orders/:id/fulfillment` | Dispatch or announce pickup from readiness after required online settlement. Record handover, attempts, cash remittance and completion at the applicable milestone. |
| `GET /orders/:id/resolution`, `POST /orders/:id/resolution`, `POST /orders/:id/refunds` | Review cancellation and return cases, receive or inspect returns, record controlled corrections or reconciliation, and execute an eligible refund. |
| `GET /analytics/overview`, `GET /analytics/demand`, `GET /analytics/financial` | Tenant-scoped reporting. Use the date and pagination contracts above. |

Orders progress through `PENDING_SOURCING`, `SOURCING`, and
`READY_FOR_FULFILLMENT`. Delivery continues through `SHIPPED` and `DELIVERED`.
Pickup continues through `AWAITING_PICKUP` and `PICKED_UP`. Completion uses
`completedAt`. Cancellation is separate as `NONE`, `UNDER_REVIEW`, or
`CANCELLED`. Returns use `REQUESTED`, `APPROVED`, `REJECTED`, and
`RECEIVED`. Refunds use `DUE`, `IN_PROGRESS`, `UNKNOWN`, `SETTLED`, or
`UNSUPPORTED`. Order financial state is `PENDING`, `PARTIALLY_PAID`, or
`PAID`, alongside collection, outstanding, and refund amounts. The action
bodies and prerequisites are in the corresponding sourcing, fulfillment,
and resolution tables above. An unavailable action returns a conflict.

### Notifications and private evidence

Special Order notification data includes `eventType` and `requestId`.
`SPECIAL_ORDER_CREATED` also includes `orderId`. For other confirmed-order
events, the customer can resolve the order via `GET /my/:id/order`. Request
events are `SPECIAL_REQUEST_CREATED`, `SPECIAL_REQUEST_REJECTED`,
`SPECIAL_REQUEST_RESUBMITTED`, `SPECIAL_QUOTATION_PUBLISHED`,
`SPECIAL_QUOTATION_ACCEPTED`, and `SPECIAL_QUOTATION_REJECTED`. Confirmed-order
events include `SPECIAL_ORDER_CREATED`, `SPECIAL_ORDER_DEPOSIT_VERIFIED`,
`SPECIAL_ORDER_PAYMENT_VERIFIED`, `SPECIAL_ORDER_PAYMENT_FAILED`,
`SPECIAL_ORDER_SOURCING_STARTED`, `SPECIAL_ORDER_READY`,
`SPECIAL_ORDER_BALANCE_AVAILABLE`, `SPECIAL_ORDER_DISPATCHED`,
`SPECIAL_ORDER_AWAITING_PICKUP`, `SPECIAL_ORDER_HANDED_OVER`,
`SPECIAL_ORDER_DELIVERY_FAILED`, `SPECIAL_ORDER_COMPLETED`,
`SPECIAL_ORDER_CANCELLED`, `SPECIAL_ORDER_CANCELLATION_REJECTED`,
`SPECIAL_ORDER_RETURN_DECIDED`, `SPECIAL_ORDER_RETURN_RECEIVED`, and
`SPECIAL_ORDER_REFUND_SETTLED`.

Attachments and quotation images are stored as PostgreSQL bytes with scoped
downloads. The API applies a 3 MiB per-file limit and a six-file limit.
Request attachments accept supported images and PDFs. Item and quotation
images accept only supported image formats. Downloads use private no-store,
forced attachment, and nosniff headers. Request list and detail responses
carry metadata only. Receipt and attachment bytes do not feed reporting.
Obsolete files may be removed during editable request changes and obsolete
unselected quotation data may be cleared when an order is created. Selected
quotation images and the latest request attachments remain tied to order
evidence. PostgreSQL backups and replicas can contain these bytes and
require the same access and retention protections as the live database.
Changing database backup expiry or migrating these files is outside this phase.
Content checks are format validation. They do not provide malware scanning.

### Provider capability boundaries

Cash collection and repayment require actual authorized evidence in the
appropriate lifecycle. The mock MyFatoorah adapter exercises payment and
supported refund responses outside production. The MyFatoorah sandbox
adapter supports configured KWD payment initiation and trusted settlement
verification. Sandbox refund execution is unsupported. Payment or refund
outcomes that cannot be verified require reconciliation. Mock validation
does not qualify either capability for production. There is no verified
production online payment or refund provider in this implementation.

## Backend audit

The lifecycle integrations cover tenant and customer boundaries, merchant role
checks, quote versions, immutable acceptance, checkout idempotency, shipping
and tax snapshots, payment identity and replay, inventory ownership, sourcing,
handover, and resolution. They also exercise cancellation releases, return
inspection and restocking, refund allocation limits, controlled corrections,
notification deduplication, and concurrent operations. The storefront flag
controls new submissions while existing histories and eligible checkout
remain available.

Two payment paths were tightened during this audit:

- A signed MyFatoorah webhook can recover verified collections after a
  Special Order initiation loses its response and leaves no local invoice
  mapping. Recovery requires the provider's Special Order reference and a
  matching bound attempt. Distinct collections remain visible as financial
  evidence, with conflicts and overpayment reported.
- The mock invoice-level refund operation requires a single verified
  collection on that invoice. An allocation against an invoice with
  multiple collections remains unsupported because the adapter
  cannot target the individual collection. An unknown refund outcome
  still requires reconciliation before another execution.

Attachments are stored in PostgreSQL with authorized metadata and download
paths. Backups carry the same private evidence, including retained historical
records, and require the same access controls. The application can remove
obsolete attachments where the lifecycle permits. Recovery copies and
backups follow their own retention policies. Upload checks enforce the
supported signatures and size and count bounds. The application does not
provide antivirus scanning or a backup-specific purge workflow.
