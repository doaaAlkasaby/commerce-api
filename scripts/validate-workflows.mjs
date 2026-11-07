/* global process, console */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const assets = {
  'darwin-x64': [
    'darwin_amd64',
    '28e5de5a05fc558474f638323d736d822fff183d2d492f0aecb2b73cc44584f5',
  ],
  'darwin-arm64': [
    'darwin_arm64',
    '2693315b9093aeacb4ebd91a993fea54fc215057bf0da2659056b4bc033873db',
  ],
  'linux-x64': [
    'linux_amd64',
    '023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757',
  ],
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset)
  throw new Error('Use actionlint 1.7.7 on a supported verification platform');
const dir = await mkdtemp(join(tmpdir(), 'commerce-actionlint-'));
try {
  const path = join(dir, 'actionlint.tar.gz');
  const download = spawnSync(
    'curl',
    [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--retry',
      '2',
      '--connect-timeout',
      '10',
      '--max-time',
      '60',
      '--output',
      path,
      `https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_${asset[0]}.tar.gz`,
    ],
    { stdio: 'inherit', timeout: 190000 },
  );
  if (download.status !== 0)
    throw new Error('Workflow validator download failed');
  const archive = await readFile(path);
  if (createHash('sha256').update(archive).digest('hex') !== asset[1])
    throw new Error('Workflow validator checksum mismatch');
  const extraction = spawnSync('tar', ['-xzf', path, '-C', dir, 'actionlint'], {
    stdio: 'inherit',
  });
  if (extraction.status !== 0) throw new Error('Validator extraction failed');
  const result = spawnSync(
    join(dir, 'actionlint'),
    ['.github/workflows/ci.yml'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Workflow validation failed');
  console.log('Workflow valid: actionlint 1.7.7, release checksum verified.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
