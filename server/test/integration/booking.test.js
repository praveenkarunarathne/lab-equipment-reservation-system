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
import { createReservationService } from '../../src/modules/reservations/reservation.service.js';
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
    .createConnection(replicaSet.getUri('booking_test'), { autoIndex: false })
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
    MONGODB_URI: replicaSet.getUri('booking_test'),
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

function book(
  body = { equipmentId: item.id, startAt: START.toISOString() },
  session = studentSession,
) {
  return session.agent
    .post('/api/v1/reservations')
    .set('X-CSRF-Token', session.token)
    .send(body);
}
function availability(id = item.id, session = studentSession) {
  return session.agent.get(`/api/v1/equipment/${id}/availability`);
}
function statusChange(id, status) {
  return adminSession.agent
    .patch(`/api/v1/equipment/${id}/status`)
    .set('X-CSRF-Token', adminSession.token)
    .send({ status, reason: 'Safety inspection' });
}
function archive(id) {
  return adminSession.agent
    .delete(`/api/v1/equipment/${id}`)
    .set('X-CSRF-Token', adminSession.token);
}
function assertFailure(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.equal(response.body.error.requestId, response.headers['x-request-id']);
}

test('availability supplies authoritative UTC slots and Colombo labels to authenticated users', async () => {
  for (const session of [studentSession, adminSession]) {
    const response = await availability(item.id, session).expect(200);
    const data = response.body.data;
    assert.deepEqual(Object.keys(data).sort(), [
      'bookable',
      'equipmentId',
      'horizonDays',
      'slotDurationMinutes',
      'slots',
      'timezone',
    ]);
    assert.equal(data.equipmentId, item.id);
    assert.equal(data.bookable, true);
    assert.equal(data.timezone, 'Asia/Colombo');
    assert.equal(data.horizonDays, 14);
    assert.equal(data.slotDurationMinutes, 60);
    assert.equal(data.slots.length, 80);
    assert.deepEqual(data.slots[0], {
      startAt: START.toISOString(),
      endAt: '2026-10-26T04:00:00.000Z',
      label: 'Mon, 26 Oct 2026 08:30–09:30',
    });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assertFailure(
    await request(app).get(`/api/v1/equipment/${item.id}/availability`),
    401,
    'AUTH_REQUIRED',
  );
  assertFailure(await availability('not-an-id'), 400, 'VALIDATION_ERROR');
  assertFailure(
    await availability(new mongoose.Types.ObjectId().toString()),
    404,
    'RESOURCE_NOT_FOUND',
  );
});

test('availability excludes active bookings but retains cancelled slots and ignores other equipment', async () => {
  const starts = legalSlotStarts(NOW);
  const other = await Equipment.create({
    ...metadata,
    assetCode: 'OTHER',
    statusUpdatedBy: admin.id,
  });
  await Reservation.create({
    equipmentId: item.id,
    studentId: student.id,
    startAt: starts[0],
  });
  await Reservation.create({
    equipmentId: item.id,
    studentId: student.id,
    startAt: starts[1],
    status: 'cancelled',
    cancellationReason: 'student_cancelled',
  });
  await Reservation.create({
    equipmentId: other.id,
    studentId: student.id,
    startAt: starts[2],
  });
  const response = await availability().expect(200);
  assert.equal(response.body.data.slots.length, 79);
  const values = new Set(response.body.data.slots.map((slot) => slot.startAt));
  assert.equal(values.has(starts[0].toISOString()), false);
  assert.equal(values.has(starts[1].toISOString()), true);
  assert.equal(values.has(starts[2].toISOString()), true);
});

test('available equipment with every slot booked returns an empty advisory list', async () => {
  await Reservation.insertMany(
    legalSlotStarts(NOW).map((startAt) => ({
      equipmentId: item.id,
      studentId: student.id,
      startAt,
    })),
  );
  const response = await availability().expect(200);
  assert.equal(response.body.data.bookable, true);
  assert.deepEqual(response.body.data.slots, []);
});

test.each(['maintenance', 'unavailable'])(
  '%s equipment has no available slots and cannot be booked',
  async (status) => {
    await statusChange(item.id, status).expect(200);
    const response = await availability().expect(200);
    assert.equal(response.body.data.bookable, false);
    assert.deepEqual(response.body.data.slots, []);
    assertFailure(await book(), 409, 'EQUIPMENT_NOT_AVAILABLE');
    assert.equal(await Reservation.countDocuments(), 0);
  },
);

test('archived and missing equipment are rejected at the authoritative booking write', async () => {
  await archive(item.id).expect(204);
  assertFailure(await availability(), 404, 'RESOURCE_NOT_FOUND');
  assertFailure(await book(), 409, 'EQUIPMENT_NOT_AVAILABLE');
  assertFailure(
    await book({
      equipmentId: new mongoose.Types.ObjectId().toString(),
      startAt: START.toISOString(),
    }),
    409,
    'EQUIPMENT_NOT_AVAILABLE',
  );
  assert.equal(await Reservation.countDocuments(), 0);
});

test('booking creates the student-owned reservation and derives a safe DTO', async () => {
  const response = await book({
    equipmentId: item.id,
    startAt: '2026-10-26T08:30:00+05:30',
  }).expect(201);
  const data = response.body.data;
  assert.deepEqual(Object.keys(data).sort(), [
    'cancellationReason',
    'cancelledAt',
    'endAt',
    'equipment',
    'id',
    'phase',
    'startAt',
    'status',
  ]);
  assert.equal(data.startAt, START.toISOString());
  assert.equal(data.endAt, '2026-10-26T04:00:00.000Z');
  assert.equal(data.status, 'active');
  assert.equal(data.phase, 'upcoming');
  assert.equal(data.cancelledAt, null);
  assert.equal(data.cancellationReason, null);
  assert.deepEqual(data.equipment, {
    id: item.id,
    assetCode: metadata.assetCode,
    name: metadata.name,
    location: metadata.location,
    status: 'available',
    archived: false,
  });
  const stored = await Reservation.findById(data.id).lean();
  assert.equal(stored.studentId.toString(), student.id);
  for (const field of ['phase', 'endAt', 'completed', 'approval'])
    assert.equal(stored[field], undefined);
  const equipment = await Equipment.findById(item.id);
  assert.equal(equipment.reservationGuardVersion, 1);
  assert.equal(
    equipment.statusUpdatedAt.toISOString(),
    item.statusUpdatedAt.toISOString(),
  );
  assert.equal(
    (await availability().expect(200)).body.data.slots.some(
      (slot) => slot.startAt === START.toISOString(),
    ),
    false,
  );
});

test('all eight legal daily starts can be booked', async () => {
  for (let hour = 3; hour <= 10; hour += 1) {
    await book({
      equipmentId: item.id,
      startAt: new Date(Date.UTC(2026, 9, 26, hour)).toISOString(),
    }).expect(201);
  }
  assert.equal(await Reservation.countDocuments(), 8);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 8);
});

test('student authorization, CSRF, and strict input validation prevent ownership injection', async () => {
  const anonymous = await sessionFor();
  const body = { equipmentId: item.id, startAt: START.toISOString() };
  assertFailure(await book(body, anonymous), 401, 'AUTH_REQUIRED');
  assertFailure(await book(body, adminSession), 403, 'FORBIDDEN');
  assertFailure(
    await studentSession.agent.post('/api/v1/reservations').send(body),
    403,
    'CSRF_INVALID',
  );
  assertFailure(
    await studentSession.agent
      .post('/api/v1/reservations')
      .set('X-CSRF-Token', studentSession.token)
      .set('Sec-Fetch-Site', 'cross-site')
      .send(body),
    403,
    'CSRF_INVALID',
  );
  for (const extra of [
    { studentId: otherStudent.id },
    { status: 'active' },
    { phase: 'past' },
    { endAt: START.toISOString() },
    { serverNow: NOW.toISOString() },
    { role: 'admin' },
  ]) {
    assertFailure(await book({ ...body, ...extra }), 400, 'VALIDATION_ERROR');
  }
  for (const invalid of [
    { ...body, equipmentId: 'invalid' },
    { ...body, startAt: '2026-10-26T08:30:00' },
    { ...body, startAt: '2026-02-30T03:00:00Z' },
    { ...body, startAt: '2026-10-26T03:00:00.0000001Z' },
    { equipmentId: item.id },
  ]) {
    assertFailure(await book(invalid), 400, 'VALIDATION_ERROR');
  }
  await assert.rejects(
    createReservationService(connection).create(
      { equipmentId: item.id, startAt: START },
      { userId: admin.id, role: 'admin' },
    ),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(await Reservation.countDocuments(), 0);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 0);
});

test('illegal times and elapsed slots roll back their equipment guard writes', async () => {
  for (const startAt of [
    '2026-10-26T00:00:00Z',
    '2026-10-23T03:00:00Z',
    '2026-10-26T02:30:00Z',
    '2026-10-26T03:30:00Z',
    '2026-10-26T11:00:00Z',
    '2026-10-26T03:00:01Z',
    '2026-10-26T03:00:00.001Z',
    '2026-10-31T03:00:00Z',
    '2026-11-01T03:00:00Z',
    '2026-11-09T03:00:00Z',
  ]) {
    const response = await book({ equipmentId: item.id, startAt });
    assertFailure(response, 400, 'VALIDATION_ERROR');
    assert.ok(response.body.error.fieldErrors['body.startAt']);
  }
  assert.equal(await Reservation.countDocuments(), 0);
  assert.deepEqual(
    (await Equipment.findById(item.id)).toObject(),
    item.toObject(),
  );
});

test('the 14-day boundary is inclusive down to the millisecond', async () => {
  clock.now.mockReturnValue(START);
  const boundary = '2026-11-09T03:00:00.000Z';
  await book({ equipmentId: item.id, startAt: boundary }).expect(201);
  const other = await Equipment.create({
    ...metadata,
    assetCode: 'BOUNDARY',
    statusUpdatedBy: admin.id,
  });
  clock.now.mockReturnValue(new Date(START.getTime() - 1));
  assertFailure(
    await book({ equipmentId: other.id, startAt: boundary }),
    400,
    'VALIDATION_ERROR',
  );
  assert.equal((await Equipment.findById(other.id)).reservationGuardVersion, 0);
});

test('cancelled history permits rebooking, while duplicate active slots return a stable conflict', async () => {
  await Reservation.create({
    equipmentId: item.id,
    studentId: student.id,
    startAt: START,
    status: 'cancelled',
    cancelledAt: NOW,
    cancellationReason: 'student_cancelled',
  });
  await book().expect(201);
  assertFailure(
    await book(undefined, otherSession),
    409,
    'RESERVATION_CONFLICT',
  );
  assert.equal(await Reservation.countDocuments(), 2);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 1);
});

test('concurrent same-slot requests have exactly one winner and no orphaned guard increments', async () => {
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      book(
        {
          equipmentId: item.id,
          startAt:
            index % 2 ? '2026-10-26T08:30:00+05:30' : START.toISOString(),
        },
        index % 2 ? studentSession : otherSession,
      ),
    ),
  );
  assert.equal(
    responses.filter((response) => response.status === 201).length,
    1,
  );
  for (const response of responses.filter(
    (response) => response.status !== 201,
  ))
    assertFailure(response, 409, 'RESERVATION_CONFLICT');
  assert.equal(await Reservation.countDocuments(), 1);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 1);
}, 20_000);

test('failure after reservation insertion rolls back both the record and the guard', async () => {
  const original = Reservation.create.bind(Reservation);
  const create = vi
    .spyOn(Reservation, 'create')
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('Simulated post-insert failure.');
    });
  try {
    assertFailure(await book(), 500, 'INTERNAL_ERROR');
  } finally {
    create.mockRestore();
  }
  assert.equal(await Reservation.countDocuments(), 0);
  assert.deepEqual(
    (await Equipment.findById(item.id)).toObject(),
    item.toObject(),
  );
});

test('time is revalidated after waiting for the authoritative equipment write', async () => {
  const original = Equipment.findOneAndUpdate.bind(Equipment);
  const guard = vi
    .spyOn(Equipment, 'findOneAndUpdate')
    .mockImplementationOnce(async (...args) => {
      const equipment = await original(...args);
      clock.now.mockReturnValue(START);
      return equipment;
    });
  try {
    assertFailure(await book(), 400, 'VALIDATION_ERROR');
  } finally {
    guard.mockRestore();
  }
  assert.equal(await Reservation.countDocuments(), 0);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 0);
});

test('transient transaction retries obtain fresh time and reject a slot that has started', async () => {
  const create = vi
    .spyOn(Reservation, 'create')
    .mockImplementationOnce(async () => {
      clock.now.mockReturnValue(START);
      throw new mongoose.mongo.MongoServerError({
        message: 'Simulated transient conflict.',
        code: 112,
        errorLabels: ['TransientTransactionError'],
      });
    });
  try {
    assertFailure(await book(), 400, 'VALIDATION_ERROR');
    assert.equal(create.mock.calls.length, 1);
    assert.ok(clock.now.mock.calls.length >= 2);
  } finally {
    create.mockRestore();
  }
  assert.equal(await Reservation.countDocuments(), 0);
  assert.equal((await Equipment.findById(item.id)).reservationGuardVersion, 0);
});

test.each(['maintenance', 'unavailable', 'archive'])(
  'booking racing with %s never leaves a future active reservation',
  async (operation) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const equipment = await Equipment.create({
        ...metadata,
        assetCode: `RACE-${attempt}`,
        statusUpdatedBy: admin.id,
      });
      const [booking, lifecycle] = await Promise.all([
        book(
          { equipmentId: equipment.id, startAt: START.toISOString() },
          attempt % 2 ? studentSession : otherSession,
        ),
        operation === 'archive'
          ? archive(equipment.id)
          : statusChange(equipment.id, operation),
      ]);
      assert.equal(lifecycle.status, operation === 'archive' ? 204 : 200);
      assert.ok([201, 409].includes(booking.status));
      if (booking.status === 409)
        assertFailure(booking, 409, 'EQUIPMENT_NOT_AVAILABLE');
      const stored = await Equipment.findById(equipment.id);
      assert.equal(
        stored.reservationGuardVersion,
        booking.status === 201 ? 2 : 1,
      );
      assert.equal(
        await Reservation.countDocuments({
          equipmentId: equipment.id,
          status: 'active',
          startAt: { $gt: NOW },
        }),
        0,
      );
      if (booking.status === 201) {
        const cancelled = await Reservation.findById(booking.body.data.id);
        assert.equal(cancelled.status, 'cancelled');
        assert.equal(
          cancelled.cancellationReason,
          operation === 'archive'
            ? 'equipment_archived'
            : `equipment_${operation}`,
        );
      }
    }
  },
  20_000,
);

test('a booking committed before maintenance is cancelled, and re-enabling equipment leaves the slot rebookable', async () => {
  const booked = await book().expect(201);
  const changed = await statusChange(item.id, 'maintenance').expect(200);
  assert.equal(changed.body.data.cancelledReservationCount, 1);
  assert.equal(
    (await Reservation.findById(booked.body.data.id)).status,
    'cancelled',
  );
  await statusChange(item.id, 'available').expect(200);
  assert.equal(
    (await availability().expect(200)).body.data.slots.some(
      (slot) => slot.startAt === START.toISOString(),
    ),
    true,
  );
  await book(undefined, otherSession).expect(201);
  assert.equal(await Reservation.countDocuments(), 2);
});
