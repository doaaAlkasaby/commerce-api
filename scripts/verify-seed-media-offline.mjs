import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import http from 'node:http';

// macOS verification only: an OS sandbox denies external traffic in the child.
// The API and its normal test suite do not depend on sandbox-exec.
if (process.platform !== 'darwin')
  throw new Error(
    'This offline harness requires macOS sandbox-exec; use a loopback-only network namespace on other platforms.',
  );
await readFile('dist/app.js'); // Build first; never test a source import accidentally.
const assets = [];
for (const store of ['fashion', 'independent']) {
  for (const file of await readdir(`public/seed-media/${store}`)) {
    if (file.endsWith('.webp'))
      assets.push({
        path: `/uploads/development-v82/${store}/${file}`,
        bytes: await readFile(`public/seed-media/${store}/${file}`),
      });
  }
}
assert.equal(assets.length, 18);
for (let start = 0; start < 2; start++) {
  const child = spawn(
    '/usr/bin/sandbox-exec',
    [
      '-f',
      'scripts/seed-media-offline.sb',
      process.execPath,
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import app from './dist/app.js';
    // The sandbox must reject a non-loopback connection immediately, not time out.
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '203.0.113.1', port: 80 });
      socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('External access was not demonstrably denied')); });
      socket.once('connect', () => { socket.destroy(); reject(new Error('External network unexpectedly allowed')); });
      socket.once('error', error => { try { assert.equal(error.code, 'EPERM'); resolve(); } catch (failure) { reject(failure); } });
    });
    const server = app.listen(0, '127.0.0.1', () => process.send({port: server.address().port, externalNetworkDenied: true}));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `,
    ],
    {
      env: { ...process.env, UPLOAD_DIR: '/tmp/unused-offline-seed-uploads' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  const exited = once(child, 'exit');
  try {
    const timeout = setTimeout(() => child.kill('SIGTERM'), 15000);
    try {
      const message = await Promise.race([
        once(child, 'message').then(([value]) => value),
        exited.then(() => {
          throw new Error(`Offline child exited before readiness: ${stderr}`);
        }),
      ]);
      assert.equal(message.externalNetworkDenied, true);
      assert.equal(typeof message.port, 'number');
      for (const asset of assets) {
        const result = await new Promise((resolve, reject) => {
          const req = http.get(
            { hostname: '127.0.0.1', port: message.port, path: asset.path },
            (response) => {
              const chunks = [];
              response.on('data', (data) => chunks.push(data));
              response.on('end', () =>
                resolve({
                  status: response.statusCode,
                  type: response.headers['content-type'],
                  bytes: Buffer.concat(chunks),
                }),
              );
              response.on('error', reject);
            },
          );
          req.on('error', reject);
        });
        assert.equal(result.status, 200, asset.path);
        assert.equal(result.type, 'image/webp');
        assert.deepEqual(result.bytes, asset.bytes);
      }
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    await exited;
  }
}
console.log(
  'Offline compiled-backend verification passed: external network denied, 18 images served on each of two process starts.',
);
