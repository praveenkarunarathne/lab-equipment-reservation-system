import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';

const { mongodbUri } = loadEnv();
const uri = new URL(mongodbUri);
if (!['localhost', '127.0.0.1'].includes(uri.hostname)) {
  throw new Error('Replica-set initialization is restricted to local MongoDB.');
}
uri.searchParams.delete('replicaSet');
uri.searchParams.set('directConnection', 'true');
const connection = mongoose.createConnection(uri.toString(), {
  serverSelectionTimeoutMS: 5000,
});

try {
  await connection.asPromise();
  const admin = connection.db.admin();
  try {
    await admin.command({ replSetGetStatus: 1 });
  } catch (error) {
    if (error.code !== 94) throw error;
    await admin.command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: 'localhost:27017' }],
      },
    });
  }

  const deadline = Date.now() + 30000;
  while (true) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary) break;
    if (Date.now() >= deadline) throw new Error('Primary election timed out.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.info('Local replica set is ready.');
} catch {
  console.error(
    'Replica-set initialization failed. Check the local MongoDB container.',
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
