import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const source = {
  MONGODB_URI: 'mongodb://localhost:27017/lab_equipment?replicaSet=rs0',
  APP_ORIGIN: 'http://localhost:5173',
  SESSION_SECRET: 'a'.repeat(64),
};

test('environment defaults and explicit settings', () => {
  assert.deepEqual(loadEnv(source), {
    nodeEnv: 'development',
    port: 3000,
    mongodbUri: source.MONGODB_URI,
    appOrigin: source.APP_ORIGIN,
    sessionSecret: source.SESSION_SECRET,
    logLevel: 'info',
  });
  assert.equal(
    loadEnv({ ...source, PORT: '4000', NODE_ENV: 'test' }).port,
    4000,
  );
});

test('invalid database and port settings fail before startup', () => {
  assert.throws(() => loadEnv({}), /MONGODB_URI/);
  assert.throws(
    () => loadEnv({ ...source, MONGODB_URI: 'https://example.com' }),
    /MONGODB_URI/,
  );
  for (const port of ['0', '65536', '3.5', 'abc', '']) {
    assert.throws(() => loadEnv({ ...source, PORT: port }), /PORT/);
  }
  assert.throws(() => loadEnv({ ...source, NODE_ENV: 'invalid' }), /NODE_ENV/);
});

test('session secrets, log levels, and browser origins are validated', () => {
  for (const secret of [undefined, '', 'short', ' '.repeat(64)]) {
    assert.throws(
      () => loadEnv({ ...source, SESSION_SECRET: secret }),
      /SESSION_SECRET/,
    );
  }
  for (const origin of [
    undefined,
    'null',
    'ftp://example.com',
    'http://example.com/',
    'http://user:pass@example.com',
    'http://example.com/path',
  ]) {
    assert.throws(
      () => loadEnv({ ...source, APP_ORIGIN: origin }),
      /APP_ORIGIN/,
    );
  }
  assert.throws(() => loadEnv({ ...source, NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(
    () => loadEnv({ ...source, LOG_LEVEL: 'invalid' }),
    /LOG_LEVEL/,
  );
  assert.equal(
    loadEnv({
      ...source,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://lab.example.com',
    }).appOrigin,
    'https://lab.example.com',
  );
});
