// Compatibility entrypoint: keep the existing Swagger generator, then synchronize
// the single canonical Postman collection through its source-aware generator.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync('npm', ['run', 'docs:generate'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
