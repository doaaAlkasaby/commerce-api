# Phase 5 security hardening

## Threat model and audit findings

This phase considers unauthenticated internet clients, malicious customers, actors holding
another tenant's IDs, replayed/stolen refresh/reset tokens, forged provider events, and
multiple API/worker instances. A valid tenant owner/global administrator remains privileged;
this is not an audit of a live deployment, filesystem administrator or compromised database.
No production account, database, secret, gateway or deployment was accessed.

| Finding                                                                                     | Concrete impact                                                   | Fix                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tenant writes/member administration lacked authentication                                   | Anonymous tenant settings changes and ownership assignment        | Bearer authentication and active-account/tenant-role authorization.                                                                 |
| Tenant detail/member listing lacked appropriate membership checks; `/me` shadowed by `/:id` | Cross-tenant private reads; intended membership route unavailable | Scoped membership checks; member listing OWNER/ADMIN only; static `/me` registered first.                                           |
| Refresh rotation trusted a pre-transaction check                                            | Concurrent requests could create multiple valid descendants       | User-row lock and fresh token recheck; replay revokes the family before returning failure.                                          |
| Logout/password changes could race session creation/rotation                                | A replacement refresh token could outlive revocation              | Shared user-first lock order; session issuance rechecks the verified password snapshot; logout revokes its family.                  |
| Reset/verification token consumption was not conditional                                    | Concurrent use could succeed twice                                | Atomic usedAt/expiry predicates and user-first transaction locks.                                                                   |
| Access tokens were accepted for inactive/deleted accounts                                   | Existing tokens could continue to act after account deactivation  | Active-user lookup at the authentication boundary; disabled/deleted requests rejected.                                              |
| Query-bearing request URLs, raw exceptions, validation issues and email URLs reached logs   | Token/credential/PII exposure                                     | Query removal, static exception categories, parsed validation, no email token logging and expanded redaction.                       |
| Historical example JWT signing key was public                                               | Deployments copying it could accept forged signatures             | Replace example with a placeholder; production rejects placeholder and historical example fingerprint. Current `.env` is unchanged. |
| Development seed created known privileged accounts without production/remote guard          | Accidental deployment of public development credentials           | Local non-production target guard before connecting; no password/exception dumps.                                                   |
| Local storage deletion joined unchecked keys                                                | Traversal or pre-existing symlink could escape the upload root    | Lexical containment, realpath containment and exclusive random upload filenames.                                                    |
| Process-local request budgets                                                               | Multiple API instances multiplied abuse limits                    | PostgreSQL-backed atomic shared budgets by default in production.                                                                   |
| Parsers/upload errors fell through as raw unexpected errors                                 | Wrong 500 statuses and raw-body logging risk                      | Controlled 400/413/415 envelopes; bounded multipart fields/parts.                                                                   |
| Raw request bodies remained in downstream controllers after Zod parsing                     | Unknown properties/transforms could bypass intended validation    | Controllers now receive parsed body data; typed query/params validation remains compatible.                                         |

Already secure controls were retained: jose HS256 allowlisting, Argon2id hashes, opaque
hashed refresh/reset tokens, tenant-scoped repositories, ownership checks, verified-email
checkout, Prisma parameterization, Helmet, CORS allowlists, exact Money Policy, database
TLS options, canonical MyFatoorah HMAC verification, payment transitions and worker fencing.

## Authentication and session compatibility

Issued access tokens retain HS256, `type: access`, subject, issued-at and expiration. The
verifier now requires those claims and bounds malformed Bearer headers; normal server-issued
Flutter tokens remain valid. Unknown users and incorrect passwords keep the existing generic
401 response. A dummy Argon2id verification reduces the obvious unknown-account hash-work
timing difference. Existing Argon2id settings/hashes are not replaced or migrated.

JWT_ISSUER and JWT_AUDIENCE are optional. With neither configured, the existing token
contract is preserved. When explicitly enabled, new tokens carry those claims and verification
checks them. Do not enable enforcement against existing claimless tokens without a coordinated
rollout/expiry plan. No signing key or valid session was rotated by this task.

Refresh tokens retain their existing opaque format and response fields. Rotation, logout,
logout-all, password change/reset and session creation serialize on the owning user. Rotation
rechecks expiry/revocation under lock and creates only one descendant. Reuse revokes the
family durably, including concurrent descendants. Other login families remain separate.
Flutter should serialize refresh requests rather than reuse an old token concurrently.

Logout/reset revoke refresh tokens. Existing stateless access tokens can remain usable until
their configured expiry (default 15 minutes), except deleted/inactive accounts are rejected
immediately. No blacklist/session-version feature was introduced because it would change
existing session semantics. A stolen active access token remains a TTL-bounded residual risk.

Password reset and verification check expiration and single use both before and during
consumption. Repeated invalid/used/expired requests keep their established controlled errors.
Forgot-password/resend responses do not reveal whether the email exists. Email delivery is
still the existing unconfigured adapter: it now emits only a static configuration category,
never an address, URL or token. A real secure email transport is still required before production
activation; no transport integration was added in this security phase.

Registration deliberately retains **409 EMAIL_ALREADY_EXISTS**. Making it indistinguishable
from successful registration would break the established authentication contract, so that
specific response change was not implemented. Request budgets mitigate abuse, but registration
still permits enumeration, and response uniformity is not a claim of perfect timing resistance.
A future opt-in/versioned generic registration flow is the compatible alternative.

## Authorization and tenant boundaries

Tenant identity remains server-resolved through X-Tenant-Slug for existing store APIs.
Public browsing is intentionally public for the selected active tenant; that does not permit
using another tenant's object ID under the selected tenant. Orders, addresses, payments and
other customer resources still enforce the authenticated customer's ownership.

Tenant-management routes previously omitted guards. Necessary security corrections:

| Existing endpoint                         | Required authority now                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| POST /api/v1/tenants                      | Active authenticated global ADMIN.                                                    |
| GET /api/v1/tenants/me                    | Active authenticated account; own memberships.                                        |
| GET /api/v1/tenants/:id                   | Active membership in that tenant or global ADMIN.                                     |
| PATCH /api/v1/tenants/:id                 | Tenant OWNER/ADMIN or global ADMIN.                                                   |
| GET/POST /api/v1/tenants/:id/members      | Tenant OWNER/ADMIN or global ADMIN.                                                   |
| PATCH /api/v1/tenants/:id/members/:userId | Tenant OWNER/ADMIN or global ADMIN; tenant ADMIN cannot grant/modify OWNER authority. |

These management routes keep their existing path-based tenant context; no new tenant header
is required there. Existing store routes keep X-Tenant-Slug. Membership role/status is fetched
from persistence, not trusted from a token/body. Global ADMIN remains an explicit system role.
Pure role guards remain unchanged; authenticated write budgets run at the authentication
boundary. Private member lists are not exposed to ordinary tenant customers.

The original Phase 1 contract fixture now uses authorized credentials for these management
operations while retaining its response/status/nullable-field assertions. Ownership tests now
use real foreign customers rather than tokens for nonexistent users; expected private-resource
404 assertions are retained. Deleted-account tokens now correctly fail authentication with 401.

## Shared rate limiting and abuse controls

Migration 16 adds RateLimitBucket: a namespaced hashed key, hit count and timestamptz reset.
Atomic INSERT ... ON CONFLICT increments/reset counters using PostgreSQL time. Two store
instances share the same budget; restarts do not reset production counters. An expiry index
supports bounded opportunistic cleanup of old rows. Keys are pseudonymous hashes, not
anonymous/encrypted identities: restrict DB access and retention accordingly.

| Budget                                               | Policy                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Global ordinary API                                  | Existing RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX_REQUESTS (defaults 100 per 15 minutes), by normalized client IP. Runs before body parsing. |
| Auth endpoints                                       | 10 per 15 minutes by normalized IP and canonical endpoint; includes refresh and verification checks.                                      |
| Checkout/preview and payment initiation/verification | 30 per minute by authenticated account and server-resolved tenant.                                                                        |
| Other authenticated mutations                        | 120 per minute by authenticated account/tenant; GETs do not consume this write budget.                                                    |

IPv6 key grouping uses express-rate-limit's supported ipKeyGenerator. Auth route casing or
trailing slash does not create new budgets. Existing 429 envelopes/codes are retained.
A shared-store failure returns controlled 503 RATE_LIMIT_UNAVAILABLE rather than silently
falling back to an unshared limiter. RATE_LIMIT_STORE=auto uses PostgreSQL in production and
memory in development/test. Explicit production memory mode is rejected at startup.

MyFatoorah routes remain outside the generic client-IP limiter. They retain strict 32 KiB
parsing, signature validation, trusted mapping/status verification and durable deduplication.
A valid provider retry burst is tested without 429 or double inventory settlement. Configure
edge abuse limits separately for that provider path, allowing legitimate bursts; do not share
a generic customer/login quota with provider delivery. Internal workers do not use HTTP quotas.

Shared PostgreSQL is the only added operational dependency, already present in this project.
Do not deploy multi-instance production with process-local budgets. Distributed botnets and
network-level floods still require upstream protection; this phase adds no WAF/CAPTCHA service.

## Inputs, uploads and HTTP protections

Valid field names/types and monetary major-unit strings remain unchanged. Zod continues to
strip tolerated unknown properties where schemas already did so; strict payment schemas
still reject forged success fields. The parsed body replaces the raw body for downstream
controllers. Unsafe prototype keys and JSON nesting beyond 64 levels are rejected.

Existing list limits remain capped at 100. The shared pagination page cap is 21,474,836,
keeping page*limit offsets within the database integer range; overflowing inputs now get 400
instead of a database error. Sort/filter allowlists and Prisma parameterization are retained.

BODY_LIMIT defaults to 1 MiB and must parse to a positive finite limit no larger than 16 MiB;
invalid configuration cannot silently disable the parser limit. Upload defaults remain 5 MiB,
with configuration capped at 25 MiB. Multipart limits are one file, 20 fields, 64 KiB per field,
100-byte field names and 22 parts. Existing image MIME and magic-byte validation remain in use.
This is not full image decoding or EXIF stripping; uploaded public catalog media should not
contain private metadata. No image-processing dependency or private-media feature was added.

Storage keys reject traversal, absolute/backslash/encoded paths and root escapes. Realpath
checks prevent deleting through a symlink outside the configured root. Uploads ignore client
filenames, use random server names and exclusive creation. The storage volume/OS account
remains trusted; process permissions and quotas must limit disk use.

Public asset URL fields accept only HTTP(S) without embedded credentials. Existing trusted-admin
banner action deep links are preserved; the Flutter/web client should allowlist executable
navigation schemes. No asset URL is fetched by the backend. MyFatoorah still uses its fixed
sandbox origin and strict hosted URL validation.

Malformed JSON returns controlled 400 MALFORMED_JSON, oversized bodies 413
REQUEST_BODY_TOO_LARGE, unsupported parser encodings 415 UNSUPPORTED_MEDIA_TYPE and upload
limit errors controlled 400/413 envelopes. Missing content type on valid bodyless requests
is not newly forbidden. Sensitive/authenticated responses get Cache-Control: no-store.
Helmet/CORS remain in place; disallowed browser origins receive no allow-origin grant,
while mobile requests without Origin remain compatible. CORS is not authentication.

TRUST_PROXY=false ignores arbitrary forwarded IP headers. Optional TRUST_PROXY_CIDRS accepts
only literal IP/CIDR networks and takes precedence over legacy TRUST_PROXY=true (one hop).
Use the exact ingress networks; never make the backend directly reachable while trusting
arbitrary one-hop forwarding. The existing one-hop mode is retained for compatibility and
requires network enforcement. Broad CIDRs remain an operator-controlled risk.

Production HTTPS must be enforced at the trusted ingress; HSTS/security headers remain enabled.
No blanket redirect/rejection was added that would break local Flutter HTTP development or
legitimate reverse-proxy deployments. Use HTTPS asset URLs in production, correct proxy/TLS
configuration and the existing validated database certificate policy. Real ingress/network
configuration cannot be verified by repository tests and was not accessed.

## Secrets and logging

`.env` remains ignored and unchanged. `.env.example` now contains an explicit JWT placeholder;
production rejects it and the historical public example signing key (checked by fingerprint).
Generate a private environment-specific signing key outside logs. If a deployment used the
old public example, key rotation/sign-in coordination is necessary; no automatic rotation or
blanket session invalidation occurred here. No real gateway/database credentials were added.

Request logs exclude query strings; operational errors log static categories/codes instead
of arbitrary messages. Unexpected exceptions, raw parser bodies and database errors are not
serialized into logs. Redaction covers known token/password/header paths, and request bodies/
queries are redacted. Verification/reset email stubs and seed scripts no longer print passwords
or tokens. Request/user/job IDs remain useful trace context and must be treated as protected
pseudonymous operational data with appropriate access/retention controls.

Development/test seed scripts refuse production or nonlocal PostgreSQL targets before
connecting, preventing accidental provisioning of public development ADMIN credentials.
No existing database/account was examined or changed to remove seed accounts. Audit existing
privileged accounts and rotate any development defaults before a separately authorized rollout.

## Dependencies, workers and migrations

npm audit --omit=dev completed against the registry: **0 production vulnerabilities**.
Full npm audit reported **11 moderate, 0 high, 0 critical** development-tool findings in
ESLint/typescript-eslint/minimatch chains. They affect tooling processing repository/config/glob
input, not the running production API dependency graph. Audit-suggested changes include major
or incompatible tooling changes; no irrelevant dependency churn/downgrade was applied.
Use isolated/time-bounded CI for untrusted changes and review a separate compatible tooling
update. package.json and package-lock.json versions were not changed.

The Phase 4 worker has no new public routes, and tenant/order foreign keys, leases, fencing,
UNKNOWN handling, backoff and shutdown are preserved. It shares secure DB configuration but
is not subject to request middleware. Give runtime roles only the necessary DML privileges;
use a separate migration role without granting CREATE/DROP to HTTP/worker processes.

Migration 16 (`20261103100000_shared_rate_limits`) creates only the new shared budget table/index.
It does not alter historical financial/job/token data. The original 15 migrations remain
unchanged; no database reset or db push is used. Existing upgrade verifiers remain compatible
with the additive migration history.

## Verification, deployment and Flutter compatibility

Apply migration 16 to an explicitly verified target before deploying the API with production
shared rate limits. Configure a private JWT secret, provider/mail transport, approved CORS
origins, exact trusted proxy networks, TLS and DB pool budgets. Start workers separately as
documented in [worker operations](payment-recovery-and-workers.md). No deployment, commit,
push, production access or `.env` switch was performed by this task.

No endpoint/method, request/response field, envelope, token format, monetary representation
or tenant header was removed/renamed. Ordinary authorized Flutter authentication, shopping,
checkout and payments remain compatible. Necessary authorization tightening rejects formerly
unguarded tenant administration and disabled/deleted account tokens. Tenant-management
clients must send the existing Bearer token and hold the documented roles. If Flutter currently
refreshes concurrently, serialize refresh to comply with the existing single-use rotation
contract. Optional issuer/audience enforcement needs a coordinated token rollout.

Deliberately rejected behavior now includes anonymous/foreign tenant administration, role
escalation, replay races, unsafe image paths/URLs, overflowing pagination, malicious prototypes,
malformed/oversized requests and abuse beyond quotas. The registration enumeration response
was specifically left unchanged rather than breaking the authentication contract.

Residual risks: existing registration enumeration and TTL-bounded stateless access tokens;
distributed/network-level abuse; unverified live ingress/provider configuration; unconfigured
real email delivery; trusted-admin deep links/public image metadata; development-only audit
findings. Real Kuwait sandbox verification remains outstanding from Phase 3.

Repository-wide git diff --check initially reports the pre-existing notes.txt blank line at EOF
(line 36). That user edit is unchanged and is not cleaned up by this security phase. Phase 5
files receive their own clean diff check. Todo files are preserved.

Verification: Prisma validate/generate, typecheck, production build, focused ESLint and
Prettier pass. Fresh deployment applies all 16 migrations with no schema drift. Both money
and recovery upgrade verifiers pass, preserving historical values and migration checksums.
The original 15 migration SQL files and user todo/notes files match their pre-Phase-5 snapshots.
No production database was accessed. Full PostgreSQL suite: **853 passed, 0 failed, 0 skipped** across 47 files (789 baseline + 64 new tests).
Focused security/checkout/provider/currency/worker/contracts/tenant/inventory regression results: **664 passed, 0 failed, 0 skipped** across 19 files.

Exact Phase 5 files (generated Prisma output is ignored and regenerated from schema):

- `src/app.ts`
- `src/middleware/upload.middleware.ts`
- `src/middleware/request-logger.middleware.ts`
- `src/middleware/tenant-management.middleware.ts`
- `src/middleware/error.middleware.ts`
- `src/middleware/auth.middleware.ts`
- `src/config/seed-options.ts`
- `src/config/security-options.ts`
- `src/config/env.ts`
- `src/config/rate-limit.ts`
- `src/common/pagination/pagination.ts`
- `src/common/logger/logger.ts`
- `src/common/security/jwt.ts`
- `src/common/security/request-safety.ts`
- `src/common/storage/storage-validation.ts`
- `src/common/storage/local-storage.service.ts`
- `src/common/email/email.service.ts`
- `src/common/rate-limit/postgres-rate-store.ts`
- `src/common/validation/validate.ts`
- `src/modules/payments/payment.routes.ts`
- `src/modules/auth/auth.service.ts`
- `src/modules/auth/email-verification-token.repository.ts`
- `src/modules/auth/refresh-token.repository.ts`
- `src/modules/auth/password-reset.service.ts`
- `src/modules/auth/auth.routes.ts`
- `src/modules/tenants/tenant.schemas.ts`
- `src/modules/tenants/tenant.routes.ts`
- `src/modules/checkout/checkout.routes.ts`
- `src/modules/banners/banner.schemas.ts`
- `src/modules/product-collections/product-collection.schemas.ts`
- `src/modules/product-images/product-image.schemas.ts`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `prisma/seed-test-data.ts`
- `prisma/migrations/20261103100000_shared_rate_limits/migration.sql`
- `tests/payments/myfatoorah.integration.test.ts`
- `tests/security/jwt-policy.test.ts`
- `tests/security/security.integration.test.ts`
- `tests/checkout/checkout.transaction.integration.test.ts`
- `tests/readiness/phase1.api.test.ts`
- `docs/production-database.md`
- `docs/security-hardening.md`
- `docs/testing.md`
- `scripts/verify-recovery-migration.ts`
- `.env.example`
