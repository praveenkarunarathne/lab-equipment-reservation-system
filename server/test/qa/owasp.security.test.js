/**
 * EC4206 §3.7 Security — OWASP Top 10 (2021) checks.
 *
 * The same checks were first carried out by hand with Postman/curl (see the QA
 * report); they are automated here so they stay true on every push.
 *   A01 Broken Access Control       → SEC-01 … SEC-05
 *   A03 Injection (NoSQL / regex)    → SEC-06 … SEC-07
 *   A05 Security Misconfiguration    → SEC-08 … SEC-09
 *   A07 Identification & Auth Fails  → SEC-10 … SEC-14
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import request from 'supertest';
import { PASSWORD, startHarness } from './helpers/harness.js';

let h;
beforeAll(async () => {
  h = await startHarness('qa_owasp');
}, 180_000);
afterAll(() => h?.stop());
beforeEach(() => h.reset());

describe('A01 Broken Access Control', () => {
  test('SEC-01 student cannot reach administrator endpoints', async () => {
    const { agent, token } = await h.session(h.users.student);
    const checks = [
      agent.get('/api/v1/admin/dashboard'),
      agent.get('/api/v1/reservations'),
      agent.get('/api/v1/fault-reports'),
      agent.post('/api/v1/equipment').set('X-CSRF-Token', token).send({
        assetCode: 'HACK',
        name: 'x x',
        category: 'x x',
        location: 'x x',
      }),
    ];
    for (const res of await Promise.all(checks)) {
      expect([res.status, res.body.error.code]).toEqual([403, 'FORBIDDEN']);
    }
  });

  test('SEC-02 anonymous user gets 401 on every protected resource', async () => {
    for (const path of [
      '/api/v1/equipment',
      '/api/v1/reservations/mine',
      '/api/v1/fault-reports/mine',
      '/api/v1/auth/me',
    ]) {
      const res = await request(h.app).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  test("SEC-03 IDOR: a student cannot read another student's fault report", async () => {
    const item = await h.equipment();
    const owner = await h.session(h.users.student);
    const created = await owner.agent
      .post('/api/v1/fault-reports')
      .set('X-CSRF-Token', owner.token)
      .send({
        equipmentId: item.id,
        category: 'damage',
        title: 'Cracked probe',
        description: 'Probe tip is cracked near the BNC connector.',
      })
      .expect(201);
    const intruder = await h.session(h.users.otherStudent);
    const res = await intruder.agent.get(
      `/api/v1/fault-reports/${created.body.data.id}`,
    );
    expect(res.status).toBe(404);
  });

  test('SEC-04 mass assignment: role cannot be set at registration', async () => {
    const { agent, token } = await h.session();
    const res = await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', token)
      .send({
        name: 'Mallory',
        email: 'mallory@qa.test',
        password: PASSWORD,
        role: 'admin',
      });
    expect(res.status).toBe(400);
  });

  test('SEC-05 CSRF: a request from a foreign Origin is rejected', async () => {
    const { agent, token } = await h.session(h.users.student);
    const res = await agent
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', token)
      .set('Origin', 'https://evil.example');
    expect([res.status, res.body.error.code]).toEqual([403, 'CSRF_INVALID']);
  });
});

describe('A03 Injection', () => {
  test('SEC-06 NoSQL operator injection in login is rejected by validation', async () => {
    const { agent, token } = await h.session();
    const res = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', token)
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  test('SEC-07 regex metacharacters in search are matched literally', async () => {
    await h.equipment({ name: 'Microscope' });
    const { agent } = await h.session(h.users.student);
    const all = await agent.get('/api/v1/equipment').query({ q: '.*' });
    expect(all.status).toBe(200);
    expect(all.body.pagination.total).toBe(0);
  });
});

describe('A05 Security Misconfiguration', () => {
  test('SEC-08 hardening headers are present and the stack is not advertised', async () => {
    const res = await request(h.app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('SEC-09 errors do not leak stack traces', async () => {
    const res = await request(h.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
  });
});

describe('A07 Identification and Authentication Failures', () => {
  async function login(email, password) {
    const { agent, token } = await h.session();
    return agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', token)
      .send({ email, password });
  }

  test('SEC-10 login does not reveal whether an account exists', async () => {
    const wrongPassword = await login(h.users.student.email, 'x'.repeat(20));
    const unknownUser = await login('nobody@qa.test', 'x'.repeat(20));
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.error.message).toBe(
      wrongPassword.body.error.message,
    );
  });

  test('SEC-11 brute force: the 11th login attempt in 15 minutes gets 429', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await login('nobody@qa.test', 'guess-' + i)).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  test('SEC-12 session ID is rotated on login (no session fixation)', async () => {
    const agent = request.agent(h.app);
    const before = await agent.get('/api/v1/auth/csrf');
    const cookieBefore = before.headers['set-cookie'][0].split(';')[0];
    const after = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', before.body.data.csrfToken)
      .send({ email: h.users.student.email, password: PASSWORD })
      .expect(200);
    const cookieAfter = after.headers['set-cookie'][0];
    expect(cookieAfter.split(';')[0]).not.toBe(cookieBefore);
    expect(cookieAfter).toMatch(/HttpOnly/i);
    expect(cookieAfter).toMatch(/SameSite=Lax/i);
  });

  test('SEC-13 FINDING QA-BUG-02: registration reveals that an email is registered', async () => {
    const { agent, token } = await h.session();
    const res = await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', token)
      .send({ name: 'Copy', email: h.users.student.email, password: PASSWORD });
    // Documents current behaviour (accepted risk, see report): 409 + explicit code.
    expect([res.status, res.body.error.code]).toEqual([
      409,
      'EMAIL_ALREADY_REGISTERED',
    ]);
  });

  test('SEC-14 FINDING QA-BUG-03: trivially weak 15-character passwords are accepted', async () => {
    const { agent, token } = await h.session();
    const res = await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', token)
      .send({ name: 'Weak', email: 'weak@qa.test', password: 'a'.repeat(15) });
    expect(res.status).toBe(201);
  });
});
