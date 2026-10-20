import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

const mongodbUri = 'mongodb://localhost:27017/lab_equipment?replicaSet=rs0';

test('environment defaults and explicit settings', () => {
  assert.deepEqual(loadEnv({ MONGODB_URI: mongodbUri }), {
    nodeEnv: 'development',
    port: 3000,
    mongodbUri,
  });
  assert.equal(
    loadEnv({ MONGODB_URI: mongodbUri, PORT: '4000', NODE_ENV: 'test' }).port,
    4000,
  );
});

test('invalid environment settings fail before startup', () => {
  assert.throws(() => loadEnv({}), /MONGODB_URI/);
  assert.throws(
    () => loadEnv({ MONGODB_URI: 'https://example.com' }),
    /MONGODB_URI/,
  );
  for (const port of ['0', '65536', '3.5', 'abc', '']) {
    assert.throws(
      () => loadEnv({ MONGODB_URI: mongodbUri, PORT: port }),
      /PORT/,
    );
  }
  assert.throws(
    () => loadEnv({ MONGODB_URI: mongodbUri, NODE_ENV: 'invalid' }),
    /NODE_ENV/,
  );
});

test('Express starts and responds without disclosing its framework', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.deepEqual(await response.json(), {
      message: 'Lab Equipment Reservation API',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
