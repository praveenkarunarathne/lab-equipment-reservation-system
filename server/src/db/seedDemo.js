import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from './connect.js';
import { ensureCriticalIndexes } from './ensureCriticalIndexes.js';
import { assertDemoEnvironment, seedDemoData } from './seeds/seedDemoData.js';
import { DEMO_ACCOUNTS } from './seeds/demoData.js';

let stage = 'environment validation';
try {
  const env = loadEnv();
  assertDemoEnvironment(env.nodeEnv);
  stage = 'database connection';
  await connectDatabase(env.mongodbUri);
  stage = 'critical index initialization';
  await ensureCriticalIndexes(mongoose.connection);
  stage = 'sample data insertion';
  const result = await seedDemoData(mongoose.connection, {
    nodeEnv: env.nodeEnv,
  });
  if (!result.created)
    console.info('Sample dataset already exists; no records changed.');
  else
    console.info(
      `Created ${result.users} demo users, ${result.equipment} equipment items, ${result.reservations} reservations and ${result.faults} fault reports.`,
    );
  console.info(
    `Demo accounts: ${DEMO_ACCOUNTS.map((account) => account.email).join(', ')}. See README for the development-only password.`,
  );
} catch {
  console.error(
    `Sample seed failed during ${stage}. Use development/test mode, a MongoDB replica set and unused demo account emails/DEMO asset codes. No existing records are overwritten.`,
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
