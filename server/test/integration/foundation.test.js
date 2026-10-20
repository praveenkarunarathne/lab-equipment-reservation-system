import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { ensureCriticalIndexes } from '../../src/db/ensureCriticalIndexes.js';
import { validate } from '../../src/middleware/validate.js';
import { AppError } from '../../src/shared/AppError.js';
import { createLogger } from '../../src/shared/logger.js';
import { objectIdSchema } from '../../src/shared/objectId.js';

let replicaSet;
let connection;
let env;
let app;
let logger;
let logs;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  connection = await mongoose
    .createConnection(replicaSet.getUri('foundation_test'), {
      autoIndex: false,
      serverSelectionTimeoutMS: 2000,
    })
    .asPromise();
  await ensureCriticalIndexes(connection);
  env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: replicaSet.getUri('foundation_test'),
    APP_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: randomBytes(32).toString('hex'),
  });
}, 180_000);

afterAll(async () => {
  await connection?.close();
  await replicaSet?.stop();
});

beforeEach(() => {
  logs = '';
  logger = createLogger(
    'info',
    new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    }),
  );
  const routes = express.Router();
  routes.get('/test/read', (_req, res) => res.json({ data: { ready: true } }));
  routes.get('/test/error', () => {
    throw new Error(
      `mongodb://secret:password@localhost/db ${env.sessionSecret}`,
    );
  });
  routes.get('/test/duplicate/:field', (req, _res, next) => {
    const keyPattern =
      req.params.field === 'reservation'
        ? { equipmentId: 1, startAt: 1 }
        : { [req.params.field]: 1 };
    next(
      Object.assign(new Error('private duplicate details'), {
        code: 11000,
        keyPattern,
      }),
    );
  });
  routes.get('/test/expected', () => {
    throw new AppError(
      409,
      'RESERVATION_CONFLICT',
      'This equipment slot is already booked.',
    );
  });
  routes.post('/test/unsafe', (req, res) => {
    req.session.userId = '0123456789abcdef01234567';
    req.session.role = 'student';
    res.json({ data: { accepted: true } });
  });
  routes.post(
    '/test/validate/:id',
    validate({
      params: z.strictObject({ id: objectIdSchema }),
      query: z.strictObject({
        limit: z.coerce.number().int().min(1).max(100).default(10),
      }),
      body: z.strictObject({ name: z.string().trim().min(2).max(80) }),
    }),
    (req, res) => res.json({ data: req.validated }),
  );
  app = createApp({ env, connection, logger, routes });
});

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.equal(response.body.error.requestId, response.headers['x-request-id']);
  assert.match(response.body.error.requestId, /^[a-f0-9-]{36}$/);
}

async function csrfAgent(target = app) {
  const agent = request.agent(target);
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  return { agent, token: response.body.data.csrfToken, response };
}

test('health checks a real database with a bounded ping and no session cookie', async () => {
  const ping = vi.spyOn(connection.db, 'command');
  try {
    const response = await request(app).get('/api/v1/health').expect(200);
    assert.deepEqual(response.body, { data: { status: 'ok', database: 'ok' } });
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-powered-by'], undefined);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.ok(
      ping.mock.calls.some(
        ([command, options]) =>
          command.ping === 1 && options.timeoutMS === 2000,
      ),
    );
  } finally {
    ping.mockRestore();
  }
});

test('database failure returns a safe 503', async () => {
  const ping = vi
    .spyOn(connection.db, 'command')
    .mockRejectedValueOnce(new Error('mongodb://secret@host/private'));
  try {
    const response = await request(app).get('/api/v1/health');
    assertError(response, 503, 'SERVICE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(response.body), /secret|private|stack/);
  } finally {
    ping.mockRestore();
  }
});

test('unknown API routes return JSON and replace caller-supplied request IDs', async () => {
  for (const path of [
    '/api/unknown',
    '/api/v1/unknown',
    '/api/v2/health',
    '/',
  ]) {
    const response = await request(app)
      .get(path)
      .set('X-Request-Id', 'untrusted');
    assertError(response, 404, 'RESOURCE_NOT_FOUND');
    assert.match(response.headers['content-type'], /application\/json/);
    assert.notEqual(response.headers['x-request-id'], 'untrusted');
    assert.equal(response.headers['set-cookie'], undefined);
  }
});

test('pre-auth sessions persist in MongoDB and reuse the token across app instances', async () => {
  const { agent, token, response } = await csrfAgent();
  assert.match(token, /^[a-f0-9]{64}$/);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /^lab\.sid=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure|Domain=/);
  assert.doesNotMatch(cookie, new RegExp(token));
  const document = await connection.db
    .collection('sessions')
    .findOne({ session: { $regex: token } });
  assert.ok(document);
  assert.deepEqual(Object.keys(JSON.parse(document.session)).sort(), [
    'cookie',
    'csrfToken',
  ]);
  assert.ok(document.expires.getTime() > Date.now() + 7.9 * 60 * 60 * 1000);
  const again = await agent.get('/api/v1/auth/csrf').expect(200);
  assert.equal(again.body.data.csrfToken, token);
  assert.equal(again.headers['set-cookie'], undefined);
  const restarted = createApp({ env, connection, logger });
  const persisted = await request(restarted)
    .get('/api/v1/auth/csrf')
    .set('Cookie', cookie.split(';')[0])
    .expect(200);
  assert.equal(persisted.body.data.csrfToken, token);
  assert.equal(persisted.headers['set-cookie'], undefined);
});

test('expired sessions and tampered cookies cannot authorize unsafe requests', async () => {
  const { agent, token, response } = await csrfAgent();
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');
  assertError(
    await request(app)
      .post('/api/v1/test/unsafe')
      .set('Cookie', tampered)
      .set('X-CSRF-Token', token)
      .send({}),
    403,
    'CSRF_INVALID',
  );
  await connection.db
    .collection('sessions')
    .updateOne(
      { session: { $regex: token } },
      { $set: { expires: new Date(Date.now() - 1000) } },
    );
  assertError(
    await agent.post('/api/v1/test/unsafe').set('X-CSRF-Token', token).send({}),
    403,
    'CSRF_INVALID',
  );
});

test('production sets host-only secure cookies, CSP, HSTS, and one trusted proxy', async () => {
  const production = createApp({
    env: {
      ...env,
      nodeEnv: 'production',
      appOrigin: 'https://lab.example.com',
    },
    connection,
    logger,
  });
  assert.equal(production.get('trust proxy'), 1);
  assert.equal(app.get('trust proxy'), false);
  const response = await request(production)
    .get('/api/v1/auth/csrf')
    .set('X-Forwarded-Proto', 'https')
    .expect(200);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /^__Host-lab\.sid=/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.match(response.headers['strict-transport-security'], /max-age=/);
  const csp = response.headers['content-security-policy'];
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive));
  }
  assert.doesNotMatch(csp, /unsafe-inline/);
  const plainHttp = await request(production)
    .get('/api/v1/auth/csrf')
    .expect(200);
  assert.equal(plainHttp.headers['set-cookie'], undefined);
});

test('unsafe requests need the session token and a permitted origin or referer', async () => {
  const { agent, token } = await csrfAgent();
  await agent
    .post('/api/v1/test/unsafe')
    .set('Content-Type', 'application/json')
    .set('X-CSRF-Token', token)
    .expect(200);
  for (const headers of [
    { Origin: env.appOrigin },
    { Referer: `${env.appOrigin}/equipment` },
    {},
  ]) {
    await agent
      .post('/api/v1/test/unsafe')
      .set(headers)
      .set('X-CSRF-Token', token)
      .send({})
      .expect(200);
  }
  for (const headers of [
    {},
    { 'X-CSRF-Token': '0'.repeat(64) },
    { 'X-CSRF-Token': 'short' },
    { 'X-CSRF-Token': token, Origin: 'https://evil.example.com' },
    { 'X-CSRF-Token': token, Origin: 'null' },
    { 'X-CSRF-Token': token, Origin: '' },
    { 'X-CSRF-Token': token, Referer: '' },
    {
      'X-CSRF-Token': token,
      Origin: 'https://evil.example.com',
      Referer: `${env.appOrigin}/safe`,
    },
    { 'X-CSRF-Token': token, Referer: 'https://evil.example.com/path' },
    { 'X-CSRF-Token': token, Referer: 'invalid url' },
    {
      'X-CSRF-Token': token,
      'Sec-Fetch-Site': 'cross-site',
      Origin: env.appOrigin,
    },
  ]) {
    assertError(
      await agent.post('/api/v1/test/unsafe').set(headers).send({}),
      403,
      'CSRF_INVALID',
    );
  }
  assertError(
    await request(app)
      .post('/api/v1/test/unsafe')
      .set('X-CSRF-Token', token)
      .send({}),
    403,
    'CSRF_INVALID',
  );
  const other = await csrfAgent();
  assertError(
    await other.agent
      .post('/api/v1/test/unsafe')
      .set('X-CSRF-Token', token)
      .send({}),
    403,
    'CSRF_INVALID',
  );
  for (const method of ['patch', 'delete', 'put']) {
    assertError(
      await agent[method]('/api/v1/test/unsafe').send({}),
      403,
      'CSRF_INVALID',
    );
  }
});

test('JSON media type, parsing, and size limits use safe error envelopes', async () => {
  assertError(
    await request(app).post('/api/v1/test/unsafe').type('text').send('private'),
    415,
    'UNSUPPORTED_MEDIA_TYPE',
  );
  assertError(
    await request(app)
      .post('/api/v1/test/unsafe')
      .set('Content-Type', 'application/json')
      .send('{"private":'),
    400,
    'VALIDATION_ERROR',
  );
  assertError(
    await request(app)
      .post('/api/v1/test/unsafe')
      .send({ private: 'a'.repeat(17000) }),
    413,
    'VALIDATION_ERROR',
  );
});

test('validation checks all request parts, rejects unknown body fields, and returns normalized data', async () => {
  const { agent, token } = await csrfAgent();
  const response = await agent
    .post('/api/v1/test/validate/0123456789abcdef01234567?limit=5')
    .set('X-CSRF-Token', token)
    .send({ name: '  Microscope  ' })
    .expect(200);
  assert.deepEqual(response.body.data, {
    params: { id: '0123456789abcdef01234567' },
    query: { limit: 5 },
    body: { name: 'Microscope' },
  });
  const invalid = await agent
    .post('/api/v1/test/validate/bad?limit=101')
    .set('X-CSRF-Token', token)
    .send({ name: 'x', role: 'admin' });
  assertError(invalid, 400, 'VALIDATION_ERROR');
  assert.deepEqual(Object.keys(invalid.body.error.fieldErrors).sort(), [
    'body',
    'body.name',
    'params.id',
    'query.limit',
  ]);
});

test('expected and duplicate-key errors map to stable business codes', async () => {
  assertError(
    await request(app).get('/api/v1/test/expected'),
    409,
    'RESERVATION_CONFLICT',
  );
  for (const [field, code] of [
    ['email', 'EMAIL_ALREADY_REGISTERED'],
    ['assetCode', 'ASSET_CODE_ALREADY_EXISTS'],
    ['reservation', 'RESERVATION_CONFLICT'],
  ]) {
    assertError(
      await request(app).get(`/api/v1/test/duplicate/${field}`),
      409,
      code,
    );
  }
  assertError(
    await request(app).get('/api/v1/test/duplicate/unknown'),
    500,
    'INTERNAL_ERROR',
  );
});

test('500 responses and request logs omit credentials, tokens, cookies, and query values', async () => {
  const { agent, token, response: csrfResponse } = await csrfAgent();
  await agent
    .post('/api/v1/test/unsafe')
    .set('X-CSRF-Token', token)
    .send({ password: 'private-body-password' })
    .expect(200);
  const response = await agent
    .get('/api/v1/test/error?password=private-query')
    .set('Authorization', 'Bearer private-authorization');
  assertError(response, 500, 'INTERNAL_ERROR');
  const output = JSON.stringify(response.body) + logs;
  for (const secret of [
    token,
    env.sessionSecret,
    'mongodb://',
    'private-body-password',
    'private-query',
    'private-authorization',
    csrfResponse.headers['set-cookie'][0].split(';')[0],
  ]) {
    assert.ok(
      !output.includes(secret),
      `Sensitive value appeared in logs or response: ${secret.slice(0, 8)}`,
    );
  }
  const entries = logs
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(
    entries.some(
      (entry) =>
        entry.req?.method === 'GET' &&
        entry.req.path === '/api/v1/test/error' &&
        entry.res?.statusCode === 500 &&
        typeof entry.responseTime === 'number',
    ),
  );
  assert.ok(
    entries.some(
      (entry) =>
        entry.userId === '0123456789abcdef01234567' && entry.role === 'student',
    ),
  );
});

test('general and auth rate limits return JSON 429 responses', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const path = attempt % 2 ? 'login' : 'register';
    await request(app).post(`/api/v1/auth/${path}`).send({}).expect(403);
  }
  assertError(
    await request(app).post('/api/v1/auth/login').send({}),
    429,
    'RATE_LIMITED',
  );
  const separate = createApp({ env, connection, logger });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await request(separate).get('/api/missing').expect(404);
  }
  const response = await request(separate).get('/api/missing');
  assertError(response, 429, 'RATE_LIMITED');
  assert.ok(response.headers['retry-after']);
}, 20_000);

test('critical index initialization is idempotent and enforces declared uniqueness', async () => {
  const schema = new mongoose.Schema({ key: String }, { autoIndex: false });
  schema.index({ key: 1 }, { unique: true, name: 'uq_test_key' });
  const model = connection.model('IndexProbe', schema);
  try {
    await ensureCriticalIndexes(connection);
    await ensureCriticalIndexes(connection);
    const indexes = await connection.db.collection('sessions').indexes();
    assert.ok(
      indexes.some(
        (index) => index.name === 'expires_1' && index.expireAfterSeconds === 0,
      ),
    );
    await model.create({ key: 'one' });
    await assert.rejects(
      model.create({ key: 'one' }),
      (error) => error.code === 11000,
    );
    await model.collection.dropIndex('uq_test_key');
    await model.create({ key: 'one' });
    await assert.rejects(
      ensureCriticalIndexes(connection),
      (error) => error.code === 11000,
    );
  } finally {
    await model.collection.drop();
    connection.deleteModel('IndexProbe');
  }
});
