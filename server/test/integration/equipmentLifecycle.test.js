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
import { createEquipmentService } from '../../src/modules/equipment/equipment.service.js';
import { getReservationModel } from '../../src/modules/reservations/reservation.model.js';
import { clock } from '../../src/shared/clock.js';
import { withTransaction } from '../../src/shared/asyncTransaction.js';
import { createLogger } from '../../src/shared/logger.js';

const NOW = new Date('2026-10-23T04:30:00.000Z');
const password = 'lifecycle test password';
let replicaSet,
  connection,
  env,
  app,
  Equipment,
  Reservation,
  service,
  admin,
  student,
  adminSession,
  studentSession;
const metadata = {
  assetCode: 'SCOPE-01',
  name: 'Microscope',
  category: 'Optics',
  location: 'Lab A',
};

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  connection = await mongoose
    .createConnection(replicaSet.getUri('lifecycle_test'), { autoIndex: false })
    .asPromise();
  await ensureCriticalIndexes(connection);
  Equipment = getEquipmentModel(connection);
  Reservation = getReservationModel(connection);
  service = createEquipmentService(connection);
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
    MONGODB_URI: replicaSet.getUri('lifecycle_test'),
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
  await Equipment.deleteMany({});
  await Reservation.deleteMany({});
  await connection.db.collection('sessions').deleteMany({});
  app = createApp({ env, connection, logger: createLogger('silent') });
  adminSession = await sessionFor(admin);
  studentSession = await sessionFor(student);
  vi.spyOn(clock, 'now').mockReturnValue(NOW);
});

function changeStatus(id, body, session = adminSession) {
  return session.agent
    .patch(`/api/v1/equipment/${id}/status`)
    .set('X-CSRF-Token', session.token)
    .send(body);
}
function archive(id, session = adminSession) {
  return session.agent
    .delete(`/api/v1/equipment/${id}`)
    .set('X-CSRF-Token', session.token);
}
function assertFailure(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.equal(response.body.error.requestId, response.headers['x-request-id']);
}
async function world() {
  const item = await Equipment.create({
    ...metadata,
    statusUpdatedBy: admin.id,
  });
  const other = await Equipment.create({
    ...metadata,
    assetCode: 'OTHER',
    statusUpdatedBy: admin.id,
  });
  const reservations = {};
  for (const [key, offset] of Object.entries({
    past: -7200000,
    started: -1800000,
    boundary: 0,
    future: 3600000,
    later: 7200000,
  })) {
    reservations[key] = await Reservation.create({
      studentId: student.id,
      equipmentId: item.id,
      startAt: new Date(NOW.getTime() + offset),
    });
  }
  reservations.cancelled = await Reservation.create({
    studentId: student.id,
    equipmentId: item.id,
    startAt: new Date(NOW.getTime() + 10800000),
    status: 'cancelled',
    cancelledAt: new Date(NOW.getTime() - 1000),
    cancelledBy: student.id,
    cancellationReason: 'student_cancelled',
  });
  reservations.other = await Reservation.create({
    studentId: student.id,
    equipmentId: other.id,
    startAt: new Date(NOW.getTime() + 3600000),
  });
  return { item, other, reservations };
}
async function assertCancelled(reservations, reason) {
  for (const key of ['future', 'later']) {
    const stored = await Reservation.findById(reservations[key].id);
    assert.equal(stored.status, 'cancelled');
    assert.equal(stored.cancelledBy.toString(), admin.id);
    assert.equal(stored.cancelledAt.toISOString(), NOW.toISOString());
    assert.equal(stored.cancellationReason, reason);
  }
  for (const key of ['past', 'started', 'boundary', 'other', 'cancelled']) {
    assert.deepEqual(
      (await Reservation.findById(reservations[key].id)).toObject(),
      reservations[key].toObject(),
    );
  }
}

test.each(['maintenance', 'unavailable'])(
  '%s atomically cancels only future active reservations with the correct audit',
  async (status) => {
    const { item, reservations } = await world();
    const response = await changeStatus(item.id, {
      status,
      reason: '  Calibration required  ',
    }).expect(200);
    assert.equal(response.body.data.equipment.status, status);
    assert.equal(
      response.body.data.equipment.statusReason,
      'Calibration required',
    );
    assert.equal(response.body.data.cancelledReservationCount, 2);
    const updated = await Equipment.findById(item.id);
    assert.equal(updated.statusUpdatedAt.toISOString(), NOW.toISOString());
    assert.equal(updated.statusUpdatedBy.toString(), admin.id);
    assert.equal(updated.reservationGuardVersion, 1);
    assert.equal(updated.archivedAt, null);
    await assertCancelled(reservations, `equipment_${status}`);
    assert.equal(await Reservation.countDocuments(), 7);
  },
);

test('exact repeats are no-ops; reason changes update audit; returning available restores no reservations', async () => {
  const { item, reservations } = await world();
  await changeStatus(item.id, {
    status: 'maintenance',
    reason: 'Calibration',
  }).expect(200);
  const snapshot = (await Equipment.findById(item.id)).toObject();
  clock.now.mockReturnValue(new Date(NOW.getTime() + 60000));
  const repeated = await changeStatus(item.id, {
    status: 'maintenance',
    reason: ' Calibration ',
  }).expect(200);
  assert.equal(repeated.body.data.cancelledReservationCount, 0);
  assert.deepEqual((await Equipment.findById(item.id)).toObject(), snapshot);
  const edited = await changeStatus(item.id, {
    status: 'maintenance',
    reason: 'Replacement needed',
  }).expect(200);
  assert.equal(edited.body.data.cancelledReservationCount, 0);
  assert.equal(
    edited.body.data.equipment.statusUpdatedAt,
    clock.now().toISOString(),
  );
  const available = await changeStatus(item.id, {
    status: 'available',
    reason: 'Ignored reason',
  }).expect(200);
  assert.equal(available.body.data.equipment.statusReason, null);
  assert.equal(available.body.data.cancelledReservationCount, 0);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 3);
  clock.now.mockReturnValue(NOW);
  await assertCancelled(reservations, 'equipment_maintenance');
});

test('archiving preserves equipment and reservation history and is idempotent', async () => {
  const { item, reservations } = await world();
  await archive(item.id).expect(204);
  const stored = await Equipment.findById(item.id);
  assert.equal(stored.status, 'unavailable');
  assert.equal(stored.statusReason, 'Equipment archived.');
  assert.equal(stored.archivedAt.toISOString(), NOW.toISOString());
  assert.equal(stored.archivedBy.toString(), admin.id);
  assert.equal(stored.statusUpdatedBy.toString(), admin.id);
  assert.equal(stored.reservationGuardVersion, 1);
  await assertCancelled(reservations, 'equipment_archived');
  const history = await Reservation.findById(reservations.past.id).populate(
    'equipmentId',
  );
  assert.equal(history.equipmentId.id, item.id);
  assert.equal(history.equipmentId.name, metadata.name);
  for (const session of [studentSession, adminSession]) {
    assertFailure(
      await session.agent.get(`/api/v1/equipment/${item.id}`),
      404,
      'RESOURCE_NOT_FOUND',
    );
    const catalog = await session.agent.get('/api/v1/equipment').expect(200);
    assert.equal(
      catalog.body.data.some((entry) => entry.id === item.id),
      false,
    );
  }
  await archive(item.id).expect(204);
  assert.deepEqual(
    (await Equipment.findById(item.id)).toObject(),
    stored.toObject(),
  );
  assert.equal(await Reservation.countDocuments(), 7);
  assertFailure(
    await changeStatus(item.id, { status: 'available' }),
    404,
    'RESOURCE_NOT_FOUND',
  );
});

test('lifecycle APIs require authenticated admins and CSRF, and services reject students', async () => {
  const { item } = await world();
  const anonymous = await sessionFor();
  for (const [session, status, code] of [
    [anonymous, 401, 'AUTH_REQUIRED'],
    [studentSession, 403, 'FORBIDDEN'],
  ]) {
    assertFailure(
      await changeStatus(
        item.id,
        { status: 'unavailable', reason: 'Broken' },
        session,
      ),
      status,
      code,
    );
    assertFailure(await archive(item.id, session), status, code);
  }
  assertFailure(
    await adminSession.agent
      .patch(`/api/v1/equipment/${item.id}/status`)
      .send({ status: 'available' }),
    403,
    'CSRF_INVALID',
  );
  assertFailure(
    await adminSession.agent.delete(`/api/v1/equipment/${item.id}`),
    403,
    'CSRF_INVALID',
  );
  const actor = { userId: student.id, role: 'student' };
  await assert.rejects(
    service.changeStatus(item.id, { status: 'available' }, actor),
    (error) => error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    service.archive(item.id, actor),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 0);
});

test('status validation requires normalized reasons and rejects unknown and audit fields', async () => {
  const { item } = await world();
  for (const body of [
    {},
    { status: 'broken' },
    { status: 'maintenance' },
    { status: 'unavailable', reason: '   ' },
    { status: 'maintenance', reason: 'x'.repeat(501) },
    { status: 'maintenance', reason: null },
    { status: 'available', archivedAt: NOW },
    { status: 'available', statusUpdatedBy: student.id },
  ]) {
    assertFailure(await changeStatus(item.id, body), 400, 'VALIDATION_ERROR');
  }
  assertFailure(
    await changeStatus('invalid', { status: 'available' }),
    400,
    'VALIDATION_ERROR',
  );
  assertFailure(await archive('invalid'), 400, 'VALIDATION_ERROR');
  const missing = new mongoose.Types.ObjectId().toString();
  assertFailure(
    await changeStatus(missing, { status: 'available' }),
    404,
    'RESOURCE_NOT_FOUND',
  );
  assertFailure(await archive(missing), 404, 'RESOURCE_NOT_FOUND');
  assert.equal((await Equipment.findById(item.id)).status, 'available');
});

test.each(['status', 'archive'])(
  'a failure after reservation writes rolls back all %s changes',
  async (operation) => {
    const { item, reservations } = await world();
    const snapshot = item.toObject();
    const original = Reservation.updateMany.bind(Reservation);
    const cancel = vi
      .spyOn(Reservation, 'updateMany')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('Simulated failure after cancellation.');
      });
    try {
      const response = await (operation === 'status'
        ? changeStatus(item.id, {
            status: 'maintenance',
            reason: 'Calibration',
          })
        : archive(item.id));
      assertFailure(response, 500, 'INTERNAL_ERROR');
    } finally {
      cancel.mockRestore();
    }
    assert.deepEqual((await Equipment.findById(item.id)).toObject(), snapshot);
    for (const reservation of Object.values(reservations)) {
      assert.deepEqual(
        (await Reservation.findById(reservation.id)).toObject(),
        reservation.toObject(),
      );
    }
  },
);

test('concurrent status changes serialize guard writes and cancel each reservation once', async () => {
  const { item } = await world();
  const results = await Promise.all([
    changeStatus(item.id, { status: 'maintenance', reason: 'Calibration' }),
    changeStatus(item.id, { status: 'unavailable', reason: 'Power failure' }),
  ]);
  for (const response of results) assert.equal(response.status, 200);
  assert.equal(
    results.reduce(
      (sum, response) => sum + response.body.data.cancelledReservationCount,
      0,
    ),
    2,
  );
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 2);
  assert.equal(
    await Reservation.countDocuments({
      equipmentId: item.id,
      status: 'active',
      startAt: { $gt: NOW },
    }),
    0,
  );
});

test('concurrent archive requests remain idempotent', async () => {
  const { item, reservations } = await world();
  const responses = await Promise.all([
    archive(item.id),
    archive(item.id),
    archive(item.id),
  ]);
  for (const response of responses) assert.equal(response.status, 204);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 1);
  await assertCancelled(reservations, 'equipment_archived');
});

test('the lifecycle guard serializes a competing guarded booking write', async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const item = await Equipment.create({
      ...metadata,
      assetCode: `RACE-${attempt}`,
      statusUpdatedBy: admin.id,
    });
    const actor = { userId: admin.id, role: 'admin' };
    const [booked, changed] = await Promise.all([
      withTransaction(connection, async (session) => {
        const guarded = await Equipment.findOneAndUpdate(
          { _id: item.id, archivedAt: null, status: 'available' },
          { $inc: { reservationGuardVersion: 1 } },
          { session, returnDocument: 'after' },
        );
        if (!guarded) return false;
        await Reservation.create(
          [
            {
              equipmentId: item.id,
              studentId: student.id,
              startAt: new Date(NOW.getTime() + 3600000),
            },
          ],
          { session },
        );
        return true;
      }),
      service.changeStatus(
        item.id,
        { status: 'maintenance', reason: 'Calibration' },
        actor,
      ),
    ]);
    assert.equal(changed.cancelledReservationCount, booked ? 1 : 0);
    assert.equal(
      (await Equipment.findById(item.id)).reservationGuardVersion,
      booked ? 2 : 1,
    );
    assert.equal(
      await Reservation.countDocuments({
        equipmentId: item.id,
        status: 'active',
        startAt: { $gt: NOW },
      }),
      0,
    );
  }
});
