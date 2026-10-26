import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('seed validation reports the invalid bootstrap field without exposing credentials or connecting', () => {
  const password = 'private-short';
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../../src/db/seedAdmin.js', import.meta.url))],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://localhost:5173',
        SESSION_SECRET: 'test-secret-'.repeat(4),
        MONGODB_URI:
          'mongodb://private-user:private-db-password@127.0.0.1:1/test',
        ADMIN_BOOTSTRAP_NAME: 'Test Administrator',
        ADMIN_BOOTSTRAP_EMAIL: 'private-email@example.test',
        ADMIN_BOOTSTRAP_PASSWORD: password,
      },
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'ADMIN_BOOTSTRAP_PASSWORD: Password must contain 15 to 128 Unicode characters.',
  );
  expect(result.stderr).toContain('failed during bootstrap validation');
  for (const secret of [
    password,
    'private-email@example.test',
    'private-db-password',
    'test-secret-',
  ])
    expect(result.stderr + result.stdout).not.toContain(secret);
});
