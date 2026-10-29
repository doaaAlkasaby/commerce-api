# Order and payment transitions

These rules use the existing enum values. Every non-initial status write goes
through the OrderService or PaymentService transaction coordinator and the shared
`src/common/domain/status-transitions.ts` rules. Public repository status methods
delegate to these coordinators, including writes using an existing transaction.
Checkout creates initial states; it does not invoke a transition or a provider.

## Order matrix

Same-status requests are no-ops. All other edges absent below are forbidden.

| Current    | Permitted next states | Preconditions / effects                                                               |
| ---------- | --------------------- | ------------------------------------------------------------------------------------- |
| PENDING    | CONFIRMED, CANCELLED  | Cancellation only before financial commitment                                         |
| CONFIRMED  | PROCESSING, CANCELLED | PROCESSING requires AUTHORIZED or PAID; cancellation only before financial commitment |
| PROCESSING | SHIPPED               | AUTHORIZED or PAID                                                                    |
| SHIPPED    | DELIVERED             | AUTHORIZED or PAID                                                                    |
| DELIVERED  | COMPLETED             | AUTHORIZED or PAID                                                                    |
| COMPLETED  | none                  | Fulfillment terminal                                                                  |
| CANCELLED  | none                  | Fulfillment terminal; duplicate cancellation/expiry is harmless                       |

The existing model permits authorized payment during fulfillment; this work does
not introduce a new capture/shipping policy. A financially PAID order can remain
PENDING until an administrator confirms fulfillment. Payment and fulfillment
statuses are distinct. Orders with failed/cancelled payments cannot advance.

Cancellation changes active local payments to CANCELLED and releases the order's
reservation in the same transaction. Already FAILED payments remain FAILED.
PAID, REFUND_PENDING, PARTIALLY_REFUNDED and REFUNDED prevent order cancellation;
there is no newly implemented refund, reversal or returned-stock workflow.

## Payment matrix

| Current            | Permitted next states                                |
| ------------------ | ---------------------------------------------------- |
| PENDING            | REQUIRES_ACTION, AUTHORIZED, PAID, FAILED, CANCELLED |
| REQUIRES_ACTION    | AUTHORIZED, PAID, FAILED, CANCELLED                  |
| AUTHORIZED         | PAID, FAILED, CANCELLED                              |
| PAID               | REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED         |
| FAILED             | CANCELLED                                            |
| CANCELLED          | none                                                 |
| REFUND_PENDING     | PARTIALLY_REFUNDED, REFUNDED                         |
| PARTIALLY_REFUNDED | REFUND_PENDING, REFUNDED                             |
| REFUNDED           | none                                                 |

Same-status events are idempotent. A FAILED notification for an already CANCELLED
payment is acknowledged as a no-op, preserving CANCELLED. A stale failure cannot
replace PAID; a late PAID cannot resurrect FAILED/CANCELLED. FAILED -> PENDING
is explicitly forbidden because its reservation has ended. FAILED -> CANCELLED
is only negative closure, never a new collection attempt.

Existing refund-related representations and adapter paths are retained; no new
refund processing or inventory restocking was implemented. REFUNDED and CANCELLED
are terminal. PAID is terminal for collection but retains the existing refund
status edges above.

A new PAID/AUTHORIZED confirmation must match the persisted order's amount and
currency. An order-specific RELEASE ledger entry prevents all subsequent active
collection transitions, even if other orders have reserved the same SKU. A paid
order's immutable snapshots are never recalculated or overwritten.

For the current single-checkout-payment model, Order.paymentStatus mirrors that
payment's status. PAID commits the reserved sale once. FAILED/CANCELLED releases
reservation once only in early fulfillment states. Failure/cancellation while
PROCESSING/SHIPPED/DELIVERED/COMPLETED requires reconciliation rather than releasing
stock during fulfillment. Refund statuses do not restock inventory.

## Actors and mutation paths

- Existing order PATCH status and payment PATCH status/cancel endpoints require
  tenant membership and OWNER/ADMIN/MANAGER roles. Refund execution retains the
  existing OWNER/ADMIN guard; no new refund capability was added.
- Customers can retrieve only their own orders/payments and initiate their own
  existing payments. There is no customer order-cancellation endpoint in the
  current application; none was invented here. Customers cannot confirm payment.
- Provider initiation results feed the same payment coordinator after the network
  boundary, never from within checkout or a provider-call transaction.
- No authenticated provider webhook exists. Future verified provider events must
  enter the same coordinator; a client-supplied success message is not evidence.
- Expiration is an internal scoped service operation, not a public endpoint. Its
  caller must establish that the deadline elapsed; no deadline column or worker
  was added. Only PENDING unpaid orders may expire.
- Legacy repository updateStatus/updateStatusWithClient paths use the same domain
  rules and side effects; they cannot issue unchecked status-only SQL updates.

Tenant and user IDs come from existing middleware/authentication. Repository and
service mutation lookups are tenant-scoped. Trusted server callers are responsible
for authorization before invoking administrative service methods directly.

## Locking, consistency and duplicate delivery

Transitions lock the owning Order row with SELECT FOR UPDATE before reading the
current state, then mutate Payment/Order and invoke the existing inventory ledger
lifecycle in that same transaction. The lock is shared across status, cancellation,
expiration and initiation claim/finalization paths. State is revalidated after
waiting. No process-local mutex, new counter or automatic retry is used.

A failure to commit sale/release rolls back payment and order updates too. Existing
ledger uniqueness/idempotency prevents repeated sale/release on duplicate events.
No external provider operation runs while these transition transactions hold locks.
Different orders retain checkout's existing deterministic inventory lock order;
PostgreSQL aborts a deadlock safely, without automatic non-idempotent replay.

## Unknown outcomes, expiry and legacy records

A network timeout alone leaves payment PENDING with UNKNOWN initiation state and
preserves its reservation. Explicit cancellation/expiry is a separate business
operation: it can close the local order/payment and release reservation while the
external outcome remains UNKNOWN. A late success is then a controlled conflict,
requiring trusted reconciliation of actual provider funds; it never fulfills the
order or takes another order's reserved stock. No automatic reversal is invented.
Conservative negative closure of an uncertain initiation retains UNKNOWN until
its external outcome can be established. Real provider lookup/webhooks remain
unconfigured. Trusted positive reconciliation on an active reservation follows
the normal guarded success path.

No historical rows or payment history are rewritten. Multiple/missing historical
payments or contradictory order/payment aggregates return
PAYMENT_RECONCILIATION_REQUIRED on mutation rather than guessing a sum or labeling
partial collection as PARTIALLY_REFUNDED. Existing historical reads remain possible.
Unknown legacy combinations require operational investigation. Same-order duplicate
fulfillment requests do not silently repair old inconsistencies.

Domain conflicts use HTTP 409 with existing API envelopes, including invalid
transition, released reservation, paid cancellation, inconsistent legacy state,
and conflicting provider references. Missing or foreign records return 404;
existing authentication/membership/role errors retain their established semantics.
There are no schema changes, migrations, new providers, expiration workers, refund
workflows, tax changes or checkout pricing changes in this task.
