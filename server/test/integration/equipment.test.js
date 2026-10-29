import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { ensureCriticalIndexes } from '../../src/db/ensureCriticalIndexes.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { getEquipmentModel } from '../../src/modules/equipment/equipment.model.js';
import { getReservationModel } from '../../src/modules/reservations/reservation.model.js';
import { createLogger } from '../../src/shared/logger.js';

let replicaSet,
  connection,
  env,
  app,
  Equipment,
  Reservation,
  admin,
  student,
  adminSession,
  studentSession;
const password = 'equipment tests password';
const metadata = {
  assetCode: 'SCOPE-01',
  name: 'Microscope',
  category: 'Optics',
  location: 'Lab A',
  description: 'Teaching microscope',
};

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  connection = await mongoose
    .createConnection(replicaSet.getUri('equipment_test'), { autoIndex: false })
    .asPromise();
  await ensureCriticalIndexes(connection);
  Equipment = getEquipmentModel(connection);
  Reservation = getReservationModel(connection);
  const auth = createAuthService(connection);
  student = await auth.register({
    name: 'Student',
    email: 'student@example.com',
    password,
  });
  admin = (
    await auth.seedAdmin({
      name: 'Admin',
      email: 'admin@example.com',
      password,
    })
  ).user;
  env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: replicaSet.getUri('equipment_test'),
    APP_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
  });
}, 180_000);
afterAll(async () => {
  await connection?.close();
  await replicaSet?.stop();
});

async function preAuth() {
  const agent = request.agent(app);
  const response = await agent.get('/api/v1/auth/csrf').expect(200);
  return { agent, token: response.body.data.csrfToken };
}
async function signIn(user) {
  const session = await preAuth();
  const response = await session.agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', session.token)
    .send({ email: user.email, password })
    .expect(200);
  return { agent: session.agent, token: response.body.data.csrfToken };
}
beforeEach(async () => {
  await Equipment.deleteMany({});
  await Reservation.deleteMany({});
  await connection.db.collection('sessions').deleteMany({});
  app = createApp({ env, connection, logger: createLogger('silent') });
  adminSession = await signIn(admin);
  studentSession = await signIn(student);
});

function createFixture(input = {}) {
  return Equipment.create({ ...metadata, statusUpdatedBy: admin.id, ...input });
}
function createEquipment(body = metadata, session = adminSession) {
  return session.agent
    .post('/api/v1/equipment')
    .set('X-CSRF-Token', session.token)
    .send(body);
}
function updateEquipment(id, body, session = adminSession) {
  return session.agent
    .patch(`/api/v1/equipment/${id}`)
    .set('X-CSRF-Token', session.token)
    .send(body);
}
function assertFailure(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.equal(response.body.error.requestId, response.headers['x-request-id']);
}

test('administrators create normalized available equipment with private audit fields', async () => {
  const response = await createEquipment({
    ...metadata,
    assetCode: ' scope-01 ',
    name: ' Microscope ',
    category: ' Optics ',
    location: ' Lab A ',
    description: ' Teaching microscope ',
  }).expect(201);
  assert.deepEqual(Object.keys(response.body.data).sort(), [
    'assetCode',
    'category',
    'createdAt',
    'description',
    'id',
    'location',
    'name',
    'status',
    'statusReason',
    'statusUpdatedAt',
    'updatedAt',
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(metadata).map((field) => [field, response.body.data[field]]),
    ),
    metadata,
  );
  assert.equal(response.body.data.status, 'available');
  assert.equal(response.body.data.statusReason, null);
  const stored = await Equipment.findById(response.body.data.id);
  assert.equal(stored.statusUpdatedBy.toString(), admin.id);
  assert.equal(stored.reservationGuardVersion, 0);
  assert.equal(stored.archivedAt, null);
  assert.equal(
    stored.statusUpdatedAt.toISOString(),
    response.body.data.statusUpdatedAt,
  );
  const detail = await studentSession.agent
    .get(`/api/v1/equipment/${stored.id}`)
    .expect(200);
  assert.deepEqual(detail.body, { data: response.body.data });
});

test('authentication, admin authorization, and CSRF protect equipment operations', async () => {
  const item = await createFixture();
  assertFailure(
    await request(app).get('/api/v1/equipment'),
    401,
    'AUTH_REQUIRED',
  );
  assertFailure(
    await request(app).get(`/api/v1/equipment/${item.id}`),
    401,
    'AUTH_REQUIRED',
  );
  const anonymous = await preAuth();
  assertFailure(
    await createEquipment(metadata, anonymous),
    401,
    'AUTH_REQUIRED',
  );
  assertFailure(
    await createEquipment(metadata, studentSession),
    403,
    'FORBIDDEN',
  );
  assertFailure(
    await updateEquipment(item.id, { name: 'Changed' }, studentSession),
    403,
    'FORBIDDEN',
  );
  assertFailure(
    await adminSession.agent.post('/api/v1/equipment').send(metadata),
    403,
    'CSRF_INVALID',
  );
  assertFailure(
    await adminSession.agent
      .patch(`/api/v1/equipment/${item.id}`)
      .send({ name: 'Changed' }),
    403,
    'CSRF_INVALID',
  );
  assert.equal((await Equipment.findById(item.id)).name, metadata.name);
  assert.equal(await Equipment.countDocuments(), 1);
});

test('create and metadata edit reject status, archive, and internal fields', async () => {
  const item = await createFixture();
  for (const [field, value] of Object.entries({
    status: 'maintenance',
    statusReason: 'Broken',
    statusUpdatedBy: student.id,
    statusUpdatedAt: new Date().toISOString(),
    archivedAt: new Date().toISOString(),
    archivedBy: admin.id,
    reservationGuardVersion: 99,
    role: 'admin',
    _id: item.id,
    $set: { status: 'maintenance' },
  })) {
    assertFailure(
      await createEquipment({ ...metadata, [field]: value }),
      400,
      'VALIDATION_ERROR',
    );
    assertFailure(
      await updateEquipment(item.id, { [field]: value }),
      400,
      'VALIDATION_ERROR',
    );
  }
  assertFailure(await updateEquipment(item.id, {}), 400, 'VALIDATION_ERROR');
  assert.equal((await Equipment.findById(item.id)).status, 'available');
});

test('metadata validation enforces bounds and provides field errors', async () => {
  for (const [field, value] of [
    ['assetCode', 'bad code'],
    ['assetCode', 'A'],
    ['assetCode', 'A'.repeat(31)],
    ['name', ' '],
    ['name', 'a'.repeat(101)],
    ['category', 'x'],
    ['location', 'x'],
    ['description', 'x'.repeat(1001)],
  ]) {
    const response = await createEquipment({ ...metadata, [field]: value });
    assertFailure(response, 400, 'VALIDATION_ERROR');
    assert.ok(response.body.error.fieldErrors[`body.${field}`]);
  }
  const withoutDescription = { ...metadata };
  delete withoutDescription.description;
  const response = await createEquipment(withoutDescription).expect(201);
  assert.equal(response.body.data.description, '');
});

test('asset-code uniqueness handles normalization and concurrent creation', async () => {
  const results = await Promise.all([
    createEquipment(metadata),
    createEquipment({ ...metadata, assetCode: ' scope-01 ' }),
  ]);
  assert.deepEqual(
    results.map((response) => response.status).sort(),
    [201, 409],
  );
  assertFailure(
    results.find((response) => response.status === 409),
    409,
    'ASSET_CODE_ALREADY_EXISTS',
  );
  assert.equal(await Equipment.countDocuments(), 1);
});

test('metadata edits preserve operational state, guard, and status audit', async () => {
  const item = await createFixture({
    status: 'maintenance',
    statusReason: 'Calibration',
    reservationGuardVersion: 5,
  });
  const response = await updateEquipment(item.id, {
    assetCode: ' new_code ',
    name: ' Updated microscope ',
    description: '',
  }).expect(200);
  assert.equal(response.body.data.assetCode, 'NEW_CODE');
  assert.equal(response.body.data.name, 'Updated microscope');
  assert.equal(response.body.data.description, '');
  const updated = await Equipment.findById(item.id);
  assert.equal(updated.status, 'maintenance');
  assert.equal(updated.statusReason, 'Calibration');
  assert.equal(updated.reservationGuardVersion, 5);
  assert.equal(
    updated.statusUpdatedAt.toISOString(),
    item.statusUpdatedAt.toISOString(),
  );
  assert.equal(updated.statusUpdatedBy.toString(), admin.id);
  await createFixture({ assetCode: 'OTHER' });
  assertFailure(
    await updateEquipment(item.id, {
      assetCode: ' other ',
      name: 'Should not persist',
    }),
    409,
    'ASSET_CODE_ALREADY_EXISTS',
  );
  assert.equal((await Equipment.findById(item.id)).name, 'Updated microscope');
});

test('pagination defaults, ordering, counts, and out-of-range pages are correct', async () => {
  await Equipment.insertMany(
    Array.from({ length: 15 }, (_, index) => ({
      ...metadata,
      name: `Item ${String(index).padStart(2, '0')}`,
      assetCode: `ASSET-${index}`,
      statusUpdatedBy: admin.id,
    })),
  );
  const first = await studentSession.agent.get('/api/v1/equipment').expect(200);
  assert.deepEqual(first.body.pagination, {
    page: 1,
    limit: 12,
    total: 15,
    totalPages: 2,
  });
  assert.equal(first.body.data.length, 12);
  assert.equal(first.body.data[0].name, 'Item 00');
  const second = await studentSession.agent
    .get('/api/v1/equipment?page=2')
    .expect(200);
  assert.equal(second.body.data.length, 3);
  assert.equal(second.body.data[0].name, 'Item 12');
  const beyond = await studentSession.agent
    .get('/api/v1/equipment?page=3')
    .expect(200);
  assert.deepEqual(beyond.body.data, []);
  assert.equal(beyond.body.pagination.total, 15);
  await Equipment.deleteMany({});
  await createFixture({ name: 'Same', assetCode: 'ZZ' });
  await createFixture({ name: 'Same', assetCode: 'AA' });
  const tied = await studentSession.agent.get('/api/v1/equipment').expect(200);
  assert.deepEqual(
    tied.body.data.map((item) => item.assetCode),
    ['AA', 'ZZ'],
  );
});

test('catalog sorts before pagination, breaks ties and preserves filters', async () => {
  const fixtures = [
    { name: 'Alpha', assetCode: 'AA', createdAt: new Date('2026-01-01') },
    { name: 'Zulu', assetCode: 'ZZ', createdAt: new Date('2026-01-02') },
    { name: 'Zulu', assetCode: 'BB', createdAt: new Date('2026-01-02') },
  ];
  const items = [];
  for (const fixture of fixtures) items.push(await createFixture(fixture));
  await createFixture({ assetCode: 'EXCLUDED', category: 'Electronics' });
  await createFixture({ assetCode: 'ARCHIVED', archivedAt: new Date() });
  const newest = [...items]
    .sort((a, b) => b.id.localeCompare(a.id))
    .filter((item) => item.name === 'Zulu')
    .map((item) => item.assetCode);
  for (const [sort, expected] of [
    ['name_asc', ['AA', 'BB', 'ZZ']],
    ['name_desc', ['BB', 'ZZ', 'AA']],
    ['newest', [...newest, 'AA']],
  ]) {
    const codes = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await studentSession.agent
        .get('/api/v1/equipment')
        .query({
          sort,
          page,
          limit: 1,
          category: 'Optics',
          status: 'available',
        })
        .expect(200);
      assert.equal(response.body.pagination.total, 3);
      codes.push(response.body.data[0].assetCode);
    }
    assert.deepEqual(codes, expected);
  }
});

test('search escapes regex metacharacters in each searchable field', async () => {
  await createFixture({
    name: 'Scope [A]+ (trial).*? ^$|{}\\',
    category: 'Optics (A)+',
    location: 'Room [2]',
  });
  await createFixture({
    assetCode: 'OTHER',
    name: 'Other',
    category: 'Optics (A)+ extended',
    location: 'Lab B',
  });
  for (const q of ['[A]+', '.*', '\\', 'SCOPE-01', 'optics (a)+', 'Room [2]']) {
    const response = await studentSession.agent
      .get('/api/v1/equipment')
      .query({ q })
      .expect(200);
    assert.ok(
      response.body.data.some((item) => item.assetCode === metadata.assetCode),
    );
    if (!q.toLowerCase().includes('optics'))
      assert.equal(response.body.pagination.total, 1);
  }
  const exact = await studentSession.agent
    .get('/api/v1/equipment')
    .query({ category: 'OPTICS (a)+' })
    .expect(200);
  assert.equal(exact.body.pagination.total, 1);
  const noMatch = await studentSession.agent
    .get('/api/v1/equipment')
    .query({ q: 'missing' })
    .expect(200);
  assert.deepEqual(noMatch.body.pagination, {
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 0,
  });
});

test('status, category, and search filters combine, without an API default status restriction', async () => {
  await createFixture();
  await createFixture({
    assetCode: 'MAINT',
    status: 'maintenance',
    statusReason: 'Calibration',
  });
  await createFixture({
    assetCode: 'OUT',
    status: 'unavailable',
    statusReason: 'Out of service',
    category: 'Electronics',
  });
  assert.equal(
    (await studentSession.agent.get('/api/v1/equipment').expect(200)).body
      .pagination.total,
    3,
  );
  const combined = await studentSession.agent
    .get('/api/v1/equipment')
    .query({ status: 'maintenance', category: 'OPTICS', q: 'microscope' })
    .expect(200);
  assert.equal(combined.body.pagination.total, 1);
  assert.equal(combined.body.data[0].assetCode, 'MAINT');
});

test('invalid queries and IDs fail validation before database lookups', async () => {
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=Infinity',
    'limit=51',
    'limit=0',
    'page=1&page=2',
    'status=all',
    'sort=unknown',
    'sort=',
    'sort=name_asc&sort=newest',
    'sort[$ne]=name_asc',
    `q=${'x'.repeat(81)}`,
    `category=${'x'.repeat(51)}`,
    'q[$ne]=x',
  ]) {
    assertFailure(
      await studentSession.agent.get(`/api/v1/equipment?${query}`),
      400,
      'VALIDATION_ERROR',
    );
  }
  assertFailure(
    await studentSession.agent.get('/api/v1/equipment/not-an-id'),
    400,
    'VALIDATION_ERROR',
  );
  assertFailure(
    await updateEquipment('not-an-id', { name: 'Name' }),
    400,
    'VALIDATION_ERROR',
  );
  const missing = new mongoose.Types.ObjectId().toString();
  assertFailure(
    await studentSession.agent.get(`/api/v1/equipment/${missing}`),
    404,
    'RESOURCE_NOT_FOUND',
  );
  assertFailure(
    await updateEquipment(missing, { name: 'Name' }),
    404,
    'RESOURCE_NOT_FOUND',
  );
});

test('archived equipment stays in storage but cannot be listed, read, or edited', async () => {
  const item = await createFixture({
    archivedAt: new Date(),
    archivedBy: admin.id,
    status: 'unavailable',
    statusReason: 'Archived',
  });
  for (const session of [adminSession, studentSession]) {
    const response = await session.agent
      .get('/api/v1/equipment?status=unavailable')
      .expect(200);
    assert.equal(response.body.pagination.total, 0);
    assertFailure(
      await session.agent.get(`/api/v1/equipment/${item.id}`),
      404,
      'RESOURCE_NOT_FOUND',
    );
  }
  assertFailure(
    await updateEquipment(item.id, { name: 'Changed' }),
    404,
    'RESOURCE_NOT_FOUND',
  );
  assert.equal((await Equipment.findById(item.id)).name, metadata.name);
});

test('equipment model enforces the status reason invariant', async () => {
  await assert.rejects(createFixture({ status: 'maintenance' }), /reason/i);
  await assert.rejects(
    createFixture({ status: 'unavailable', statusReason: '   ' }),
    /reason/i,
  );
  await assert.rejects(
    createFixture({ statusReason: 'Should be null' }),
    /reason/i,
  );
});

test('critical catalog and reservation indexes are installed idempotently', async () => {
  await ensureCriticalIndexes(connection);
  const equipmentIndexes = await Equipment.collection.indexes();
  assert.ok(
    equipmentIndexes.some(
      (index) => index.name === 'uq_equipment_asset_code' && index.unique,
    ),
  );
  assert.ok(
    equipmentIndexes.some((index) => index.name === 'idx_equipment_catalog'),
  );
  const indexes = await Reservation.collection.indexes();
  const active = indexes.find(
    (index) => index.name === 'uq_reservation_active_equipment_start',
  );
  assert.equal(active.unique, true);
  assert.deepEqual(active.key, { equipmentId: 1, startAt: 1 });
  assert.deepEqual(active.partialFilterExpression, { status: 'active' });
  assert.ok(
    indexes.some((index) => index.name === 'idx_reservations_student_start'),
  );
  assert.ok(
    indexes.some((index) => index.name === 'idx_reservations_status_start'),
  );
});

test('active-slot uniqueness permits cancelled history and rebooking without storing derived fields', async () => {
  const item = await createFixture();
  const slot = {
    equipmentId: item.id,
    studentId: student.id,
    startAt: new Date('2026-11-02T03:30:00.000Z'),
  };
  const first = await Reservation.create({
    ...slot,
    endAt: new Date(),
    phase: 'upcoming',
  });
  assert.equal(first.status, 'active');
  assert.equal(first.toObject().endAt, undefined);
  assert.equal(first.toObject().phase, undefined);
  await assert.rejects(
    Reservation.create(slot),
    (error) => error.code === 11000,
  );
  await Reservation.updateOne(
    { _id: first.id },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: student.id,
        cancellationReason: 'student_cancelled',
      },
    },
  );
  await Reservation.create(slot);
  await Reservation.create({
    ...slot,
    status: 'cancelled',
    cancellationReason: 'equipment_maintenance',
  });
  await Reservation.create({
    ...slot,
    startAt: new Date('2026-11-02T04:30:00.000Z'),
  });
  assert.equal(await Reservation.countDocuments(), 4);
  await assert.rejects(
    Reservation.create({ ...slot, status: 'completed' }),
    /validation/i,
  );
});
