import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import { ensureCriticalIndexes } from '../../src/db/ensureCriticalIndexes.js';
import { seedDemoData } from '../../src/db/seeds/seedDemoData.js';
import {
  createDemoData,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
} from '../../src/db/seeds/demoData.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { createDashboardService } from '../../src/modules/dashboard/dashboard.service.js';
import { assertLegalStart } from '../../src/modules/reservations/reservationTime.js';
import { getUserModel } from '../../src/modules/users/user.model.js';
import { getEquipmentModel } from '../../src/modules/equipment/equipment.model.js';
import { getReservationModel } from '../../src/modules/reservations/reservation.model.js';
import { getFaultReportModel } from '../../src/modules/faultReports/faultReport.model.js';
import { clock } from '../../src/shared/clock.js';

const NOW = new Date('2026-10-28T05:30:00Z');
let replica, connection, User, Equipment, Reservation, FaultReport;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  connection = await mongoose
    .createConnection(replica.getUri('demo_seed_test'), { autoIndex: false })
    .asPromise();
  await ensureCriticalIndexes(connection);
  User = getUserModel(connection);
  Equipment = getEquipmentModel(connection);
  Reservation = getReservationModel(connection);
  FaultReport = getFaultReportModel(connection);
}, 180_000);
afterAll(async () => {
  await connection?.close();
  await replica?.stop();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await FaultReport.deleteMany({});
  await Reservation.deleteMany({});
  await Equipment.deleteMany({});
  await User.deleteMany({});
  vi.spyOn(clock, 'now').mockReturnValue(NOW);
});
const seed = (nodeEnv = 'test') => seedDemoData(connection, { nodeEnv });

test('creates usable demo logins and a coherent dataset for the catalog, history and dashboard', async () => {
  assert.deepEqual(await seed(), {
    created: true,
    users: 3,
    equipment: 10,
    reservations: 36,
    faults: 7,
  });
  for (const account of DEMO_ACCOUNTS) {
    const user = await createAuthService(connection).login({
      email: account.email,
      password: DEMO_PASSWORD,
    });
    assert.equal(user.role, account.role);
  }
  const dashboard = await createDashboardService(connection).overview();
  assert.deepEqual(dashboard.equipment, {
    total: 9,
    byStatus: { available: 6, maintenance: 2, unavailable: 1 },
  });
  assert.equal(dashboard.upcomingReservationCount, 6);
  assert.equal(dashboard.openFaultReportCount, 5);
  assert.deepEqual(
    dashboard.topEquipment.map((item) => item.reservationCount),
    [6, 5, 4, 3, 2],
  );
  assert.equal(
    await FaultReport.countDocuments({
      status: 'resolved',
      resolvedBy: DEMO_ACCOUNTS[0]._id,
    }),
    2,
  );
  assert.equal(await Reservation.countDocuments({ status: 'cancelled' }), 5);
  for (const reservation of await Reservation.find().lean()) {
    const equipment = await Equipment.findById(reservation.equipmentId);
    assert.ok(equipment);
    assert.ok(
      await User.exists({ _id: reservation.studentId, role: 'student' }),
    );
    if (reservation.status === 'active' && reservation.startAt > NOW) {
      assert.equal(equipment.archivedAt, null);
      assert.equal(equipment.status, 'available');
      assertLegalStart(reservation.startAt, NOW);
    }
  }
});

test('rerunning after time passes preserves sample edits, audit, passwords, dates and unrelated data', async () => {
  const realAdmin = (
    await createAuthService(connection).seedAdmin({
      name: 'Existing Administrator',
      email: 'existing@example.test',
      password: 'existing admin password',
    })
  ).user;
  await seed();
  const item = await Equipment.findOne({ assetCode: 'DEMO-MIC-01' });
  item.name = 'Edited sample microscope';
  await item.save();
  const before = {
    users: await User.find().select('+passwordHash').sort('_id').lean(),
    equipment: await Equipment.find().sort('_id').lean(),
    reservations: await Reservation.find().sort('_id').lean(),
    faults: await FaultReport.find().sort('_id').lean(),
  };
  clock.now.mockReturnValue(new Date('2026-11-28T00:00:00Z'));
  assert.deepEqual(await seed(), { created: false });
  assert.deepEqual(
    await User.find().select('+passwordHash').sort('_id').lean(),
    before.users,
  );
  assert.deepEqual(await Equipment.find().sort('_id').lean(), before.equipment);
  assert.deepEqual(
    await Reservation.find().sort('_id').lean(),
    before.reservations,
  );
  assert.deepEqual(await FaultReport.find().sort('_id').lean(), before.faults);
  assert.equal(
    (
      await createAuthService(connection).login({
        email: realAdmin.email,
        password: 'existing admin password',
      })
    ).id,
    realAdmin.id,
  );
});

test('refuses production and unknown environments before inserting anything', async () => {
  for (const env of ['production', undefined, 'staging'])
    await assert.rejects(
      seedDemoData(connection, { nodeEnv: env }),
      /only available in development or test/,
    );
  assert.equal(await User.countDocuments(), 0);
  assert.equal(await Equipment.countDocuments(), 0);
});

test('an existing asset code rolls back all demo inserts and preserves existing records', async () => {
  const admin = (
    await createAuthService(connection).seedAdmin({
      name: 'Existing Admin',
      email: 'existing@example.test',
      password: 'existing admin password',
    })
  ).user;
  const existing = await Equipment.create({
    assetCode: 'DEMO-MIC-01',
    name: 'Existing microscope',
    category: 'Optics',
    location: 'Lab Z',
    statusUpdatedBy: admin.id,
  });
  await assert.rejects(seed(), (error) => error.code === 11000);
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Equipment.countDocuments(), 1);
  assert.equal(await Reservation.countDocuments(), 0);
  assert.equal(await FaultReport.countDocuments(), 0);
  assert.deepEqual(
    await Equipment.findById(existing.id).lean(),
    existing.toObject(),
  );
});

test('an existing demo email cannot be overwritten or promoted', async () => {
  const existing = await createAuthService(connection).register({
    name: 'Existing Student',
    email: DEMO_ACCOUNTS[0].email,
    password: 'existing student password',
  });
  await assert.rejects(seed(), (error) => error.code === 11000);
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Equipment.countDocuments(), 0);
  assert.equal((await User.findById(existing.id)).role, 'student');
});

test('a failure after reservation insertion rolls back the whole sample dataset', async () => {
  vi.spyOn(FaultReport, 'insertMany').mockRejectedValueOnce(
    new Error('Injected fault insertion failure'),
  );
  await assert.rejects(seed(), /Injected fault/);
  for (const model of [User, Equipment, Reservation, FaultReport])
    assert.equal(await model.countDocuments(), 0);
});

test.each([
  '2026-10-30T23:59:59Z',
  '2026-10-31T00:00:00Z',
  '2026-11-01T23:00:00Z',
])(
  'generated slots remain legal around weekends and midnight at %s',
  (instant) => {
    const now = new Date(instant);
    const data = createDemoData(now);
    for (const reservation of data.reservations) {
      assert.ok(reservation.startAt instanceof Date);
      if (reservation.startAt > now) assertLegalStart(reservation.startAt, now);
    }
  },
);
