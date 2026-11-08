import { assertDevelopmentSeedTarget } from './seed-options.js';

export class DevelopmentSeedError extends Error {}
export function developmentSeedSettings(
  source: NodeJS.ProcessEnv,
  target: 'development' | 'test',
) {
  const url =
    target === 'test' ? source.TEST_DATABASE_URL : source.DATABASE_URL;
  if (!url || !['development', 'test'].includes(source.NODE_ENV ?? ''))
    throw new DevelopmentSeedError(
      'Set NODE_ENV explicitly to development/test and configure the selected database URL',
    );
  try {
    assertDevelopmentSeedTarget(source.NODE_ENV, url);
  } catch {
    throw new DevelopmentSeedError(
      'Development seeds require a local, non-production PostgreSQL target',
    );
  }
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (
    source.ALLOW_DEVELOPMENT_SEED !== 'true' ||
    source.DEVELOPMENT_SEED_DATABASE !== name ||
    !/(^|_)(dev|development|test)(_|$)/i.test(name) ||
    /prod/i.test(name)
  )
    throw new DevelopmentSeedError(
      'Approve the exact dev/test database using ALLOW_DEVELOPMENT_SEED=true and DEVELOPMENT_SEED_DATABASE',
    );
  const password = source.DEVELOPMENT_SEED_PASSWORD;
  if (
    !password ||
    password.length < 12 ||
    password.length > 128 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  )
    throw new DevelopmentSeedError(
      'Provide DEVELOPMENT_SEED_PASSWORD with 12–128 characters and upper/lowercase, digit and special character',
    );
  return { url, name, password };
}
