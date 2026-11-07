import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

describe('forward-only warehouse inventory migration', () => {
  const schema = `phase8_upgrade_${randomUUID().replaceAll('-', '')}`;
  let client: pg.Client;
  let created = false;
  beforeAll(async () => {
    const value = process.env.TEST_DATABASE_URL;
    if (!value || !new URL(value).pathname.toLowerCase().includes('test'))
      throw new Error('A disposable PostgreSQL test database is required');
    client = new pg.Client({
      connectionString: value,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    // The identifier consists exclusively of our fixed prefix and UUID hex.
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    const directories = (await readdir('prisma/migrations'))
      .filter(
        (name) =>
          /^\d/.test(name) && name < '20261107180000_warehouse_inventory',
      )
      .sort();
    for (const directory of directories)
      await client.query(
        await readFile(`prisma/migrations/${directory}/migration.sql`, 'utf8'),
      );
  }, 20000);
  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  });
  it('rolls back an unmapped upgrade and preserves original stock and reservations after explicit mapping', async () => {
    await client.query(`
      INSERT INTO "Country" ("id","code","name","currencyCode","updatedAt") VALUES ('country','KW','Fixture country','KWD',now());
      INSERT INTO "Tenant" ("id","name","slug","code","defaultCountryCode","defaultCurrency","updatedAt") VALUES ('tenant','Fixture','fixture','fixture','KW','KWD',now());
      INSERT INTO "User" ("id","email","passwordHash","firstName","lastName","updatedAt") VALUES ('user','migration@example.test','unused','Test','Buyer',now());
      INSERT INTO "Category" ("id","tenantId","name","slug","updatedAt") VALUES ('category','tenant','Fixture','fixture',now());
      INSERT INTO "Product" ("id","tenantId","categoryId","name","slug","basePrice","updatedAt") VALUES ('product','tenant','category','Fixture','fixture',10,now());
      INSERT INTO "ProductVariant" ("id","productId","sku","combinationKey","updatedAt") VALUES ('variant','product','fixture','',now());
      INSERT INTO "Inventory" ("id","variantId","quantity","reservedQuantity","updatedAt") VALUES ('original-stock','variant',7,2,now());
      INSERT INTO "Order" ("id","tenantId","orderNumber","userId","currency","subtotal","discountAmount","shippingAmount","taxAmount","totalAmount","shippingAddress","billingAddress","updatedAt") VALUES ('order','tenant','fixture','user','KWD',20,0,0,0,20,'{}','{}',now());
      INSERT INTO "InventoryTransaction" ("id","inventoryId","type","quantity","referenceId") VALUES ('reservation','original-stock','RESERVATION',2,'order');
    `);
    const migration = await readFile(
      'prisma/migrations/20261107180000_warehouse_inventory/migration.sql',
      'utf8',
    );
    await expect(client.query(migration)).rejects.toThrow(
      'Configure an active default warehouse',
    );
    await client.query('ROLLBACK');
    expect(
      (
        await client.query(
          'SELECT "quantity", "reservedQuantity" FROM "Inventory"',
        )
      ).rows,
    ).toEqual([{ quantity: 7, reservedQuantity: 2 }]);
    expect(
      (
        await client.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',
          [schema, 'Inventory', 'warehouseId'],
        )
      ).rows,
    ).toEqual([]);
    await client.query(
      `INSERT INTO "Warehouse" ("id","tenantId","code","name","countryCode","city","address","isDefault","updatedAt") VALUES ('source','tenant','source','Configured source','KW','Fixture city','Explicit address',true,now())`,
    );
    await client.query(migration);
    expect(
      (
        await client.query(
          'SELECT "id", "tenantId", "warehouseId", "quantity", "reservedQuantity" FROM "Inventory"',
        )
      ).rows,
    ).toEqual([
      {
        id: 'original-stock',
        tenantId: 'tenant',
        warehouseId: 'source',
        quantity: 7,
        reservedQuantity: 2,
      },
    ]);
    expect(
      (
        await client.query(
          'SELECT "inventoryId", "quantity", "referenceId" FROM "InventoryTransaction"',
        )
      ).rows,
    ).toEqual([
      { inventoryId: 'original-stock', quantity: 2, referenceId: 'order' },
    ]);
    expect(
      (
        await client.query(
          'SELECT "currency", "totalAmount"::text, "warehouseId" FROM "Order"',
        )
      ).rows,
    ).toEqual([{ currency: 'KWD', totalAmount: '20.0000', warehouseId: null }]);
    await expect(
      client.query(
        `UPDATE "Inventory" SET "reservedQuantity"=8 WHERE "id"='original-stock'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await client.query(
      `INSERT INTO "Warehouse" ("id","tenantId","code","name","countryCode","city","address","updatedAt") VALUES ('second-source','tenant','second','Second source','KW','Fixture city','Another explicit address',now())`,
    );
    await expect(
      client.query(
        `UPDATE "Inventory" SET "warehouseId"='second-source' WHERE "id"='original-stock'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
