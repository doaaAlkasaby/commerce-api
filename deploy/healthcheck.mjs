/* global process, fetch, AbortSignal */
// Fixed loopback destination: never send operational credentials to a configured URL.
const worker = process.argv.includes('--worker');
const port = Number(
  worker ? process.env.WORKER_OPS_PORT : process.env.PORT || 3000,
);
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);
try {
  const response = await fetch(`http://127.0.0.1:${port}/ops/ready`, {
    signal: AbortSignal.timeout(2500),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
