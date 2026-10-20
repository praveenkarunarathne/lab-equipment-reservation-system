import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from './connect.js';

try {
  await connectDatabase(loadEnv().mongodbUri);
  const collection = mongoose.connection.db.collection('_setup_checks');
  const id = randomUUID();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await collection.insertOne({ _id: id }, { session });
      assert.ok(await collection.findOne({ _id: id }, { session }));
      await collection.deleteOne({ _id: id }, { session });
    });
    assert.equal(await collection.findOne({ _id: id }), null);
    console.info('MongoDB transaction check passed.');
  } finally {
    await session.endSession();
  }
} catch {
  console.error(
    'MongoDB transaction check failed. Verify the replica set is initialized.',
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
