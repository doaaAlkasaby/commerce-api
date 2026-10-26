# Commerce API - Codex Instructions

## Project

Production-style multi-tenant e-commerce REST API.

## Stack

- Node.js
- TypeScript
- Express 5
- PostgreSQL
- Prisma
- Zod
- Vitest
- Pino
- Redis/BullMQ
- JWT using jose

## Architecture

HTTP Request
→ Controller
→ Service
→ Repository
→ Prisma
→ PostgreSQL

## Rules

- Do not introduce ServiceImpl classes.
- Keep business logic in services.
- Keep database access in repositories.
- Controllers should remain thin.
- Validate requests using Zod.
- Use tenant context for tenant-owned resources.
- Never trust tenantId from request body.
- Use X-Tenant-Slug for tenant resolution.
- Tenant isolation must be enforced in repositories.
- Use BigInt cents for money calculations where applicable.
- Do not let clients control server-owned currency.
- Checkout must be idempotent.
- Inventory reservation must be concurrency-safe.
- Payment integration must remain separate from checkout calculation.
- Snapshot mutable product, tax, shipping and payment-related data into orders.
- Do not modify architecture decisions without explaining the impact first.

## Multi-tenancy

A user may belong to multiple tenants.

Tenant-owned resources include:

- products
- categories
- brands
- carts
- orders
- coupons
- inventory
- shipping
- tax
- reviews
- banners
- app settings

Public product browsing requires tenant context but does not require authentication.

Authenticated tenant operations use:

tenantMiddleware
→ authenticate
→ tenantMemberMiddleware
→ requireTenantRoles

## Current checkout decisions

Inventory is reserved during checkout.

COD:
reserve inventory → create order → proceed according to COD rules.

Online payment:
reserve inventory
→ create pending payment
→ payment succeeds
→ convert reservation to SALE

Payment failure/expiration:
release reservation.

## Important

Before modifying code:

1. Inspect the current repository.
2. Do not assume the repository matches old uploaded files.
3. Search for existing implementations before creating new ones.
4. Preserve existing architecture unless there is a strong reason to change it.
5. Run relevant tests after changes.
6. Report files changed and tests executed.