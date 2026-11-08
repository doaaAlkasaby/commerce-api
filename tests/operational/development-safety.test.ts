import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEmailService } from '../../src/common/email/email.service.js';
import { developmentSeedSettings } from '../../src/config/development-seed-options.js';

describe('development data and email boundaries', () => {
  const source = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://localhost/commerce_dev',
    ALLOW_DEVELOPMENT_SEED: 'true',
    DEVELOPMENT_SEED_DATABASE: 'commerce_dev',
    DEVELOPMENT_SEED_PASSWORD: 'Fixture-Password!123',
  };
  it('requires explicit local dev/test database approval and strong configured credentials', () => {
    expect(developmentSeedSettings(source, 'development').name).toBe(
      'commerce_dev',
    );
    for (const overrides of [
      { NODE_ENV: 'production' },
      { ALLOW_DEVELOPMENT_SEED: 'false' },
      { DEVELOPMENT_SEED_DATABASE: 'another_dev' },
      { DATABASE_URL: 'postgresql://remote.example/commerce_dev' },
      {
        DATABASE_URL: 'postgresql://localhost/commerce_prod_dev',
        DEVELOPMENT_SEED_DATABASE: 'commerce_prod_dev',
      },
      { DEVELOPMENT_SEED_PASSWORD: 'weak' },
    ])
      expect(() =>
        developmentSeedSettings({ ...source, ...overrides }, 'development'),
      ).toThrow();
    expect(() => developmentSeedSettings(source, 'test')).toThrow();
  });
  it('writes development verification tokens only to private temporary files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'commerce-mail-test-'));
    try {
      await createEmailService({
        mode: 'development_file',
        nodeEnv: 'test',
        outboxDirectory: directory,
      }).sendVerificationEmail({
        email: 'fixture@example.test',
        firstName: 'Fixture',
        verificationToken: 'development-token',
      });
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      const file = join(directory, files[0]!);
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
        type: 'verification',
        email: 'fixture@example.test',
        verificationToken: 'development-token',
      });
      expect((await stat(directory)).mode & 0o077).toBe(0);
      expect((await stat(file)).mode & 0o077).toBe(0);
      expect(() =>
        createEmailService({
          mode: 'development_file',
          nodeEnv: 'production',
          outboxDirectory: directory,
        }),
      ).toThrow();
      await expect(
        createEmailService({
          mode: 'development_file',
          nodeEnv: 'test',
          outboxDirectory: directory,
          uploadDirectory: directory,
        }).sendPasswordResetEmail({
          email: 'fixture@example.test',
          firstName: 'Fixture',
          resetToken: 'reset-token',
        }),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
