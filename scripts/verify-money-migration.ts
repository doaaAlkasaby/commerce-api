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

// Only the UUID database created by this invocation is ever changed or dropped.
const settings = verificationDatabaseSettings(process.env);
const admin = new pg.Client({ connectionString: settings.adminUrl });
const folder = await mkdtemp(join(tmpdir(), 'commerce-money-upgrade-'));
const config = resolve('prisma', `.money-upgrade-${randomUUID()}.config.ts`);
const migrationRoot = resolve('prisma/migrations');
const migrationName = '20261101100000_currency_aware_money';
let created = false;
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: settings.env.DATABASE_URL }),
});
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
        : fail(new Error(`Prisma verification failed (${code})`)),
    );
  });
try {
  await admin.connect();
  await admin.query(
    `CREATE DATABASE ${disposableDatabaseIdentifier(settings.databaseName)}`,
  );
  created = true;
  const previous = (await readdir(migrationRoot)).filter(
    (name) => name === 'migration_lock.toml' || name < migrationName,
  );
  const hashes = new Map<string, string>();
  for (const name of previous) {
    await cp(join(migrationRoot, name), join(folder, name), {
      recursive: true,
    });
    if (name !== 'migration_lock.toml')
      hashes.set(
        name,
        createHash('sha256')
          .update(await readFile(join(migrationRoot, name, 'migration.sql')))
          .digest('hex'),
      );
  }
  assert.equal(hashes.size, 13);
  await writeFile(
    config,
    `import {defineConfig} from 'prisma/config'; export default defineConfig({schema:${JSON.stringify(resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(folder)}},datasource:{url:process.env.DATABASE_URL!}});`,
  );
  await command(['migrate', 'deploy', '--config', config]);
  const tenant = await client.tenant.create({
    data: {
      name: 'Historical money',
      slug: randomUUID(),
      code: randomUUID(),
      defaultCurrency: 'USD',
    },
  });
  const category = await client.category.create({
    data: { tenantId: tenant.id, name: 'History', slug: randomUUID() },
  });
  const product = await client.product.create({
    data: {
      tenantId: tenant.id,
      categoryId: category.id,
      name: 'Historical price',
      slug: randomUUID(),
      basePrice: '9999999999.99',
      discountType: 'PERCENTAGE',
      discountValue: '12.50',
    },
  });
  const variant = await client.productVariant.create({
    data: {
      productId: product.id,
      sku: randomUUID(),
      combinationKey: 'default',
      price: '12.34',
    },
  });
  const user = await client.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      passwordHash: 'not-a-login',
      firstName: 'Historical',
      lastName: 'Money',
    },
  });
  const order = await client.order.create({
    select: { id: true },
    data: {
      tenantId: tenant.id,
      userId: user.id,
      orderNumber: randomUUID(),
      currency: 'USD',
      subtotal: '12.34',
      discountAmount: '1.00',
      shippingAmount: '2.00',
      taxAmount: '0.57',
      totalAmount: '13.91',
      shippingAddress: { historical: true },
      billingAddress: { historical: true },
      items: {
        create: {
          productId: product.id,
          variantId: variant.id,
          productName: 'Historical',
          sku: variant.sku,
          quantity: 1,
          unitPrice: '12.34',
          itemDiscountAmount: '1',
          finalUnitPrice: '11.34',
          totalPrice: '11.34',
          taxableAmount: '11.34',
          taxAmount: '0.57',
          taxRate: '5',
          variantSnapshot: { historical: true },
        },
      },
      payments: {
        create: {
          provider: 'NONE',
          method: 'CASH_ON_DELIVERY',
          amount: '13.91',
          currency: 'USD',
          metadata: { historical: true },
        },
      },
    },
  });
  const snapshot = async () =>
    JSON.stringify({
      product: await client.product.findUnique({ where: { id: product.id } }),
      variant: await client.productVariant.findUnique({
        where: { id: variant.id },
      }),
      order:
        await client.$queryRaw`SELECT to_jsonb(o)-'reservationExpiresAt' AS snapshot FROM "Order" o WHERE o."id"=${order.id}`,
      items: await client.orderItem.findMany({
        where: { orderId: order.id },
        orderBy: { id: 'asc' },
      }),
      payments: await client.payment.findMany({
        where: { orderId: order.id },
        orderBy: { id: 'asc' },
      }),
    });
  const before = await snapshot();
  const history = await client.$queryRaw<
    Array<{ migration_name: string; checksum: string }>
  >`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name`;
  await command(['migrate', 'deploy', '--config', 'prisma7.config.ts']);
  assert.equal(
    await snapshot(),
    before,
    'Historical values, timestamps and snapshots must remain unchanged',
  );
  const after = await client.$queryRaw<
    Array<{ migration_name: string; checksum: string }>
  >`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name`;
  assert.equal(
    after.length,
    (await readdir(migrationRoot)).filter(
      (name) => name !== 'migration_lock.toml',
    ).length,
  );
  for (const entry of history)
    assert.deepEqual(
      after.find((row) => row.migration_name === entry.migration_name),
      entry,
    );
  for (const [name, hash] of hashes)
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(migrationRoot, name, 'migration.sql')))
        .digest('hex'),
      hash,
    );
  await client.productVariant.update({
    where: { id: variant.id },
    data: { price: '0.0001' },
  });
  assert.equal(
    (
      await client.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
      })
    ).price?.toFixed(4),
    '0.0001',
  );
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
    'PASS: 13 -> 14 upgrade; historical money/snapshots unchanged; 13 old checksums unchanged; four-decimal storage verified; no schema drift.',
  );
} finally {
  await client.$disconnect();
  if (created) {
    await admin.query(
      `DROP DATABASE ${disposableDatabaseIdentifier(settings.databaseName)} WITH (FORCE)`,
    );
    console.log('Removed disposable monetary upgrade database.');
  }
  await admin.end();
  await rm(folder, { recursive: true, force: true });
  await rm(config, { force: true });
}
