# Checkout idempotency

`POST /checkout` requires authentication, verified email, tenant context through
`X-Tenant-Slug`, and `Idempotency-Key`. Keys are case-sensitive, trimmed, and must
contain 1–255 visible ASCII characters without spaces. Their scope is the current
tenant and authenticated user; body fields cannot select either identity.

The first success returns HTTP 201. A committed replay returns HTTP 200 with the
same order and original local payment reference, and `data.idempotent: true`.
Both use `{ "success": true, "message": null, "data": { ... } }`.
Operational order/payment statuses may have changed since the initial response.
Replays read persisted order snapshots, never the current cart or pricing rules.

The SHA-256 fingerprint is versioned and built in fixed property order from
shipping address ID, billing choice/address ID, shipping method ID/code, normalized
coupon code, payment method and provider. Defaults are explicit. Client currency
and unknown amount fields have no authority and are excluded. The cart is implicit
in tenant/user scope; changing cart contents does not turn a reused key into a new
attempt. Use a new key for a genuinely new checkout.

Errors use `{ "success": false, "message": "...", "code": "...", "data": null }`:

- HTTP 409 `CHECKOUT_IN_PROGRESS`: another transaction owns the scoped key. Retry
  the same key and body after a delay. Do not create a new key after a timeout.
- HTTP 409 `IDEMPOTENCY_KEY_CONFLICT`: the committed key has a different intent.
  Recover the original attempt or use a new key only for a new checkout.
- HTTP 409 `IDEMPOTENCY_LEGACY_REQUEST`: an older record has no verifiable intent.
  Retrieve the existing order through order history; use a new key for new work.
- HTTP 409 `CHECKOUT_RESULT_UNAVAILABLE`: the recorded result no longer exists.
  Investigate rather than automatically placing another order.
- Invalid/missing keys return HTTP 400. Other checkout validation errors retain
  their business semantics; failed transactions leave no committed key/claim.

PostgreSQL transaction advisory locks coordinate API instances and release on
commit, rollback, or connection loss. Hash collisions can cause a harmless
in-progress response, never a cross-scope replay. A unique database constraint on
(tenantId, userId, idempotencyKey) is the durable duplication backstop. All checkout
effects and the completed key record commit together; no separate claim/status
record or automatic transaction retry is needed. Keys do not expire automatically.

Legacy migration recovers tenant IDs only from matching order/user references.
It preserves unrecoverable orphan records with null tenant IDs and never invents
historical fingerprints. Orphans cannot replay another tenant's result.

## Flutter client

Generate a unique key once when a checkout attempt begins and persist it with the
request intent. Reuse it across timeouts, network retries, and app restarts.
Treat a successful replay as the same order. Back off and retry on in-progress;
resolve a fingerprint conflict rather than retrying a changed body indefinitely.
Generate a new key only when the user starts a genuinely new checkout attempt.
Provider-level idempotency is outside this local checkout contract.
