/* global process, console */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
const baseline = JSON.parse(
  readFileSync('config/ci-quality-baseline.json', 'utf8'),
);
function unchanged(file, table) {
  return (
    existsSync(file) &&
    table[file] ===
      createHash('sha256').update(readFileSync(file)).digest('hex')
  );
}
const lint = spawnSync('node_modules/.bin/eslint', ['.', '--format', 'json'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
if (lint.error || lint.status === null || lint.status > 1)
  throw new Error('ESLint did not complete');
let inheritedLint = 0,
  newLint = 0;
for (const row of JSON.parse(lint.stdout)) {
  if (!row.errorCount && !row.warningCount) continue;
  const file = relative(process.cwd(), row.filePath);
  if (unchanged(file, baseline.lint)) {
    inheritedLint += row.errorCount + row.warningCount;
    continue;
  }
  for (const message of row.messages)
    console.error(
      `${file}:${message.line ?? 1} ${message.ruleId ?? 'parse'} ${message.message}`,
    );
  newLint += row.errorCount + row.warningCount;
}
const format = spawnSync(
  'node_modules/.bin/prettier',
  ['--list-different', '.'],
  { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
);
if (format.error || format.status === null || format.status > 1)
  throw new Error('Prettier did not complete');
let inheritedFormat = 0,
  newFormat = 0;
for (const file of format.stdout.split('\n').filter(Boolean)) {
  if (unchanged(file, baseline.format)) inheritedFormat++;
  else {
    console.error(`Formatting required: ${file}`);
    newFormat++;
  }
}
console.log(
  `Unchanged legacy debt: ${inheritedLint} lint findings, ${inheritedFormat} unformatted files. New/modified-file findings: ${newLint} lint, ${newFormat} format.`,
);
if (newLint || newFormat) process.exit(1);
