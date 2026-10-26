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

const NOW = new Date('2026-10-26T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SINCE = new Date(NOW.getTime() - 30 * DAY);
const password = 'dashboard test password';
let replicaSet,
  connection,
  env,
  app,
  Equipment,
  Reservation,
  FaultReport,
  admin,
  student,
  adminSession,
  studentSession;
beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  connection = await mongoose
    .createConnection(replicaSet.getUri('dashboard_test'), { autoIndex: false })
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
  env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: replicaSet.getUri('dashboard_test'),
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
  vi.spyOn(clock, 'now').mockReturnValue(NOW);
});
function overview(session = adminSession) {
  return session.agent.get('/api/v1/admin/dashboard');
}
function equipment(input = {}) {
  return Equipment.create({
    assetCode: `EQ-${new mongoose.Types.ObjectId()}`,
    name: 'Microscope',
    category: 'Optics',
    location: 'Lab A',
    statusUpdatedBy: admin.id,
    ...input,
  });
}
function booking(item, startAt, status = 'active') {
  return Reservation.create({
    equipmentId: item.id,
    studentId: student.id,
    startAt,
    status,
  });
}
function fault(item, status = 'open') {
  return FaultReport.create({
    equipmentId: item.id,
    reportedBy: student.id,
    category: 'malfunction',
    title: 'Unstable image',
    description: 'The image flickers during use.',
    status,
    ...(status === 'resolved' && {
      resolutionNote: 'Calibrated and tested.',
      resolvedAt: NOW,
      resolvedBy: admin.id,
    }),
  });
}

test('dashboard requires an administrator session independently of the React guard', async () => {
  const anonymous = await request(app)
    .get('/api/v1/admin/dashboard')
    .expect(401);
  assert.equal(anonymous.body.error.code, 'AUTH_REQUIRED');
  const forbidden = await overview(studentSession).expect(403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');
  assert.equal(clock.now.mock.calls.length, 0);
});

test('empty collections return the complete zero-valued contract with no-store headers', async () => {
  const response = await overview().expect(200);
  assert.deepEqual(response.body, {
    data: {
      equipment: {
        total: 0,
        byStatus: { available: 0, maintenance: 0, unavailable: 0 },
      },
      upcomingReservationCount: 0,
      openFaultReportCount: 0,
      topEquipment: [],
    },
  });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(clock.now.mock.calls.length, 1);
});

test('equipment totals include all current statuses and exclude archives, including missing status groups', async () => {
  await equipment();
  await equipment();
  await equipment({ status: 'maintenance', statusReason: 'Calibration' });
  await equipment({ status: 'unavailable', statusReason: 'Unavailable part' });
  await equipment({
    archivedAt: NOW,
    archivedBy: admin.id,
    status: 'unavailable',
    statusReason: 'Equipment archived.',
  });
  const data = (await overview().expect(200)).body.data;
  assert.deepEqual(data.equipment, {
    total: 4,
    byStatus: { available: 2, maintenance: 1, unavailable: 1 },
  });
  await Equipment.deleteMany({ status: 'maintenance' });
  assert.equal(
    (await overview().expect(200)).body.data.equipment.byStatus.maintenance,
    0,
  );
});

test('upcoming count uses strictly future active starts, excluding cancelled, started and past reservations', async () => {
  const item = await equipment();
  await booking(item, new Date(NOW.getTime() + 1));
  await booking(item, new Date(NOW.getTime() + DAY));
  await booking(item, new Date(NOW.getTime() + 2 * DAY), 'cancelled');
  await booking(item, NOW);
  await booking(item, new Date(NOW.getTime() - 1));
  await booking(item, new Date(NOW.getTime() - DAY));
  const data = (await overview().expect(200)).body.data;
  assert.equal(data.upcomingReservationCount, 2);
  assert.equal(data.topEquipment[0].reservationCount, 2);
});

test('open faults include archived equipment reports and exclude resolved reports', async () => {
  const item = await equipment();
  const archived = await equipment({ archivedAt: NOW, archivedBy: admin.id });
  await fault(item);
  await fault(archived);
  await fault(item, 'resolved');
  const data = (await overview().expect(200)).body.data;
  assert.equal(data.openFaultReportCount, 2);
  assert.equal(data.equipment.total, 1);
});

test('Top 5 uses the inclusive 30-day lower bound and exclusive now, ignoring cancelled and missing equipment', async () => {
  const item = await equipment({ assetCode: 'SCOPE-01' });
  await booking(item, new Date(SINCE.getTime() - 1));
  await booking(item, SINCE);
  await booking(item, new Date(NOW.getTime() - 1));
  await booking(item, NOW);
  await booking(item, new Date(NOW.getTime() + 1));
  await booking(item, new Date(NOW.getTime() - DAY), 'cancelled');
  await Reservation.create({
    equipmentId: new mongoose.Types.ObjectId(),
    studentId: student.id,
    startAt: SINCE,
  });
  const data = (await overview().expect(200)).body.data;
  assert.deepEqual(data.topEquipment, [
    {
      equipmentId: item.id,
      assetCode: 'SCOPE-01',
      name: 'Microscope',
      reservationCount: 2,
    },
  ]);
});

test('Top 5 excludes archives before limiting, ranks counts then names, and includes current out-of-service equipment', async () => {
  const fixtures = [
    ['Zeta', 5, 'available'],
    ['Alpha', 3, 'maintenance'],
    ['Beta', 3, 'unavailable'],
    ['Gamma', 2, 'available'],
    ['Delta', 2, 'available'],
    ['Epsilon', 2, 'available'],
  ];
  const expected = [];
  for (const [name, count, status] of fixtures) {
    const item = await equipment({
      name,
      status,
      statusReason: status === 'available' ? null : 'Inspection',
    });
    for (let index = 0; index < count; index += 1)
      await booking(item, new Date(NOW.getTime() - DAY - index * 3_600_000));
    expected.push({
      equipmentId: item.id,
      assetCode: item.assetCode,
      name,
      reservationCount: count,
    });
  }
  const archived = await equipment({
    name: 'Archived leader',
    archivedAt: NOW,
    archivedBy: admin.id,
  });
  for (let index = 0; index < 8; index += 1)
    await booking(archived, new Date(NOW.getTime() - DAY - index * 3_600_000));
  await equipment({ name: 'Unused' });
  expected.sort(
    (a, b) =>
      b.reservationCount - a.reservationCount || a.name.localeCompare(b.name),
  );
  assert.deepEqual(
    (await overview().expect(200)).body.data.topEquipment,
    expected.slice(0, 5),
  );
});

test('equipment ID breaks equal-count, equal-name ties consistently', async () => {
  const items = [await equipment(), await equipment()];
  for (const item of items) await booking(item, SINCE);
  const expected = items.map((item) => item.id).sort();
  for (let index = 0; index < 2; index += 1)
    assert.deepEqual(
      (await overview().expect(200)).body.data.topEquipment.map(
        (item) => item.equipmentId,
      ),
      expected,
    );
});

test('every request recalculates metrics and the rolling window from the server clock', async () => {
  const item = await equipment();
  await booking(item, SINCE);
  const report = await fault(item);
  assert.equal(
    (await overview().expect(200)).body.data.topEquipment[0].reservationCount,
    1,
  );
  clock.now.mockReturnValue(new Date(NOW.getTime() + 1));
  await adminSession.agent
    .patch(`/api/v1/fault-reports/${report.id}/resolve`)
    .set('X-CSRF-Token', adminSession.token)
    .send({ resolutionNote: 'Calibrated and tested.' })
    .expect(200);
  const later = (await overview().expect(200)).body.data;
  assert.deepEqual(later.topEquipment, []);
  assert.equal(later.openFaultReportCount, 0);
  assert.equal(clock.now.mock.calls.length, 3);
});

test('aggregation failure returns the shared safe error contract rather than partial metrics', async () => {
  vi.spyOn(Equipment, 'aggregate').mockRejectedValueOnce(
    new Error('private database details'),
  );
  const response = await overview().expect(500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.ok(response.body.error.requestId);
  assert.equal(
    JSON.stringify(response.body).includes('private database details'),
    false,
  );
  assert.equal(response.body.data, undefined);
});
