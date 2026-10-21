import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { ensureCriticalIndexes } from '../../src/db/ensureCriticalIndexes.js';
import { requireAuth, requireRole } from '../../src/middleware/auth.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { registrationSchema } from '../../src/modules/auth/auth.validation.js';
import { getUserModel } from '../../src/modules/users/user.model.js';
import { createLogger } from '../../src/shared/logger.js';
import { verifyPassword } from '../../src/shared/password.js';

let replicaSet, connection, env, app, User, service, logs;
const student = {
  name: 'Test Student',
  email: 'student@example.com',
  password: '  my exact password 🔬  ',
};

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  connection = await mongoose
    .createConnection(replicaSet.getUri('auth_test'), { autoIndex: false })
    .asPromise();
  await ensureCriticalIndexes(connection);
  User = getUserModel(connection);
  service = createAuthService(connection);
  env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: replicaSet.getUri('auth_test'),
    APP_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: randomBytes(32).toString('hex'),
  });
}, 180_000);

afterAll(async () => {
  await connection?.close();
  await replicaSet?.stop();
});
beforeEach(async () => {
  await User.deleteMany({});
  await connection.db.collection('sessions').deleteMany({});
  logs = '';
  const logger = createLogger(
    'info',
    new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk;
        callback();
      },
    }),
  );
  const routes = express.Router();
  routes.get('/admin/probe', requireAuth, requireRole('admin'), (_req, res) =>
    res.json({ data: { allowed: true } }),
  );
  routes.get(
    '/student/probe',
    requireAuth,
    requireRole('student'),
    (_req, res) => res.json({ data: { allowed: true } }),
  );
  app = createApp({ env, connection, logger, routes });
});

async function preAuth() {
  const agent = request.agent(app);
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  return {
    agent,
    token: response.body.data.csrfToken,
    cookie: response.headers['set-cookie'][0].split(';')[0],
  };
}

async function signIn(credentials = student) {
  const session = await preAuth();
  const response = await session.agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', session.token)
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);
  return {
    ...session,
    previousToken: session.token,
    token: response.body.data.csrfToken,
    response,
  };
}

function assertFailure(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.equal(response.body.error.requestId, response.headers['x-request-id']);
}

test('registration normalizes user fields, hashes the exact password, and does not sign in', async () => {
  const { agent, token } = await preAuth();
  const response = await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', token)
    .send({
      ...student,
      name: '  Test Student  ',
      email: '  STUDENT@EXAMPLE.COM  ',
    })
    .expect(201);
  assert.deepEqual(Object.keys(response.body.data.user).sort(), [
    'createdAt',
    'email',
    'id',
    'name',
    'role',
  ]);
  assert.equal(response.body.data.user.name, student.name);
  assert.equal(response.body.data.user.email, student.email);
  assert.equal(response.body.data.user.role, 'student');
  const user = await User.findOne({ email: student.email }).select(
    '+passwordHash',
  );
  assert.match(user.passwordHash, /^\$argon2id\$v=19\$/);
  assert.deepEqual(
    Object.fromEntries(
      user.passwordHash
        .split('$')[3]
        .split(',')
        .map((part) => part.split('=')),
    ),
    { m: '19456', t: '2', p: '1' },
  );
  assert.equal(await verifyPassword(user.passwordHash, student.password), true);
  assert.equal(
    await verifyPassword(user.passwordHash, student.password.trim()),
    false,
  );
  assert.equal((await User.findById(user.id)).passwordHash, undefined);
  assertFailure(await agent.get('/api/v1/auth/me'), 401, 'AUTH_REQUIRED');
  assert.ok(!logs.includes(student.password));
  assert.ok(!logs.includes(user.passwordHash));
});

test('role and unknown fields are rejected and cannot create an administrator', async () => {
  const { agent, token } = await preAuth();
  assertFailure(
    await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', token)
      .send({ ...student, role: 'admin' }),
    400,
    'VALIDATION_ERROR',
  );
  assert.equal(await User.countDocuments(), 0);
  assert.equal(
    (await service.register({ ...student, role: 'admin' })).role,
    'student',
  );
});

test('password limits count Unicode code points and preserve spaces and normalization', () => {
  for (const password of [
    '🔬'.repeat(15),
    'a'.repeat(128),
    ' '.repeat(15),
    'é'.repeat(15),
    'e\u0301'.repeat(8),
  ]) {
    const result = registrationSchema.parse({ ...student, password });
    assert.equal(result.password, password);
  }
  for (const password of ['🔬'.repeat(14), 'a'.repeat(129), '🔬'.repeat(129)]) {
    assert.equal(
      registrationSchema.safeParse({ ...student, password }).success,
      false,
    );
  }
});

test('concurrent duplicate registration is protected by the unique email index', async () => {
  const { agent, token } = await preAuth();
  const results = await Promise.all(
    [student.email, 'STUDENT@EXAMPLE.COM'].map((email) =>
      agent
        .post('/api/v1/auth/register')
        .set('X-CSRF-Token', token)
        .send({ ...student, email }),
    ),
  );
  assert.deepEqual(
    results.map((response) => response.status).sort(),
    [201, 409],
  );
  assertFailure(
    results.find((response) => response.status === 409),
    409,
    'EMAIL_ALREADY_REGISTERED',
  );
  assert.equal(await User.countDocuments(), 1);
});

test('login regenerates the session and rotates CSRF; old session and token stop working', async () => {
  await service.register(student);
  const { agent, token, previousToken, cookie, response } = await signIn({
    ...student,
    email: ' STUDENT@EXAMPLE.COM ',
  });
  const authenticatedCookie = response.headers['set-cookie'][0].split(';')[0];
  assert.notEqual(authenticatedCookie, cookie);
  assert.notEqual(token, previousToken);
  assert.deepEqual(Object.keys(response.body.data.user).sort(), [
    'email',
    'id',
    'name',
    'role',
  ]);
  assert.equal(response.body.data.user.role, 'student');
  await agent.get('/api/v1/auth/me').expect(200);
  assertFailure(
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie),
    401,
    'AUTH_REQUIRED',
  );
  assertFailure(
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', previousToken),
    403,
    'CSRF_INVALID',
  );
  const sessions = await connection.db
    .collection('sessions')
    .find({})
    .toArray();
  assert.equal(sessions.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(sessions[0].session)).sort(), [
    'cookie',
    'csrfToken',
    'role',
    'userId',
  ]);
  assert.doesNotMatch(
    JSON.stringify(response.body) + logs,
    /passwordHash|\$argon2id/,
  );
});

test('unknown email and wrong password return the same generic credential failure', async () => {
  await service.register(student);
  const { agent, token } = await preAuth();
  const unknown = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', token)
    .send({ email: 'missing@example.com', password: student.password });
  const wrong = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', token)
    .send({ email: student.email, password: student.password.trim() });
  for (const response of [unknown, wrong])
    assertFailure(response, 401, 'INVALID_CREDENTIALS');
  assert.equal(unknown.body.error.message, wrong.body.error.message);
  assertFailure(await agent.get('/api/v1/auth/me'), 401, 'AUTH_REQUIRED');
});

test('register, login, and logout enforce CSRF and cross-site request checks', async () => {
  const { agent, token } = await preAuth();
  for (const route of ['register', 'login', 'logout']) {
    assertFailure(
      await agent.post(`/api/v1/auth/${route}`).send(student),
      403,
      'CSRF_INVALID',
    );
    assertFailure(
      await agent
        .post(`/api/v1/auth/${route}`)
        .set('X-CSRF-Token', token)
        .set('Sec-Fetch-Site', 'cross-site')
        .send(student),
      403,
      'CSRF_INVALID',
    );
  }
  assert.equal(await User.countDocuments(), 0);
});

test('logout needs no body, removes the stored session, clears its cookie, and prevents replay', async () => {
  await service.register(student);
  const { agent, token, response } = await signIn();
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  const loggedOut = await agent
    .post('/api/v1/auth/logout')
    .set('X-CSRF-Token', token)
    .expect(204);
  assert.match(loggedOut.headers['set-cookie'][0], /^lab\.sid=;/);
  assert.equal(await connection.db.collection('sessions').countDocuments(), 0);
  assertFailure(await agent.get('/api/v1/auth/me'), 401, 'AUTH_REQUIRED');
  assertFailure(
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie),
    401,
    'AUTH_REQUIRED',
  );
  assertFailure(
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token),
    403,
    'CSRF_INVALID',
  );
  const newToken = (await agent.get('/api/v1/auth/csrf').expect(200)).body.data
    .csrfToken;
  assert.notEqual(newToken, token);
});

test('authorization rejects anonymous users and enforces both student and admin roles', async () => {
  assertFailure(
    await request(app).get('/api/v1/admin/probe'),
    401,
    'AUTH_REQUIRED',
  );
  await service.register(student);
  const session = await signIn();
  assertFailure(
    await session.agent.get('/api/v1/admin/probe'),
    403,
    'FORBIDDEN',
  );
  await session.agent.get('/api/v1/student/probe').expect(200);
  const admin = {
    ...student,
    name: 'Administrator',
    email: 'admin@example.com',
  };
  await service.seedAdmin(admin);
  const adminSession = await signIn(admin);
  await adminSession.agent.get('/api/v1/admin/probe').expect(200);
  assertFailure(
    await adminSession.agent.get('/api/v1/student/probe'),
    403,
    'FORBIDDEN',
  );
  assert.equal(
    (await adminSession.agent.get('/api/v1/auth/me')).body.data.user.role,
    'admin',
  );
});

test('expired authenticated sessions return 401', async () => {
  await service.register(student);
  const { agent } = await signIn();
  await connection.db
    .collection('sessions')
    .updateMany({}, { $set: { expires: new Date(Date.now() - 1000) } });
  assertFailure(await agent.get('/api/v1/auth/me'), 401, 'AUTH_REQUIRED');
});

test('admin seed is idempotent and never changes an existing student or administrator', async () => {
  const admin = { ...student, email: 'admin@example.com' };
  const first = await service.seedAdmin(admin);
  assert.equal(first.created, true);
  const before = await User.findById(first.user.id)
    .select('+passwordHash')
    .lean();
  assert.equal(
    (
      await service.seedAdmin({
        ...admin,
        name: 'Changed',
        password: 'a different password',
      })
    ).created,
    false,
  );
  assert.deepEqual(
    await User.findById(first.user.id).select('+passwordHash').lean(),
    before,
  );
  await service.register(student);
  await assert.rejects(
    service.seedAdmin(student),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal((await User.findOne({ email: student.email })).role, 'student');
  const concurrent = await Promise.all([
    service.seedAdmin({ ...admin, email: 'second@example.com' }),
    service.seedAdmin({ ...admin, email: 'second@example.com' }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.created).sort(), [
    false,
    true,
  ]);
});
