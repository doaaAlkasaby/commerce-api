# Modular development fixtures

These modules use the current generated Prisma client and require an explicitly
selected tenant ID for tenant-owned records. Inventory additionally requires a
warehouse ID belonging to that tenant. They reject production and remote targets.

`npm run db:seed` continues to run `prisma/development/cli.ts`; it does not invoke
these modules. Importing a module does not run the seed CLI or connect to a database.

When composing these fixtures, create the tenant and warehouse first, then call:

1. `seedCountries(prisma)`
2. `seedUsers(prisma, tenantId)` and `seedAddresses(customers, prisma)`
3. `seedCategories(prisma, tenantId)` and `seedBrands(prisma, tenantId)`
4. `seedProducts(categories, brands, prisma, tenantId)`
5. `seedProductAttributesAndVariants(products, prisma, tenantId)` and
   `seedDefaultVariants(products, prisma, tenantId)`
6. The remaining tenant fixtures, passing `tenantId` as their final argument;
   inventory uses `seedInventory(prisma, tenantId, warehouseId)`.

The shipping and tax fixtures describe Egypt and use the configured country's
currency. Orders and application settings use the tenant's configured currency.
Repeated inventory seeding preserves existing quantities and reservations.

The example.com users retain the password configured in `users.seed.ts`. They are
separate from the `@dev81.example.test` accounts created by the active development
seed command. Editing this module does not change passwords in the database.

Run `npm run typecheck:seed` to check every seed module. The disposable PostgreSQL
runner can verify all modules, tenant isolation, and repeated runs:

```sh
npm run test:postgres -- tests/seeds/legacy-seeds.integration.test.ts
```
