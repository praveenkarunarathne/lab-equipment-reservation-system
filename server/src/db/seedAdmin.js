import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from './connect.js';
import { ensureCriticalIndexes } from './ensureCriticalIndexes.js';
import { registrationSchema } from '../modules/auth/auth.validation.js';
import { createAuthService } from '../modules/auth/auth.service.js';

try {
  const env = loadEnv();
  const input = registrationSchema.safeParse({
    name: process.env.ADMIN_BOOTSTRAP_NAME,
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  });
  if (!input.success) throw new Error('Invalid admin bootstrap values.');
  await connectDatabase(env.mongodbUri);
  await ensureCriticalIndexes(mongoose.connection);
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
    'Admin seed failed. Check bootstrap values and MongoDB; an existing student cannot be promoted.',
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
