import { createServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { ensureCriticalIndexes } from '../src/db/ensureCriticalIndexes.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { getEquipmentModel } from '../src/modules/equipment/equipment.model.js';
import { getReservationModel } from '../src/modules/reservations/reservation.model.js';
import { getFaultReportModel } from '../src/modules/faultReports/faultReport.model.js';
import { clock } from '../src/shared/clock.js';
import {
  BASE_URL,
  PASSWORD,
  ADMIN_EMAIL,
  STUDENT_EMAIL,
} from '../../e2e/config.js';

const directory = await mkdtemp(join(tmpdir(), 'lab-e2e-'));
let replica,
  connection,
  server,
  stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await connection?.close();
  await replica?.stop();
  await rm(directory, { recursive: true, force: true });
}
process.on('SIGTERM', () => {
  cleanup().catch(() => {
    process.exitCode = 1;
  });
});
process.on('SIGINT', () => {
  cleanup().catch(() => {
    process.exitCode = 1;
  });
});
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  replica = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    // Playwright signals the server group; MongoDB must survive until cleanup().
    replSet: { count: 1, spawn: { detached: true } },
  });
  connection = await mongoose
    .createConnection(replica.getUri('lab_e2e'), { autoIndex: false })
    .asPromise();
  await ensureCriticalIndexes(connection);
  const auth = createAuthService(connection);
  const admin = (
    await auth.seedAdmin({
      name: 'E2E Administrator',
      email: ADMIN_EMAIL,
      password: PASSWORD,
    })
  ).user;
  const student = await auth.register({
    name: 'E2E Student',
    email: STUDENT_EMAIL,
    password: PASSWORD,
  });
  const Equipment = getEquipmentModel(connection);
  const Reservation = getReservationModel(connection);
  const base = {
    category: 'Electronics',
    location: 'Lab A',
    statusUpdatedBy: admin.id,
  };
  await Equipment.create({
    ...base,
    assetCode: 'BOOK-01',
    name: 'Booking microscope',
  });
  const lifecycle = await Equipment.create({
    ...base,
    assetCode: 'LIFE-01',
    name: 'Lifecycle oscilloscope',
  });
  await Reservation.create({
    equipmentId: lifecycle.id,
    studentId: student.id,
    startAt: new Date('2026-10-27T03:00:00Z'),
  });
  await getFaultReportModel(connection).create({
    equipmentId: lifecycle.id,
    reportedBy: student.id,
    category: 'calibration',
    title: 'Calibration drifts',
    description: 'The displayed reading drifts during use.',
  });
  clock.now = () => new Date('2026-10-26T00:00:00Z');
  const env = loadEnv({
    NODE_ENV: 'production',
    PORT: '4310',
    APP_ORIGIN: BASE_URL,
    MONGODB_URI: replica.getUri('lab_e2e'),
    SESSION_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
  });
  server = createServer(
    {
      key: await readFile(join(directory, 'key.pem')),
      cert: await readFile(join(directory, 'cert.pem')),
    },
    createApp({ env, connection }),
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4310, '127.0.0.1', resolve);
  });
  console.info('Isolated production HTTPS E2E server ready.');
} catch {
  console.error(
    'E2E startup failed. Check the client build, OpenSSL, MongoDB download and test port 4310.',
  );
  await cleanup();
  process.exitCode = 1;
}
