import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {
  mkdtemp,
  readdir,
  readFile,
  cp,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  verificationDatabaseSettings,
  disposableDatabaseIdentifier,
} from './test-postgres.js';

const settings = verificationDatabaseSettings(process.env);
const admin = new pg.Client({ connectionString: settings.adminUrl });
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: settings.env.DATABASE_URL }),
});
const folder = await mkdtemp(join(tmpdir(), 'commerce-recovery-upgrade-'));
const config = resolve('prisma', `.recovery-upgrade-${randomUUID()}.config.ts`);
const root = resolve('prisma/migrations');
const migration = '20261102100000_payment_recovery';
let created = false;
const command = (args: string[]) =>
  new Promise<void>((ok, fail) => {
    const child = spawn('node_modules/.bin/prisma', args, {
      env: settings.env,
      stdio: 'inherit',
    });
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0
        ? ok()
        : fail(new Error(`Recovery upgrade check failed (${code})`)),
    );
  });
try {
  await admin.connect();
  await admin.query(
    `CREATE DATABASE ${disposableDatabaseIdentifier(settings.databaseName)}`,
  );
  created = true;
  const previous = (await readdir(root)).filter(
    (name) => name === 'migration_lock.toml' || name < migration,
  );
  const hashes = new Map<string, string>();
  for (const name of previous) {
    await cp(join(root, name), join(folder, name), { recursive: true });
    if (name !== 'migration_lock.toml')
      hashes.set(
        name,
        createHash('sha256')
          .update(await readFile(join(root, name, 'migration.sql')))
          .digest('hex'),
      );
  }
  assert.equal(hashes.size, 14);
  await writeFile(
    config,
    `import {defineConfig} from 'prisma/config';export default defineConfig({schema:${JSON.stringify(resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(folder)}},datasource:{url:process.env.DATABASE_URL!}});`,
  );
  await command(['migrate', 'deploy', '--config', config]);
  const tenant = await client.tenant.create({
    data: {
      name: 'Historical recovery',
      slug: randomUUID(),
      code: randomUUID(),
      defaultCurrency: 'KWD',
    },
  });
  const user = await client.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      passwordHash: 'not-a-login',
      firstName: 'Historical',
      lastName: 'Recovery',
    },
  });
  const category = await client.category.create({
    data: { tenantId: tenant.id, name: 'Historical', slug: randomUUID() },
  });
  const product = await client.product.create({
    data: {
      tenantId: tenant.id,
      categoryId: category.id,
      name: 'Historical',
      slug: randomUUID(),
      basePrice: '12.345',
    },
  });
  const variant = await client.productVariant.create({
    data: {
      productId: product.id,
      sku: randomUUID(),
      combinationKey: 'default',
    },
  });
  const inventory = await client.inventory.create({
    data: { variantId: variant.id, quantity: 10, reservedQuantity: 1 },
  });
  const orderId = randomUUID();
  await client.$executeRaw`INSERT INTO "Order" ("id","tenantId","userId","orderNumber","currency","subtotal","discountAmount","shippingAmount","taxAmount","totalAmount","shippingAddress","billingAddress","createdAt","updatedAt")
    VALUES (${orderId},${tenant.id},${user.id},${randomUUID()},'KWD',12.345,0,0,0,12.345,'{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp())`;
  await client.payment.create({
    data: {
      orderId,
      provider: 'MYFATOORAH',
      method: 'CARD',
      amount: '12.345',
      currency: 'KWD',
      initiationState: 'UNKNOWN',
      metadata: { historical: true },
    },
  });
  await client.inventoryTransaction.create({
    data: {
      inventoryId: inventory.id,
      type: 'RESERVATION',
      quantity: 1,
      referenceId: orderId,
    },
  });
  const snapshot = () => client.$queryRaw<
    Array<{ order: unknown; payments: unknown; inventory: unknown }>
  >`
    SELECT to_jsonb(o)-'reservationExpiresAt' AS "order",
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p."id") FROM "Payment" p WHERE p."orderId"=o."id") AS payments,
      (SELECT to_jsonb(i) FROM "Inventory" i WHERE i."id"=${inventory.id}) AS inventory
      FROM "Order" o WHERE o."id"=${orderId}`;
  const before = await snapshot();
  const history = await client.$queryRaw<
    Array<{ migration_name: string; checksum: string }>
  >`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name`;
  await command(['migrate', 'deploy', '--config', 'prisma7.config.ts']);
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await client.order.findUniqueOrThrow({ where: { id: orderId } }))
      .reservationExpiresAt,
    null,
  );
  assert.equal(await client.recoveryJob.count(), 0);
  const after = await client.$queryRaw<
    Array<{ migration_name: string; checksum: string }>
  >`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name`;
  assert.equal(
    after.length,
    (await readdir(root)).filter((name) => name !== 'migration_lock.toml')
      .length,
  );
  for (const row of history)
    assert.deepEqual(
      after.find((entry) => entry.migration_name === row.migration_name),
      row,
    );
  for (const [name, hash] of hashes)
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(root, name, 'migration.sql')))
        .digest('hex'),
      hash,
    );
  await client.recoveryJob.create({ data: { tenantId: tenant.id, orderId } });
  await command([
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
    '--config',
    'prisma7.config.ts',
  ]);
  console.log(
    'PASS: 14 -> 15 recovery upgrade; historical exact KWD/payment/inventory values unchanged; legacy deadline NULL; no inferred jobs; 14 original checksums unchanged; drift empty.',
  );
} finally {
  await client.$disconnect();
  if (created) {
    await admin.query(
      `DROP DATABASE ${disposableDatabaseIdentifier(settings.databaseName)} WITH (FORCE)`,
    );
    console.log('Removed disposable recovery upgrade database.');
  }
  await admin.end();
  await rm(folder, { recursive: true, force: true });
  await rm(config, { force: true });
}
