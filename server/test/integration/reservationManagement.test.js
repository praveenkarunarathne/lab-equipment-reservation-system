import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { ensureCriticalIndexes } from '../../src/db/ensureCriticalIndexes.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { getEquipmentModel } from '../../src/modules/equipment/equipment.model.js';
import { getReservationModel } from '../../src/modules/reservations/reservation.model.js';
import { legalSlotStarts } from '../../src/modules/reservations/reservationTime.js';
import { clock } from '../../src/shared/clock.js';
import { createLogger } from '../../src/shared/logger.js';

const NOW = new Date('2026-10-26T00:00:00.000Z');
const START = new Date('2026-10-26T03:00:00.000Z');
const password = 'booking tests password';
const metadata = {
  assetCode: 'MIC-01',
  name: 'Microscope',
  category: 'Optics',
  location: 'Lab A',
  description: '',
};
let replicaSet,
  connection,
  env,
  app,
  Equipment,
  Reservation,
  admin,
  student,
  otherStudent,
  adminSession,
  studentSession,
  otherSession,
  item;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  connection = await mongoose
    .createConnection(replicaSet.getUri('reservation_management_test'), {
      autoIndex: false,
    })
    .asPromise();
  await ensureCriticalIndexes(connection);
  Equipment = getEquipmentModel(connection);
  Reservation = getReservationModel(connection);
  const auth = createAuthService(connection);
  admin = (
    await auth.seedAdmin({
      name: 'Administrator',
      email: 'admin@example.com',
      password,
    })
  ).user;
  student = await auth.register({
    name: 'Student',
    email: 'student@example.com',
    password,
  });
  otherStudent = await auth.register({
    name: 'Other Student',
    email: 'other@example.com',
    password,
  });
  env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: replicaSet.getUri('reservation_management_test'),
    APP_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
  });
}, 180_000);
afterAll(async () => {
  await connection?.close();
  await replicaSet?.stop();
});
afterEach(() => vi.restoreAllMocks());

async function sessionFor(user) {
  const agent = request.agent(app);
  const token = (await agent.get('/api/v1/auth/csrf').expect(200)).body.data
    .csrfToken;
  if (!user) return { agent, token };
  const response = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', token)
    .send({ email: user.email, password })
    .expect(200);
  return { agent, token: response.body.data.csrfToken };
}
beforeEach(async () => {
  await Reservation.deleteMany({});
  await Equipment.deleteMany({});
  await connection.db.collection('sessions').deleteMany({});
  app = createApp({ env, connection, logger: createLogger('silent') });
  adminSession = await sessionFor(admin);
  studentSession = await sessionFor(student);
  otherSession = await sessionFor(otherStudent);
  item = await Equipment.create({ ...metadata, statusUpdatedBy: admin.id });
  vi.spyOn(clock, 'now').mockReturnValue(NOW);
});

function cancel(id, session = studentSession, body) {
  const operation = session.agent
    .patch(`/api/v1/reservations/${id}/cancel`)
    .set('X-CSRF-Token', session.token);
  return body === undefined ? operation : operation.send(body);
}
function mine(query = '', session = studentSession) {
  return session.agent.get(`/api/v1/reservations/mine${query}`);
}
function all(query = '', session = adminSession) {
  return session.agent.get(`/api/v1/reservations${query}`);
}
function seed(input = {}) {
  return Reservation.create({
    equipmentId: item.id,
    studentId: student.id,
    startAt: START,
    ...input,
  });
}
function failure(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
}

test('list endpoints enforce authentication, role, strict filters, and bounded pagination', async () => {
  failure(
    await request(app).get('/api/v1/reservations/mine'),
    401,
    'AUTH_REQUIRED',
  );
  failure(await request(app).get('/api/v1/reservations'), 401, 'AUTH_REQUIRED');
  failure(await mine('', adminSession), 403, 'FORBIDDEN');
  failure(await all('', studentSession), 403, 'FORBIDDEN');
  for (const query of [
    '?view=invalid',
    '?page=0',
    '?limit=51',
    '?page=1.5',
    '?limit=0',
    '?serverNow=2020',
    `?studentId=${otherStudent.id}`,
    `?equipmentId=${item.id}`,
  ]) {
    failure(await mine(query), 400, 'VALIDATION_ERROR');
  }
  for (const query of [
    '?studentId=invalid',
    '?equipmentId=invalid',
    '?studentId[$ne]=null',
    '?view=unknown',
  ]) {
    failure(await all(query), 400, 'VALIDATION_ERROR');
  }
  assert.deepEqual((await mine().expect(200)).body, {
    data: [],
    pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
  });
});

test('own lists isolate ownership, sort and paginate upcoming records, and omit student data', async () => {
  const starts = legalSlotStarts(NOW).slice(0, 4);
  const records = [];
  for (const startAt of starts) records.push(await seed({ startAt }));
  await seed({ studentId: otherStudent.id, startAt: legalSlotStarts(NOW)[4] });
  const response = await mine('?page=2&limit=2').expect(200);
  assert.deepEqual(response.body.pagination, {
    page: 2,
    limit: 2,
    total: 4,
    totalPages: 2,
  });
  assert.deepEqual(
    response.body.data.map((record) => record.id),
    records.slice(2).map((record) => record.id),
  );
  for (const record of response.body.data) {
    assert.equal(record.student, undefined);
    assert.equal(record.studentId, undefined);
    assert.equal(record.equipment.reservationGuardVersion, undefined);
    assert.equal(record.equipment.name, 'Microscope');
    assert.equal(record.phase, 'upcoming');
  }
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await mine('?page=3&limit=2').expect(200)).body.data.length, 0);
});

test('history includes cancelled future and started records, with exact phase boundaries and reverse sorting', async () => {
  const end = new Date(START.getTime() + 3_600_000);
  const cancelled = await seed({
    startAt: new Date(START.getTime() + 7_200_000),
    status: 'cancelled',
    cancellationReason: 'student_cancelled',
    cancelledAt: NOW,
  });
  const inProgress = await seed({ startAt: START });
  const past = await seed({ startAt: new Date(START.getTime() - 3_600_000) });
  const future = await seed({ startAt: end });
  clock.now.mockReturnValue(START);
  const history = (await mine('?view=history').expect(200)).body.data;
  assert.deepEqual(
    history.map((record) => record.id),
    [cancelled.id, inProgress.id, past.id],
  );
  assert.deepEqual(
    history.map((record) => record.phase),
    ['upcoming', 'inProgress', 'past'],
  );
  assert.deepEqual(
    (await mine().expect(200)).body.data.map((record) => record.id),
    [future.id],
  );
  const everything = (await mine('?view=all').expect(200)).body.data;
  assert.deepEqual(
    everything.map((record) => record.id),
    [cancelled.id, future.id, inProgress.id, past.id],
  );
  clock.now.mockReturnValue(end);
  const later = (await mine('?view=history').expect(200)).body.data;
  assert.equal(
    later.find((record) => record.id === inProgress.id).phase,
    'past',
  );
  assert.equal(
    later.find((record) => record.id === future.id).phase,
    'inProgress',
  );
});

test('admin lists include only safe student summaries and combine equipment, student, and view filters', async () => {
  const other = await Equipment.create({
    ...metadata,
    assetCode: 'OTHER',
    statusUpdatedBy: admin.id,
  });
  await seed();
  const selected = await seed({
    studentId: otherStudent.id,
    startAt: legalSlotStarts(NOW)[1],
  });
  await seed({ studentId: otherStudent.id, equipmentId: other.id });
  const response = await all(
    `?equipmentId=${item.id}&studentId=${otherStudent.id}&view=all`,
  ).expect(200);
  assert.equal(response.body.pagination.total, 1);
  assert.equal(response.body.data[0].id, selected.id);
  assert.deepEqual(response.body.data[0].student, {
    id: otherStudent.id,
    name: otherStudent.name,
    email: otherStudent.email,
  });
  assert.equal(response.body.data[0].student.passwordHash, undefined);
  assert.equal((await all().expect(200)).body.pagination.total, 3);
  assert.equal(
    (await all('?view=history').expect(200)).body.pagination.total,
    0,
  );
});

test('archived equipment and its cancellation remain readable in student and admin history', async () => {
  const record = await seed();
  await adminSession.agent
    .delete(`/api/v1/equipment/${item.id}`)
    .set('X-CSRF-Token', adminSession.token)
    .expect(204);
  for (const response of [
    await mine('?view=history').expect(200),
    await all('?view=history').expect(200),
  ]) {
    const data = response.body.data[0];
    assert.equal(data.id, record.id);
    assert.equal(data.status, 'cancelled');
    assert.equal(data.cancellationReason, 'equipment_archived');
    assert.deepEqual(data.equipment, {
      id: item.id,
      assetCode: item.assetCode,
      name: item.name,
      location: item.location,
      status: 'unavailable',
      archived: true,
    });
  }
  const repeated = await cancel(record.id).expect(200);
  assert.equal(repeated.body.data.cancellationReason, 'equipment_archived');
  assert.equal(
    (await Reservation.findById(record.id)).cancelledBy.toString(),
    admin.id,
  );
});

test('students cancel only their own future reservation and the slot becomes bookable again', async () => {
  const record = await seed();
  const response = await cancel(record.id).expect(200);
  assert.equal(response.body.data.status, 'cancelled');
  assert.equal(response.body.data.cancellationReason, 'student_cancelled');
  assert.equal(response.body.data.cancelledAt, NOW.toISOString());
  assert.equal(response.body.data.student, undefined);
  const stored = await Reservation.findById(record.id);
  assert.equal(stored.cancelledBy.toString(), student.id);
  assert.equal((await mine().expect(200)).body.pagination.total, 0);
  assert.equal(
    (await mine('?view=history').expect(200)).body.pagination.total,
    1,
  );
  await otherSession.agent
    .post('/api/v1/reservations')
    .set('X-CSRF-Token', otherSession.token)
    .send({ equipmentId: item.id, startAt: START.toISOString() })
    .expect(201);
  assert.equal(await Reservation.countDocuments(), 2);
});

test('admin cancellation works for any future reservation and records the administrator', async () => {
  const record = await seed({ studentId: otherStudent.id });
  const response = await cancel(record.id, adminSession, {}).expect(200);
  assert.equal(response.body.data.cancellationReason, 'admin_cancelled');
  assert.equal(response.body.data.student.id, otherStudent.id);
  const stored = await Reservation.findById(record.id);
  assert.equal(stored.cancelledBy.toString(), admin.id);
  assert.equal(stored.cancelledAt.toISOString(), NOW.toISOString());
});

test('non-owned and nonexistent IDs consistently return 404, including cancelled records', async () => {
  const record = await seed();
  failure(await cancel(record.id, otherSession), 404, 'RESOURCE_NOT_FOUND');
  failure(
    await cancel(new mongoose.Types.ObjectId().toString()),
    404,
    'RESOURCE_NOT_FOUND',
  );
  await cancel(record.id).expect(200);
  failure(await cancel(record.id, otherSession), 404, 'RESOURCE_NOT_FOUND');
  assert.equal(
    (await Reservation.findById(record.id)).cancelledBy.toString(),
    student.id,
  );
});

test('cancellation enforces authentication, CSRF, strict IDs and empty bodies', async () => {
  const record = await seed();
  failure(await cancel(record.id, await sessionFor()), 401, 'AUTH_REQUIRED');
  failure(
    await studentSession.agent.patch(
      `/api/v1/reservations/${record.id}/cancel`,
    ),
    403,
    'CSRF_INVALID',
  );
  failure(await cancel('invalid'), 400, 'VALIDATION_ERROR');
  for (const body of [
    { cancellationReason: 'admin_cancelled' },
    { studentId: student.id },
    { status: 'cancelled' },
    { serverNow: NOW.toISOString() },
    [],
  ]) {
    failure(
      await cancel(record.id, studentSession, body),
      400,
      'VALIDATION_ERROR',
    );
  }
  assert.equal((await Reservation.findById(record.id)).status, 'active');
});

test.each([0, 1, 3_600_000])(
  'cancellation rejects started and past slots at start + %i ms for either role',
  async (offset) => {
    const record = await seed();
    clock.now.mockReturnValue(new Date(START.getTime() + offset));
    for (const session of [studentSession, adminSession])
      failure(
        await cancel(record.id, session),
        409,
        'RESERVATION_ALREADY_STARTED',
      );
    const stored = await Reservation.findById(record.id);
    assert.equal(stored.status, 'active');
    assert.equal(stored.cancelledAt, null);
    assert.equal(stored.cancelledBy, null);
  },
);

test('one millisecond before start is cancellable and repeats preserve audit even after start', async () => {
  const record = await seed();
  const before = new Date(START.getTime() - 1);
  clock.now.mockReturnValue(before);
  await cancel(record.id).expect(200);
  const first = await Reservation.findById(record.id).lean();
  clock.now.mockReturnValue(new Date(START.getTime() + 7_200_000));
  await cancel(record.id).expect(200);
  await cancel(record.id, adminSession).expect(200);
  assert.deepEqual(await Reservation.findById(record.id).lean(), first);
});

test('concurrent student/admin cancellation preserves one coherent audit and all calls are idempotent', async () => {
  const record = await seed();
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      cancel(record.id, index % 2 ? studentSession : adminSession),
    ),
  );
  for (const response of responses) assert.equal(response.status, 200);
  const stored = await Reservation.findById(record.id);
  const reason =
    stored.cancelledBy.toString() === student.id
      ? 'student_cancelled'
      : 'admin_cancelled';
  assert.equal(stored.cancellationReason, reason);
  assert.equal(stored.cancelledAt.toISOString(), NOW.toISOString());
  for (const response of responses)
    assert.equal(response.body.data.cancellationReason, reason);
  assert.equal(await Reservation.countDocuments(), 1);
});

test('cancellation racing maintenance preserves cancellation history and leaves no active future booking', async () => {
  const record = await seed();
  await Promise.all([
    cancel(record.id).expect(200),
    adminSession.agent
      .patch(`/api/v1/equipment/${item.id}/status`)
      .set('X-CSRF-Token', adminSession.token)
      .send({ status: 'maintenance', reason: 'Calibration' })
      .expect(200),
  ]);
  const stored = await Reservation.findById(record.id);
  assert.equal(stored.status, 'cancelled');
  assert.equal(stored.cancelledAt.toISOString(), NOW.toISOString());
  if (stored.cancellationReason === 'student_cancelled')
    assert.equal(stored.cancelledBy.toString(), student.id);
  else {
    assert.equal(stored.cancellationReason, 'equipment_maintenance');
    assert.equal(stored.cancelledBy.toString(), admin.id);
  }
  assert.equal(
    await Reservation.countDocuments({
      status: 'active',
      startAt: { $gt: NOW },
    }),
    0,
  );
});
