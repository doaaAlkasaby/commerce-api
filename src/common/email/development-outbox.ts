import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

function within(parent: string, child: string) {
  const path = relative(parent, child);
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
}
export async function writeDevelopmentEmail(
  directory: string,
  uploadDirectory: string,
  record: object,
) {
  if (
    !isAbsolute(directory) ||
    within(resolve(uploadDirectory), resolve(directory))
  )
    throw new Error('Development outbox must be private and outside uploads');
  const roots = await Promise.all([realpath(tmpdir()), realpath('/tmp')]);
  const parent = await realpath(dirname(directory));
  if (!roots.some((root) => within(root, parent)))
    throw new Error(
      'Development outbox must be inside the system temporary directory',
    );
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    )
      throw error;
  }
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error('Development outbox must be an owner-only directory');
  const actual = await realpath(directory);
  const uploads = await realpath(uploadDirectory).catch(() =>
    resolve(uploadDirectory),
  );
  if (within(uploads, actual) || !roots.some((root) => within(root, actual)))
    throw new Error('Development outbox must not be public');
  await writeFile(
    join(actual, `${randomUUID()}.json`),
    JSON.stringify({ ...record, createdAt: new Date().toISOString() }),
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  );
}
