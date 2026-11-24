/**
 * Shared harness for the EC4206 QA suites (decision table, OWASP, Cucumber).
 * Boots an in-memory MongoDB replica set (transactions need one), the real
 * Express app, and one admin + two students. Nothing is mocked except the clock.
 */
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../../../src/app.js';
import { loadEnv } from '../../../src/config/env.js';
import { ensureCriticalIndexes } from '../../../src/db/ensureCriticalIndexes.js';
import { createAuthService } from '../../../src/modules/auth/auth.service.js';
import { getEquipmentModel } from '../../../src/modules/equipment/equipment.model.js';
import { getReservationModel } from '../../../src/modules/reservations/reservation.model.js';
import { getFaultReportModel } from '../../../src/modules/faultReports/faultReport.model.js';
import { clock } from '../../../src/shared/clock.js';
import { createLogger } from '../../../src/shared/logger.js';

export const PASSWORD = 'qa suite shared password';
export const APP_ORIGIN = 'http://localhost:5173';

export async function startHarness(dbName = 'qa_test') {
  const replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.0.32' },
    replSet: { count: 1 },
  });
  const uri = replicaSet.getUri(dbName);
  const connection = await mongoose
    .createConnection(uri, { autoIndex: false })
    .asPromise();
  await ensureCriticalIndexes(connection);
  const auth = createAuthService(connection);
  const users = {
    admin: (
      await auth.seedAdmin({
        name: 'Lab Administrator',
        email: 'admin@qa.test',
        password: PASSWORD,
      })
    ).user,
    student: await auth.register({
      name: 'Student One',
      email: 'student1@qa.test',
      password: PASSWORD,
    }),
    otherStudent: await auth.register({
      name: 'Student Two',
      email: 'student2@qa.test',
      password: PASSWORD,
    }),
  };
  const env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: uri,
    APP_ORIGIN,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
  });
  const models = {
    Equipment: getEquipmentModel(connection),
    Reservation: getReservationModel(connection),
    FaultReport: getFaultReportModel(connection),
  };

  const harness = {
    connection,
    users,
    models,
    app: null,
    /** Fresh app (fresh rate-limit counters) and empty collections. */
    async reset() {
      await Promise.all([
        models.Reservation.deleteMany({}),
        models.Equipment.deleteMany({}),
        models.FaultReport.deleteMany({}),
        connection.db.collection('sessions').deleteMany({}),
      ]);
      harness.app = createApp({
        env,
        connection,
        logger: createLogger('silent'),
      });
    },
    /** Agent with a CSRF token; logged in when a user is given. */
    async session(user) {
      const agent = request.agent(harness.app);
      const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      let token = csrf.body.data.csrfToken;
      if (user) {
        const login = await agent
          .post('/api/v1/auth/login')
          .set('X-CSRF-Token', token)
          .send({ email: user.email, password: PASSWORD })
          .expect(200);
        token = login.body.data.csrfToken;
      }
      return { agent, token };
    },
    async equipment(overrides = {}) {
      return models.Equipment.create({
        assetCode: `QA-${randomBytes(3).toString('hex').toUpperCase()}`,
        name: 'Digital Oscilloscope',
        category: 'Electronics',
        location: 'Lab B',
        statusUpdatedBy: users.admin.id,
        ...overrides,
      });
    },
    freezeClock(now) {
      clock.now = () => new Date(now);
    },
    async stop() {
      await connection?.close();
      await replicaSet?.stop();
    },
  };
  await harness.reset();
  return harness;
}
