# Checkout and payment initiation

Checkout commits the authoritative order, snapshots, inventory reservation,
coupon use, local pending payment and checkout key in one transaction. It never
calls a provider, including on an idempotent checkout replay.

## Customer API

All endpoints require authentication and `X-Tenant-Slug`. Owner checks use the
authenticated user and current tenant, never body fields. Existing tenant
membership/role checks continue to protect administrative listing and operations.

- `POST /checkout`: existing checkout contract; returns the local payment ID.
- `POST /payments/:id/initiate` with `{}`: initiate that existing payment after
  checkout has committed. Rejects unknown fields including amount, currency,
  provider and status. Success is HTTP 200 with
  `{ "success": true, "message": null, "data": { ...payment } }`.
- `GET /payments/:id` and `GET /payments/order/:orderId`: customer-owned status.
  Payment responses include `initiationState` as well as the payment status.
- Tenant administrators retain role-protected listing, status, cancellation and
  refund operations. Customers cannot submit successful-payment notifications.

The service uses persisted `Order.totalAmount` and `Order.currency`, and validates
that the local payment matches them. Catalog prices and tenant settings are not
re-read for payment pricing. The internal legacy `createPayment` method validates
its inputs then initiates the existing checkout payment; it cannot create a second
local payment or make client-provided amounts authoritative.

## Providers actually available

Only `NONE` is registered, using the existing local cash-on-delivery/no-op adapter.
It leaves payment PENDING and does not collect online payments. Bank transfer also
uses this existing local mapping. Card and digital-wallet providers are not
configured. Stripe/Paymob enum names alone are not integrations. No gateway SDK,
credentials, payment HTTP implementation or webhook endpoint was added.

The existing adapter contract now takes a stable `payment:<paymentId>` idempotency
key. `supportsIdempotentInitiation` is an explicit opt-in, false when omitted.
Only opt in after verifying a real adapter guarantees that repeating that key does
not create another provider intent. The local NONE adapter is a safe no-op; tests
use a simulated provider boundary and do not demonstrate real gateway collection.
Provider identifiers, status, metadata and optional session URL/client secret are
persisted on the payment; owner/admin authorization protects their retrieval.

## Transactions and retries

A short order-first transaction claims the payment as IN_PROGRESS. It commits
before calling the adapter. Another short transaction persists the result through
the existing reservation lifecycle. No provider calls occur inside either
transaction or the checkout transaction.

- NOT_STARTED: a new checkout payment is ready for explicit initiation.
- IN_PROGRESS: another call is executing, or its process stopped before recording
  an outcome. HTTP 409 `PAYMENT_INITIATION_IN_PROGRESS`; retrieve status. Do not
  clear this state automatically or launch a second non-idempotent operation.
- INITIATED: return the stored payment without another adapter call. This is an
  initiation result, not proof of successful collection; inspect payment status.
- UNKNOWN: HTTP 503 `PAYMENT_INITIATION_UNKNOWN` after a transport exception or
  failure to persist a reply. Order, local payment and reservation remain intact.
  Retry only with the same payment ID when the adapter explicitly supports stable
  idempotency. Otherwise HTTP 409 `PAYMENT_RECONCILIATION_REQUIRED`.

Legacy payments migrate to UNKNOWN; no historical provider outcome is invented.
An interrupted IN_PROGRESS claim needs trusted reconciliation, even for a capable
adapter, before manual recovery. There is no automatic lease expiry or job runner.
Trusted confirmation via the existing administrative status path can reconcile
an uncertain initiation and invokes the existing sale/release lifecycle. A future
real adapter needs authenticated provider lookup and/or verified webhook delivery
before any automated reconciliation can be claimed safe.

An explicit provider FAILED/CANCELLED result releases stock once. PAID commits the
reserved sale once. Duplicate confirmations use the existing lifecycle guards.
A timeout alone never marks the payment FAILED or releases its reservation.
Failures do not create another order, payment, coupon use or reservation. Existing
expiry/cancellation policies still apply; payment/order transition redesign is
outside this task.

No public webhook is provided. Future providers must verify authenticity, reject
invalid signatures, correlate tenant/order/payment identifiers, and handle duplicate
delivery before driving this lifecycle. Real gateway verification remains missing.

Errors retain `{ "success": false, "message": "...", "code": "...", "data": null }`.
Unconfigured providers return a controlled configuration error without claiming a
payment. Missing/foreign payments return HTTP 404. Terminal order/payment states
and mismatched persisted money return controlled conflicts.
