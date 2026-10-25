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
import { getFaultReportModel } from '../../src/modules/faultReports/faultReport.model.js';
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
  FaultReport,
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
    .createConnection(replicaSet.getUri('fault_reports_test'), {
      autoIndex: false,
    })
    .asPromise();
  await ensureCriticalIndexes(connection);
  Equipment = getEquipmentModel(connection);
  Reservation = getReservationModel(connection);
  FaultReport = getFaultReportModel(connection);
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
    MONGODB_URI: replicaSet.getUri('fault_reports_test'),
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
  await FaultReport.deleteMany({});
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

const reportInput = {
  category: 'malfunction',
  title: 'Unstable image',
  description: 'The image flickers during normal operation.',
};
function create(
  body = { equipmentId: item.id, ...reportInput },
  session = studentSession,
) {
  return session.agent
    .post('/api/v1/fault-reports')
    .set('X-CSRF-Token', session.token)
    .send(body);
}
function resolve(
  id,
  body = { resolutionNote: 'Calibrated and tested.' },
  session = adminSession,
) {
  return session.agent
    .patch(`/api/v1/fault-reports/${id}/resolve`)
    .set('X-CSRF-Token', session.token)
    .send(body);
}
function mine(query = '', session = studentSession) {
  return session.agent.get(`/api/v1/fault-reports/mine${query}`);
}
function all(query = '', session = adminSession) {
  return session.agent.get(`/api/v1/fault-reports${query}`);
}
function detail(id, session = studentSession) {
  return session.agent.get(`/api/v1/fault-reports/${id}`);
}
function failure(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.ok(response.body.error.requestId);
}
function seed(input = {}) {
  return FaultReport.create({
    equipmentId: item.id,
    reportedBy: student.id,
    ...reportInput,
    ...input,
  });
}

test('startup creates the three specified fault-report indexes', async () => {
  const indexes = await FaultReport.collection.indexes();
  for (const [name, key] of [
    ['idx_fault_status_created', { status: 1, createdAt: -1 }],
    ['idx_fault_reporter_created', { reportedBy: 1, createdAt: -1 }],
    ['idx_fault_equipment_created', { equipmentId: 1, createdAt: -1 }],
  ])
    assert.deepEqual(indexes.find((index) => index.name === name).key, key);
});

test.each(['available', 'maintenance', 'unavailable'])(
  'reporting on %s equipment preserves equipment and reservation state',
  async (status) => {
    await Equipment.updateOne(
      { _id: item.id },
      {
        $set: {
          status,
          statusReason: status === 'available' ? null : 'Inspection',
        },
      },
    );
    const before = await Equipment.findById(item.id).lean();
    const booking = await Reservation.create({
      equipmentId: item.id,
      studentId: student.id,
      startAt: START,
    });
    const response = await create({
      equipmentId: item.id,
      category: 'safety',
      title: '  Suspected loose part  ',
      description: '  A loose part moves near the power connector.  ',
    }).expect(201);
    const data = response.body.data;
    assert.equal(data.title, 'Suspected loose part');
    assert.equal(
      data.description,
      'A loose part moves near the power connector.',
    );
    assert.equal(data.status, 'open');
    assert.equal(data.resolutionNote, null);
    assert.equal(data.resolvedAt, null);
    assert.equal(data.resolvedBy, null);
    assert.equal(data.reportedBy, undefined);
    assert.equal(data.equipment.status, status);
    assert.equal(data.equipment.archived, false);
    assert.deepEqual(
      Object.keys(data).sort(),
      [
        'id',
        'category',
        'title',
        'description',
        'status',
        'resolutionNote',
        'resolvedAt',
        'resolvedBy',
        'createdAt',
        'updatedAt',
        'equipment',
      ].sort(),
    );
    assert.equal(data.equipment.reservationGuardVersion, undefined);
    assert.equal(
      (await FaultReport.findById(data.id)).reportedBy.toString(),
      student.id,
    );
    assert.deepEqual(await Equipment.findById(item.id).lean(), before);
    assert.deepEqual(
      await Reservation.findById(booking.id).lean(),
      booking.toObject(),
    );
  },
);

test('creation accepts all five categories and exact trimmed text bounds', async () => {
  for (const category of [
    'malfunction',
    'damage',
    'calibration',
    'safety',
    'other',
  ]) {
    await create({
      equipmentId: item.id,
      category,
      title: 'a'.repeat(5),
      description: 'b'.repeat(10),
    }).expect(201);
  }
  const response = await create({
    equipmentId: item.id,
    category: 'other',
    title: ` ${'a'.repeat(100)} `,
    description: ` ${'b'.repeat(2000)} `,
  }).expect(201);
  assert.equal(response.body.data.title.length, 100);
  assert.equal(response.body.data.description.length, 2000);
});

test('strict creation validation rejects invalid bounds, categories, IDs, uploads and audit injection', async () => {
  const valid = { equipmentId: item.id, ...reportInput };
  for (const patch of [
    { equipmentId: 'invalid' },
    { category: 'urgent' },
    { category: '' },
    { title: '    ' },
    { title: 'abcd' },
    { title: 'a'.repeat(101) },
    { description: 'abcdefghi' },
    { description: '  ' },
    { description: 'a'.repeat(2001) },
    { reportedBy: otherStudent.id },
    { status: 'resolved' },
    { resolvedAt: NOW.toISOString() },
    { resolvedBy: admin.id },
    { resolutionNote: 'Resolved' },
    { image: 'data:image/png;base64,AA' },
  ])
    failure(await create({ ...valid, ...patch }), 400, 'VALIDATION_ERROR');
  const response = await create({ ...valid, title: 'short'.slice(0, 4) });
  assert.ok(response.body.error.fieldErrors['body.title']);
  assert.equal(await FaultReport.countDocuments(), 0);
});

test('creation requires a student session and CSRF token', async () => {
  failure(await create(undefined, await sessionFor()), 401, 'AUTH_REQUIRED');
  failure(await create(undefined, adminSession), 403, 'FORBIDDEN');
  failure(
    await studentSession.agent
      .post('/api/v1/fault-reports')
      .send({ equipmentId: item.id, ...reportInput }),
    403,
    'CSRF_INVALID',
  );
  assert.equal(await FaultReport.countDocuments(), 0);
});

test('missing and archived equipment reject new reports while existing history remains resolvable', async () => {
  const existing = await seed();
  failure(
    await create({
      equipmentId: new mongoose.Types.ObjectId().toString(),
      ...reportInput,
    }),
    404,
    'RESOURCE_NOT_FOUND',
  );
  await adminSession.agent
    .delete(`/api/v1/equipment/${item.id}`)
    .set('X-CSRF-Token', adminSession.token)
    .expect(204);
  failure(await create(), 404, 'RESOURCE_NOT_FOUND');
  const archived = (await detail(existing.id).expect(200)).body.data;
  assert.equal(archived.equipment.archived, true);
  assert.equal(archived.status, 'open');
  const before = await Equipment.findById(item.id).lean();
  await resolve(existing.id).expect(200);
  assert.deepEqual(await Equipment.findById(item.id).lean(), before);
  assert.equal(
    (await mine('?status=resolved').expect(200)).body.pagination.total,
    1,
  );
});

test('mine isolates ownership and supports newest-first sorting, status filters, pagination and empty pages', async () => {
  const older = await seed({ createdAt: new Date('2026-10-20T00:00:00Z') });
  const newer = await seed({ createdAt: new Date('2026-10-21T00:00:00Z') });
  await seed({ reportedBy: otherStudent.id });
  const first = await mine('?page=1&limit=1').expect(200);
  assert.deepEqual(first.body.pagination, {
    page: 1,
    limit: 1,
    total: 2,
    totalPages: 2,
  });
  assert.equal(first.body.data[0].id, newer.id);
  assert.equal(first.body.data[0].reportedBy, undefined);
  assert.equal(
    (await mine('?page=2&limit=1').expect(200)).body.data[0].id,
    older.id,
  );
  assert.deepEqual((await mine('?page=3&limit=1').expect(200)).body.data, []);
  await resolve(newer.id).expect(200);
  assert.deepEqual(
    (await mine('?status=open').expect(200)).body.data.map(
      (report) => report.id,
    ),
    [older.id],
  );
  assert.deepEqual(
    (await mine('?status=resolved').expect(200)).body.data.map(
      (report) => report.id,
    ),
    [newer.id],
  );
  assert.equal(first.headers['cache-control'], 'no-store');
});

test('admin lists combine filters and expose only safe reporter and resolver summaries', async () => {
  const other = await Equipment.create({
    ...metadata,
    assetCode: 'OTHER',
    statusUpdatedBy: admin.id,
  });
  const selected = await seed({ reportedBy: otherStudent.id });
  await seed();
  await seed({ equipmentId: other.id, reportedBy: otherStudent.id });
  await resolve(selected.id).expect(200);
  const response = await all(
    `?equipmentId=${item.id}&reportedBy=${otherStudent.id}&status=resolved`,
  ).expect(200);
  assert.equal(response.body.pagination.total, 1);
  const data = response.body.data[0];
  assert.equal(data.id, selected.id);
  assert.deepEqual(data.reportedBy, {
    id: otherStudent.id,
    name: otherStudent.name,
    email: otherStudent.email,
  });
  assert.deepEqual(data.resolvedBy, {
    id: admin.id,
    name: admin.name,
    email: admin.email,
  });
  assert.equal(JSON.stringify(data).includes('passwordHash'), false);
  assert.equal((await all().expect(200)).body.pagination.total, 3);
});

test('list and detail authorization prevents horizontal access and validates strict queries', async () => {
  const report = await seed();
  failure(
    await request(app).get('/api/v1/fault-reports'),
    401,
    'AUTH_REQUIRED',
  );
  failure(await mine('', adminSession), 403, 'FORBIDDEN');
  failure(await all('', studentSession), 403, 'FORBIDDEN');
  failure(await detail(report.id, otherSession), 404, 'RESOURCE_NOT_FOUND');
  failure(
    await request(app).get(`/api/v1/fault-reports/${report.id}`),
    401,
    'AUTH_REQUIRED',
  );
  failure(await detail('invalid'), 400, 'VALIDATION_ERROR');
  failure(
    await detail(new mongoose.Types.ObjectId().toString()),
    404,
    'RESOURCE_NOT_FOUND',
  );
  await detail(report.id).expect(200);
  await detail(report.id, adminSession).expect(200);
  for (const query of [
    '?status=all',
    '?page=0',
    '?limit=51',
    '?page=1.5',
    '?limit=0',
    `?reportedBy=${otherStudent.id}`,
    `?equipmentId=${item.id}`,
    '?unknown=value',
  ])
    failure(await mine(query), 400, 'VALIDATION_ERROR');
  for (const query of [
    '?equipmentId=invalid',
    '?reportedBy=invalid',
    '?reportedBy[$ne]=null',
  ])
    failure(await all(query), 400, 'VALIDATION_ERROR');
});

test('resolution sets audit exactly once and leaves equipment and reservations unchanged', async () => {
  const report = await seed();
  const booking = await Reservation.create({
    equipmentId: item.id,
    studentId: student.id,
    startAt: START,
  });
  const before = await Equipment.findById(item.id).lean();
  const response = await resolve(report.id, {
    resolutionNote: '  Replaced loose connector.  ',
  }).expect(200);
  assert.equal(response.body.data.status, 'resolved');
  assert.equal(response.body.data.resolutionNote, 'Replaced loose connector.');
  assert.equal(response.body.data.resolvedAt, NOW.toISOString());
  assert.equal(response.body.data.resolvedBy.id, admin.id);
  const stored = await FaultReport.findById(report.id).lean();
  assert.equal(stored.resolvedBy.toString(), admin.id);
  clock.now.mockReturnValue(new Date('2026-10-27T00:00:00Z'));
  failure(
    await resolve(report.id, { resolutionNote: 'Attempt to overwrite' }),
    409,
    'FAULT_ALREADY_RESOLVED',
  );
  assert.deepEqual(await FaultReport.findById(report.id).lean(), stored);
  assert.deepEqual(await Equipment.findById(item.id).lean(), before);
  assert.deepEqual(
    await Reservation.findById(booking.id).lean(),
    booking.toObject(),
  );
  const owner = (await detail(report.id).expect(200)).body.data;
  assert.equal(owner.resolvedBy.name, admin.name);
  assert.equal(owner.resolutionNote, 'Replaced loose connector.');
});

test('resolution rejects students, missing CSRF, invalid notes and attempts to reopen or inject audit', async () => {
  const report = await seed();
  failure(
    await resolve(report.id, undefined, studentSession),
    403,
    'FORBIDDEN',
  );
  failure(await resolve(report.id, undefined, otherSession), 403, 'FORBIDDEN');
  failure(
    await resolve(report.id, undefined, await sessionFor()),
    401,
    'AUTH_REQUIRED',
  );
  failure(
    await adminSession.agent
      .patch(`/api/v1/fault-reports/${report.id}/resolve`)
      .send({ resolutionNote: 'Valid note' }),
    403,
    'CSRF_INVALID',
  );
  for (const body of [
    {},
    { resolutionNote: '    ' },
    { resolutionNote: 'abcd' },
    { resolutionNote: 'a'.repeat(1001) },
    { resolutionNote: 'Valid note', status: 'open' },
    { resolutionNote: 'Valid note', resolvedBy: student.id },
  ])
    failure(await resolve(report.id, body), 400, 'VALIDATION_ERROR');
  const invalid = await resolve(report.id, { resolutionNote: 'abcd' });
  assert.ok(invalid.body.error.fieldErrors['body.resolutionNote']);
  failure(
    await resolve(new mongoose.Types.ObjectId().toString()),
    404,
    'RESOURCE_NOT_FOUND',
  );
  failure(await resolve('invalid'), 400, 'VALIDATION_ERROR');
  assert.equal((await FaultReport.findById(report.id)).status, 'open');
});

test('resolution accepts exact 5 and 1000 character limits after trimming', async () => {
  for (const length of [5, 1000]) {
    const report = await seed();
    const response = await resolve(report.id, {
      resolutionNote: ` ${'a'.repeat(length)} `,
    }).expect(200);
    assert.equal(response.body.data.resolutionNote.length, length);
  }
});

test('concurrent resolution has one winner and cannot overwrite the winning note', async () => {
  const report = await seed();
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      resolve(report.id, { resolutionNote: `Resolution ${index}` }),
    ),
  );
  assert.equal(
    responses.filter((response) => response.status === 200).length,
    1,
  );
  for (const response of responses.filter(
    (response) => response.status !== 200,
  ))
    failure(response, 409, 'FAULT_ALREADY_RESOLVED');
  const winner = responses.find((response) => response.status === 200).body
    .data;
  assert.equal(
    (await FaultReport.findById(report.id)).resolutionNote,
    winner.resolutionNote,
  );
});

test('missing legacy equipment references remain readable and resolvable without leaking IDs', async () => {
  const report = await seed({ equipmentId: new mongoose.Types.ObjectId() });
  assert.equal((await detail(report.id).expect(200)).body.data.equipment, null);
  assert.equal((await all().expect(200)).body.data[0].equipment, null);
  await resolve(report.id).expect(200);
});
