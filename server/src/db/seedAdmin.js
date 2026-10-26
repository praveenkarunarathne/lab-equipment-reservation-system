import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from './connect.js';
import { ensureCriticalIndexes } from './ensureCriticalIndexes.js';
import { registrationSchema } from '../modules/auth/auth.validation.js';
import { createAuthService } from '../modules/auth/auth.service.js';

let stage = 'application environment validation';
try {
  const env = loadEnv();
  stage = 'bootstrap validation';
  const input = registrationSchema.safeParse({
    name: process.env.ADMIN_BOOTSTRAP_NAME,
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  });
  if (!input.success) {
    for (const issue of input.error.issues) {
      console.error(
        `ADMIN_BOOTSTRAP_${String(issue.path[0]).toUpperCase()}: ${issue.message}`,
      );
    }
    throw new Error('Invalid admin bootstrap values.');
  }
  stage = 'database connection';
  await connectDatabase(env.mongodbUri);
  stage = 'critical index initialization';
  await ensureCriticalIndexes(mongoose.connection);
  stage = 'admin creation';
  const { created } = await createAuthService(mongoose.connection).seedAdmin(
    input.data,
  );
  console.info(
    created
      ? 'Administrator created.'
      : 'Administrator already exists; no changes made.',
  );
} catch {
  console.error(
    `Admin seed failed during ${stage}. Check bootstrap values and MongoDB; an existing student cannot be promoted.`,
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
