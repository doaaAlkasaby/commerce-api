import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  verificationDatabaseSettings,
  disposableDatabaseIdentifier,
} from './test-postgres.js';

const root = 'prisma/migrations';
const stages = [
  '20261124120000_add_payment_refund_ledger',
  '20261124141000_add_provider_account_identity_and_refund_ops',
  '20261124150000_harden_provider_account_and_refund_integrity',
  '20261124160000_close_migration29_acceptance_gate_blockers',
] as const;
const prefix = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name < stages[0])
  .map((entry) => entry.name)
  .sort();
assert.equal(prefix.length, 26);

const target = new URL(process.env.TEST_DATABASE_URL ?? '');
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
assert.equal(target.port, '5433');
assert.equal(target.pathname, '/commerce_api_test');
const clusterId = execFileSync(
  'docker',
  [
    'exec',
    'commerce-api-postgres-test',
    'sh',
    '-c',
    'LC_ALL=C pg_controldata "$PGDATA"',
  ],
  { encoding: 'utf8' },
).match(/Database system identifier:\s*(\d+)/)?.[1];
assert.ok(clusterId);

async function apply(db: pg.Client, migration: string) {
  await db.query(await readFile(`${root}/${migration}/migration.sql`, 'utf8'));
}
async function rejectUpgrade(
  db: pg.Client,
  migration: string,
  message: RegExp,
) {
  const tables = [
    'Order',
    'Payment',
    'PaymentProviderAccount',
    'PaymentRefund',
    'PaymentRefundAttempt',
    'MyFatoorahInvoice',
    'MyFatoorahRefundWebhookEvent',
  ] as const;
  const evidence = async () => {
    const rows = [];
    for (const table of tables) {
      rows.push(
        (
          await db.query(
            `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
      );
    }
    return rows;
  };
  const before = await evidence();
  await assert.rejects(apply(db, migration), { code: '23514', message });
  assert.deepEqual(await evidence(), before);
}

const snapshot = (db: pg.Client) =>
  db
    .query(
      `
  SELECT o."tenantId", o."userId", o.id AS "orderId", o."totalAmount"::text, o."paymentStatus",
         p.id, p.amount::text, p.currency, p.status, p.provider, p."providerPaymentId", p."providerTransactionId"
  FROM "Order" o JOIN "Payment" p ON p."orderId" = o.id WHERE p.id <> 'bound-payment' ORDER BY p.id
`,
    )
    .then(({ rows }) => rows);

async function fixtures(db: pg.Client) {
  await db.query(
    'INSERT INTO "Tenant" (id,name,slug,code,"updatedAt") VALUES ($1,$2,$1,$1,now())',
    ['fixture-tenant', 'Historical fixture'],
  );
  await db.query(
    'INSERT INTO "User" (id,email,"passwordHash","firstName","lastName","updatedAt") VALUES ($1,$2,$3,$4,$4,now())',
    [
      'fixture-user',
      'historical@example.test',
      'unused-fixture-hash',
      'Historical',
    ],
  );
  for (const [index, status, amount, currency] of [
    [1, 'PENDING', '17.003', 'KWD'],
    [2, 'PAID', '29.551', 'KWD'],
    [3, 'CANCELLED', '12.67', 'USD'],
  ] as const) {
    await db.query(
      `INSERT INTO "Order" (id,"orderNumber","tenantId","userId","paymentStatus",currency,subtotal,"discountAmount","shippingAmount","taxAmount","totalAmount","shippingAddress","billingAddress","updatedAt")
      VALUES ($1,$1,$2,$3,$4,$5,$6,0,0,0,$6,'{}','{}',now())`,
      [
        `order-${index}`,
        'fixture-tenant',
        'fixture-user',
        status,
        currency,
        amount,
      ],
    );
    await db.query(
      `INSERT INTO "Payment" (id,"orderId",provider,method,status,amount,currency,"providerPaymentId","providerTransactionId","updatedAt")
      VALUES ($1,$2,'MYFATOORAH','CARD',$3,$4,$5,$6,$7,now())`,
      [
        `payment-${index}`,
        `order-${index}`,
        status,
        amount,
        currency,
        `invoice-${index}`,
        index === 2 ? 'captured-2' : null,
      ],
    );
  }
}

async function refund(db: pg.Client) {
  await db.query(
    `INSERT INTO "PaymentRefund" (id,"tenantId","paymentId","orderId",provider,method,amount,currency,status,"idempotencyKey","requestFingerprint",reason,"requestedByUserId","updatedAt")
    VALUES ($1,$2,$3,$4,'MYFATOORAH','CARD',1.005,'KWD','REQUESTED',$1,$1,'Historical fixture',$5,now())`,
    ['refund', 'fixture-tenant', 'payment-2', 'order-2', 'fixture-user'],
  );
}
async function attempt(db: pg.Client, state: string) {
  await db.query(
    `INSERT INTO "PaymentRefundAttempt" (id,"tenantId","paymentId","orderId","refundId",provider,"attemptNumber",operation,state,"correlationId","requestFingerprint","updatedAt")
    VALUES ($1,$2,$3,$4,$5,'MYFATOORAH',1,'SUBMIT_REFUND',$6,$1,$1,now())`,
    ['attempt', 'fixture-tenant', 'payment-2', 'order-2', 'refund', state],
  );
}
const hasColumn = async (db: pg.Client, table: string, name: string) =>
  (
    await db.query(
      'select 1 from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3',
      ['public', table, name],
    )
  ).rowCount === 1;

for (const scenario of [
  'valid',
  'invalid-29-state',
  'invalid-29-invoice',
  'invalid-30-dispatch',
  'invalid-30-linkage',
] as const) {
  const setup = verificationDatabaseSettings(process.env);
  const identifier = disposableDatabaseIdentifier(setup.databaseName);
  const admin = new pg.Client({ connectionString: setup.adminUrl });
  const db = new pg.Client({ connectionString: setup.env.DATABASE_URL });
  let created = false;
  try {
    await admin.connect();
    assert.equal(
      (
        await admin.query(
          'select system_identifier::text as id from pg_control_system()',
        )
      ).rows[0].id,
      clusterId,
    );
    assert.equal(
      (
        await admin.query(
          "select 1 from pg_database where datname='commerce_api'",
        )
      ).rowCount,
      0,
    );
    await admin.query(`CREATE DATABASE ${identifier}`);
    created = true;
    await db.connect();
    assert.equal(
      (await db.query('select current_database() as name')).rows[0].name,
      setup.databaseName,
    );
    for (const migration of prefix) await apply(db, migration);
    assert.equal(
      (await db.query('select to_regclass($1) as present', ['"PaymentRefund"']))
        .rows[0].present,
      null,
    );
    assert.equal(await hasColumn(db, 'Payment', 'providerAccountId'), false);
    await fixtures(db);
    const before = await snapshot(db);
    assert.equal(before.length, 3);
    await apply(db, stages[0]);
    await refund(db);
    assert.deepEqual(await snapshot(db), before);
    await apply(db, stages[1]);
    await attempt(
      db,
      scenario === 'invalid-29-state' ? 'SUCCEEDED' : 'PREPARED',
    );
    assert.equal(
      (
        await db.query(
          'select count(*)::int as n from "Payment" where "providerAccountId" is null and "providerEnvironment" is null',
        )
      ).rows[0].n,
      3,
    );
    await db.query(
      `INSERT INTO "PaymentProviderAccount" (id,provider,environment,"accountKey","ownerTenantId","countryCode",currency,status,"updatedAt")
      VALUES ($1,'MYFATOORAH','SANDBOX',$1,$2,'KW','KWD','ACTIVE',now())`,
      ['fixture-account', 'fixture-tenant'],
    );
    await db.query(
      `INSERT INTO "PaymentProviderAccountTenant" ("tenantId","providerAccountId",provider,environment)
      VALUES ($1,$2,'MYFATOORAH','SANDBOX')`,
      ['fixture-tenant', 'fixture-account'],
    );
    await db.query(
      `INSERT INTO "Order" (id,"orderNumber","tenantId","userId",currency,subtotal,"discountAmount","shippingAmount","taxAmount","totalAmount","shippingAddress","billingAddress","updatedAt")
      VALUES ($1,$1,$2,$3,'KWD',17.003,0,0,0,17.003,'{}','{}',now())`,
      ['bound-order', 'fixture-tenant', 'fixture-user'],
    );
    await db.query(
      `INSERT INTO "Payment" (id,"orderId",provider,method,amount,currency,"providerAccountId","providerEnvironment","updatedAt")
      VALUES ($1,$2,'MYFATOORAH','CARD',17.003,'KWD',$3,'SANDBOX',now())`,
      ['bound-payment', 'bound-order', 'fixture-account'],
    );
    if (scenario === 'invalid-29-invoice') {
      await db.query(
        `INSERT INTO "MyFatoorahInvoice" ("paymentId","invoiceId","providerAccountId","providerEnvironment")
        VALUES ($1,$2,$3,'SANDBOX')`,
        ['payment-2', 'mismatched-invoice', 'fixture-account'],
      );
      await rejectUpgrade(
        db,
        stages[2],
        /Migration 29 preflight failed \[S-2\]/,
      );
      assert.equal(
        await hasColumn(db, 'PaymentProviderAccount', 'providerMerchantCode'),
        false,
      );
      assert.deepEqual(await snapshot(db), before);
      console.log(
        'Migration 29 rejected a formerly valid invoice with mismatched provider-account identity.',
      );
      continue;
    }
    assert.deepEqual(await snapshot(db), before);
    if (scenario === 'invalid-29-state') {
      await rejectUpgrade(
        db,
        stages[2],
        /Migration 29 preflight failed \[S-4\]/,
      );
      assert.equal(
        await hasColumn(db, 'PaymentProviderAccount', 'providerMerchantCode'),
        false,
      );
      assert.deepEqual(await snapshot(db), before);
      console.log(
        'Migration 29 rejected a previously accepted attempt lacking dispatch evidence.',
      );
      continue;
    }
    await apply(db, stages[2]);
    if (scenario === 'invalid-30-dispatch') {
      for (const number of [2, 3]) {
        await db.query(
          `INSERT INTO "PaymentRefundAttempt" (id,"tenantId","paymentId","orderId","refundId",provider,"attemptNumber",operation,state,"correlationId","requestFingerprint","dispatchedAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,'MYFATOORAH',$6,'SUBMIT_REFUND','DEFINITIVELY_FAILED',$1,$1,now(),now())`,
          [
            `retry-${number}`,
            'fixture-tenant',
            'payment-2',
            'order-2',
            'refund',
            number,
          ],
        );
      }
      await rejectUpgrade(
        db,
        stages[3],
        /already have multiple dispatched SUBMIT_REFUND attempts/,
      );
      assert.equal(
        await hasColumn(db, 'Payment', 'reconciliationFlaggedAt'),
        false,
      );
      assert.deepEqual(await snapshot(db), before);
      console.log(
        'Migration 30 rejected multiple previously accepted dispatched attempts.',
      );
      continue;
    }
    if (scenario === 'invalid-30-linkage') {
      await db.query(
        `INSERT INTO "MyFatoorahRefundWebhookEvent" (id,provider,"tenantId","orderId","eventCode","eventName","eventReference","payloadFingerprint","signatureStatus","updatedAt")
        VALUES ($1,'MYFATOORAH',$2,$3,1,$1,$1,$1,'VALID',now())`,
        ['legacy-event', 'fixture-tenant', 'order-1'],
      );
      await rejectUpgrade(
        db,
        stages[3],
        /Migration 30 preflight failed \[B-5\]/,
      );
      assert.equal(
        await hasColumn(db, 'Payment', 'reconciliationFlaggedAt'),
        false,
      );
      assert.deepEqual(await snapshot(db), before);
      console.log(
        'Migration 30 rejected a previously accepted incomplete webhook linkage.',
      );
      continue;
    }
    await apply(db, stages[3]);
    assert.deepEqual(
      (
        await db.query(
          'select "providerAccountId","providerEnvironment",amount::text from "Payment" where id=$1',
          ['bound-payment'],
        )
      ).rows,
      [
        {
          providerAccountId: 'fixture-account',
          providerEnvironment: 'SANDBOX',
          amount: '17.0030',
        },
      ],
    );
    assert.deepEqual(await snapshot(db), before);
    assert.deepEqual(
      (
        await db.query(
          'select "tenantId","orderId","paymentId",amount::text,"providerAccountId" from "PaymentRefund"',
        )
      ).rows,
      [
        {
          tenantId: 'fixture-tenant',
          orderId: 'order-2',
          paymentId: 'payment-2',
          amount: '1.0050',
          providerAccountId: null,
        },
      ],
    );
    assert.deepEqual(
      (
        await db.query(
          'select "refundId",state,"providerAccountId" from "PaymentRefundAttempt"',
        )
      ).rows,
      [{ refundId: 'refund', state: 'PREPARED', providerAccountId: null }],
    );
    await assert.rejects(
      db.query('update "Payment" set "providerTransactionId"=$1 where id=$2', [
        'replacement',
        'payment-2',
      ]),
      { code: '23514', message: /cannot be erased or replaced/ },
    );
    execFileSync(
      'node_modules/.bin/prisma',
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
        '--config',
        'prisma7.config.ts',
      ],
      { env: setup.env, stdio: 'inherit' },
    );
    console.log(
      'Historical payments, refund and attempt preserved; payment evidence guard verified.',
    );
  } finally {
    try {
      await db.end();
    } finally {
      try {
        if (created) {
          await admin.query(`DROP DATABASE ${identifier} WITH (FORCE)`);
          assert.equal(
            (
              await admin.query('select 1 from pg_database where datname=$1', [
                setup.databaseName,
              ])
            ).rowCount,
            0,
          );
          console.log(
            `Removed and verified disposable database for ${scenario}.`,
          );
        }
      } finally {
        await admin.end();
      }
    }
  }
}
