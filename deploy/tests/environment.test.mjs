import { test } from 'vitest';
import assert from 'node:assert/strict';
import { deploymentIssues, migrationIssues } from '../environment.mjs';
const release = {
  NODE_ENV: 'production',
  PAYMENT_PROVIDER: 'NONE',
  CORS_ORIGINS: 'https://shop.example.com',
};
test('production requires explicit provider selection', () => {
  assert.ok(
    deploymentIssues({ ...release, PAYMENT_PROVIDER: undefined }).length,
  );
});
test('production requires explicit public HTTPS origins', () => {
  for (const origin of [
    undefined,
    'http://shop.example.com',
    'https://localhost',
    'bad',
  ])
    assert.ok(deploymentIssues({ ...release, CORS_ORIGINS: origin }).length);
});
test('configured operational placeholders are refused', () => {
  assert.ok(
    deploymentIssues({ ...release, OPS_METRICS_TOKEN: 'replace-this-token' })
      .length,
  );
});
test('live payment configuration is never activated', () => {
  assert.ok(
    deploymentIssues({
      ...release,
      PAYMENT_PROVIDER: 'MYFATOORAH',
      MYFATOORAH_ENV: 'live',
    }).length,
  );
});
test('sandbox selection must be explicit', () => {
  assert.ok(
    deploymentIssues({ ...release, PAYMENT_PROVIDER: 'MYFATOORAH' }).length,
  );
  assert.deepEqual(
    deploymentIssues({
      ...release,
      PAYMENT_PROVIDER: 'MYFATOORAH',
      MYFATOORAH_ENV: 'sandbox',
    }),
    [],
  );
});
test('NONE release selection is safe and valid', () => {
  assert.deepEqual(deploymentIssues(release), []);
  assert.ok(deploymentIssues({ ...release, NODE_ENV: undefined }).length);
});
const migration = {
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://migration:secret@database.example.com/commerce?sslmode=verify-full',
  EXPECTED_DATABASE_HOST: 'database.example.com',
  EXPECTED_DATABASE_NAME: 'commerce',
  MIGRATION_APPROVED: 'true',
  MIGRATION_BACKUP_VERIFIED: 'true',
};
test('approved exact-target verified-TLS migration passes', () => {
  assert.deepEqual(migrationIssues(migration), []);
  assert.ok(
    migrationIssues({
      ...migration,
      PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: 'true',
    }).length,
  );
});
test('backup and migration approvals are mandatory', () => {
  for (const field of ['MIGRATION_APPROVED', 'MIGRATION_BACKUP_VERIFIED'])
    assert.ok(migrationIssues({ ...migration, [field]: undefined }).length);
});
test('host and database mismatch are rejected', () => {
  for (const field of ['EXPECTED_DATABASE_HOST', 'EXPECTED_DATABASE_NAME'])
    assert.ok(migrationIssues({ ...migration, [field]: 'wrong' }).length);
});
test('production migration rejects unverified TLS', () => {
  assert.ok(
    migrationIssues({
      ...migration,
      DATABASE_URL: 'postgres://user:secret@database.example.com/commerce',
    }).length,
  );
});
test('invalid targets are refused without exposing credentials', () => {
  for (const url of [
    'mysql://user:secret@host/db',
    'not-a-url',
    'postgres://user:secret@host/',
    'postgres://user:secret@host/%broken',
  ]) {
    const result = migrationIssues({ ...migration, DATABASE_URL: url });
    assert.ok(result.length);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
test('local verification permits only explicit nonproduction plaintext setup', () => {
  assert.deepEqual(
    migrationIssues({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://verify:temporary@postgres/commerce_verify',
    }),
    [],
  );
});
