/* global process, console, fetch, AbortSignal */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const project = `commerce-verify-${randomBytes(6).toString('hex')}`;
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  VERIFY_DB_PASSWORD: randomBytes(32).toString('hex'),
  VERIFY_JWT_SECRET: randomBytes(32).toString('hex'),
  VERIFY_METRICS_TOKEN: randomBytes(32).toString('hex'),
  VERIFY_HTTP_PORT: '0',
};
function docker(args, capture = false, allowFailure = false) {
  const result = spawnSync('docker', args, {
    env: environment,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 600000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || (!allowFailure && result.status !== 0))
    throw new Error(
      `Docker verification command failed: ${args.slice(0, 3).join(' ')}`,
    );
  return result;
}
const compose = (args, capture = false) =>
  docker(
    ['compose', '-f', 'compose.verify.yml', '-p', project, ...args],
    capture,
  );
const endpoint = docker(
  ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
  true,
).stdout.trim();
if (
  (environment.DOCKER_HOST &&
    !/^(unix|npipe):/.test(environment.DOCKER_HOST)) ||
  !/^(unix|npipe):/.test(endpoint)
)
  throw new Error('Verification requires a local Docker engine');
console.log(`Local disposable container verification project: ${project}`);
let started = false;
try {
  compose(['config', '--quiet']);
  compose(['build', 'api', 'migrate']);
  started = true;
  compose([
    'up',
    '-d',
    '--no-build',
    '--wait',
    '--wait-timeout',
    '150',
    'api',
    'worker',
  ]);
  const address = compose(['port', 'api', '3000'], true).stdout.trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${address}`;
  for (const path of [
    '/ops/live',
    '/ops/ready',
    '/api/v1/health',
    '/api/v1/ready',
  ]) {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200, path);
  }
  assert.equal((await fetch(origin + '/ops/metrics')).status, 401);
  const metric = await fetch(origin + '/ops/metrics', {
    headers: { authorization: `Bearer ${environment.VERIFY_METRICS_TOKEN}` },
  });
  assert.equal(metric.status, 200);
  const text = await metric.text();
  assert.match(text, /commerce_worker_backlog/);
  assert.doesNotMatch(
    text,
    /^commerce_worker_running /m,
    'API must not run the worker',
  );
  const api = compose(['ps', '-q', 'api'], true).stdout.trim();
  const worker = compose(['ps', '-q', 'worker'], true).stdout.trim();
  for (const container of [api, worker]) {
    assert.equal(
      docker(
        ['exec', container, 'node', '-e', 'console.log(process.getuid())'],
        true,
      ).stdout.trim(),
      '1000',
    );
    docker([
      'exec',
      container,
      'node',
      '--input-type=module',
      '-e',
      "import fs from 'node:fs';for(const p of ['.env','src','tests','prisma','node_modules/typescript','node_modules/prisma'])if(fs.existsSync(p))process.exit(1)",
    ]);
  }
  docker([
    'exec',
    worker,
    'node',
    '--input-type=module',
    '-e',
    "const r=await fetch('http://127.0.0.1:3001/ops/ready');if(!r.ok)process.exit(1);try{await fetch('http://127.0.0.1:3000/ops/live');process.exit(1)}catch{}",
  ]);
  // Idempotent second explicit migration invocation, never alongside a migration job.
  compose(['run', '--rm', '--no-deps', 'migrate']);
  compose(['stop', '-t', '45', 'api', 'worker']);
  for (const container of [api, worker])
    assert.equal(
      docker(
        ['inspect', '--format', '{{.State.ExitCode}}', container],
        true,
      ).stdout.trim(),
      '0',
    );
  const refused = docker(
    [
      'run',
      '--rm',
      '-e',
      'NODE_ENV=production',
      '-e',
      'PAYMENT_PROVIDER=MYFATOORAH',
      '-e',
      'MYFATOORAH_ENV=live',
      '-e',
      'CORS_ORIGINS=https://example.invalid',
      `commerce-api:${project}`,
    ],
    true,
    true,
  );
  assert.equal(
    refused.status,
    1,
    'Live selection must fail before application startup',
  );
  const gated = docker(
    [
      'run',
      '--rm',
      '-e',
      'NODE_ENV=production',
      '-e',
      'DATABASE_URL=postgres://fake:fake@invalid.example/database',
      `commerce-migrate:${project}`,
    ],
    true,
    true,
  );
  assert.equal(
    gated.status,
    1,
    'Unapproved production migration must not connect',
  );
  console.log(
    'PASS: runtime image, non-root, minimal contents, HTTP/worker separation, readiness, protected metrics, migration repeat, graceful shutdown, deployment gates.',
  );
} finally {
  if (started) compose(['down', '--timeout', '45']);
  console.log(
    `Volumes retained intentionally: ${project}_verify_postgres and ${project}_uploads. No volume/database deletion performed.`,
  );
}
