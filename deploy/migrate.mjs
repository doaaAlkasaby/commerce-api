/* global process, console */
import { spawn } from 'node:child_process';
import { migrationIssues } from './environment.mjs';
if (migrationIssues(process.env).length) {
  console.error(
    'Migration preflight refused: verify target, TLS, approval and backup attestations.',
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
    '--config',
    'prisma7.config.ts',
  ],
  { stdio: 'inherit' },
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
child.once('error', () => {
  console.error('Migration process could not start.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code === 0 ? 0 : 1;
});
